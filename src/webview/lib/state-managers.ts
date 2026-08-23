import {SHARED_CONSTANTS} from '../../shared/constants';
import type {
  SessionMeta,
  TerminalSlot,
  ThemePresetInfo,
  ThemeSlotSnapshot,
} from '../../shared/types';
import {PANES, type Pane, type ViewMode, type ViewState} from './types';
import {
  clampSplitRatio,
  debounce,
  validateTerminalHeight,
  type DebouncedFunction,
} from './utils';

/** セッションごとの出力バッファ。chunks の合計文字数を length に持つ。 */
type SessionBuffer = {chunks: string[]; length: number};

/** 1-based の並び順をターミナル番号（1 or 2）に丸める */
function toTerminalSlot(position: number): TerminalSlot {
  return position >= 2 ? 2 : 1;
}

// ============================================================================
// Session State Manager
// ============================================================================

export class SessionStateManager {
  activeSessionId: string | undefined;
  sessionIds: string[];
  sessionMeta: Record<string, SessionMeta>;
  totalSessions: number;
  /**
   * Per-session scrollback kept for pane reassignment.
   *
   * Chunks are stored as received and only joined when a pane actually needs
   * them. Keeping a single concatenated string meant every chunk past the cap
   * re-sliced MAX_BUFFER_SIZE characters, so a burst of output paid a
   * multi-megabyte copy per chunk.
   */
  private readonly buffers = new Map<string, SessionBuffer>();
  /** Runs 300ms after the last appendToBuffer call so bursts are batched */
  private readonly debouncedCleanup: DebouncedFunction<() => void>;

  constructor(savedState: ViewState) {
    this.activeSessionId = savedState.activeSessionId;
    this.totalSessions = savedState.totalSessions ?? 0;
    this.sessionIds = Array.isArray(savedState.sessionIds)
      ? savedState.sessionIds.filter((id): id is string => typeof id === 'string')
      : [];
    this.sessionMeta = savedState.sessionMeta ?? {};

    // Initialize buffers for existing sessions
    this.sessionIds.forEach((id, index) => {
      this.buffers.set(id, {chunks: [], length: 0});
      const slot = toTerminalSlot(index + 1);
      const restored = this.sessionMeta[id];
      this.sessionMeta[id] = restored
        ? {...restored, slot: restored.slot ?? slot}
        : {shell: 'Shell', label: `Terminal ${slot}`, slot};
    });

    this.debouncedCleanup = debounce(() => this.dropOrphanedBuffers(), 300);
  }

  getSessionLabel(sessionId: string, fallbackIndex?: number): string {
    return (
      this.sessionMeta[sessionId]?.label ??
      (typeof fallbackIndex === 'number'
        ? `Terminal ${fallbackIndex + 1}`
        : sessionId)
    );
  }

  addSession(
    id: string,
    shell: string,
    label?: string,
    slot?: TerminalSlot
  ): void {
    this.sessionIds = this.sessionIds.filter((sid) => sid !== id);
    this.sessionIds.push(id);
    const resolvedSlot = slot ?? toTerminalSlot(this.sessionIds.length);
    this.sessionMeta[id] = {
      shell,
      label: label ?? `Terminal ${resolvedSlot}`,
      slot: resolvedSlot,
    };
    this.buffers.set(id, {chunks: [], length: 0});
  }

  /** テーマ適用に使うターミナル番号。未知のセッションは undefined。 */
  getSessionSlot(sessionId: string | undefined): TerminalSlot | undefined {
    if (!sessionId) {
      return undefined;
    }
    return this.sessionMeta[sessionId]?.slot;
  }

  removeSession(sessionId: string): void {
    this.sessionIds = this.sessionIds.filter((id) => id !== sessionId);
    delete this.sessionMeta[sessionId];
    this.buffers.delete(sessionId);
    this.debouncedCleanup.flush();
  }

  clearAll(): void {
    this.debouncedCleanup.cancel();
    this.sessionIds = [];
    this.sessionMeta = {};
    this.activeSessionId = undefined;
    this.totalSessions = 0;
    this.buffers.clear();
  }

  ensureActiveSession(): boolean {
    if (this.activeSessionId && this.sessionIds.includes(this.activeSessionId)) {
      return false;
    }
    this.activeSessionId = this.sessionIds[this.sessionIds.length - 1];
    return true;
  }

  // Buffer management
  appendToBuffer(sessionId: string, chunk: string): void {
    if (!chunk) {
      return;
    }
    let buffer = this.buffers.get(sessionId);
    if (!buffer) {
      buffer = {chunks: [], length: 0};
      this.buffers.set(sessionId, buffer);
    }
    buffer.chunks.push(chunk);
    buffer.length += chunk.length;

    // Trim from the front until the cap holds. Whole chunks are dropped by
    // reference; at most one slice runs per call, and it only ever copies the
    // head chunk - never the whole MAX_BUFFER_SIZE window.
    let overflow = buffer.length - SHARED_CONSTANTS.MAX_BUFFER_SIZE;
    while (overflow > 0) {
      const head = buffer.chunks[0];
      if (head.length <= overflow) {
        buffer.chunks.shift();
        buffer.length -= head.length;
        overflow -= head.length;
      } else {
        buffer.chunks[0] = head.slice(overflow);
        buffer.length -= overflow;
        overflow = 0;
      }
    }

    this.debouncedCleanup();
  }

  getBuffer(sessionId: string): string | undefined {
    const buffer = this.buffers.get(sessionId);
    if (!buffer) {
      return undefined;
    }
    // Collapse to one chunk so a repeated pane switch does not re-join.
    if (buffer.chunks.length > 1) {
      buffer.chunks = [buffer.chunks.join('')];
    }
    return buffer.chunks[0] ?? '';
  }

  private dropOrphanedBuffers(): void {
    for (const key of this.buffers.keys()) {
      if (!this.sessionIds.includes(key)) {
        this.buffers.delete(key);
      }
    }
  }

  toViewState(uiState: UIStateManager): ViewState {
    // Only persist metadata for currently active sessions to prevent unbounded growth
    const activeMeta: Record<string, SessionMeta> = {};
    for (const id of this.sessionIds) {
      if (this.sessionMeta[id]) {
        activeMeta[id] = this.sessionMeta[id];
      }
    }

    return {
      activeSessionId: this.activeSessionId,
      totalSessions: this.totalSessions,
      sessionIds: this.sessionIds,
      terminalHeight: uiState.terminalHeight,
      sessionMeta: activeMeta,
      viewMode: uiState.viewMode,
      splitRatio: uiState.splitRatio,
    };
  }
}

// ============================================================================
// UI State Manager
// ============================================================================

export class UIStateManager {
  pendingSessionRequest = false;
  clearingAll = false;
  confirmingClearAll = false;
  viewMode: ViewMode;
  private _terminalHeight: number;
  private _splitRatio: number;
  readonly paneSessions: Record<Pane, string | undefined> = {
    primary: undefined,
    secondary: undefined,
  };

  constructor(savedState: ViewState) {
    this._terminalHeight = validateTerminalHeight(savedState.terminalHeight);
    this.viewMode = savedState.viewMode === 'split' ? 'split' : 'single';
    this._splitRatio = clampSplitRatio(
      typeof savedState.splitRatio === 'number'
        ? savedState.splitRatio
        : SHARED_CONSTANTS.SPLIT_VIEW.DEFAULT_RATIO
    );
  }

  get terminalHeight(): number {
    return this._terminalHeight;
  }

  set terminalHeight(value: number) {
    this._terminalHeight = validateTerminalHeight(value);
  }

  get splitRatio(): number {
    return this._splitRatio;
  }

  set splitRatio(value: number) {
    this._splitRatio = clampSplitRatio(value);
  }

  isSplitModeActive(): boolean {
    return (
      this.viewMode === 'split' &&
      Boolean(this.paneSessions.primary && this.paneSessions.secondary)
    );
  }

  getPaneForSession(sessionId?: string): Pane | undefined {
    if (!sessionId) {
      return undefined;
    }
    return PANES.find((pane) => this.paneSessions[pane] === sessionId);
  }

  resetClearAllState(): void {
    this.clearingAll = false;
    this.pendingSessionRequest = false;
    this.confirmingClearAll = false;
  }
}

// ============================================================================
// Theme State Manager
// ============================================================================

export class ThemeStateManager {
  availablePresets: ThemePresetInfo[] = [];
  /** ターミナル番号ごとのテーマ。Extension から theme-update で届く。 */
  slotThemes: Partial<Record<TerminalSlot, ThemeSlotSnapshot>> = {};

  getSlotTheme(slot: TerminalSlot | undefined): ThemeSlotSnapshot | undefined {
    if (!slot) {
      return undefined;
    }
    return this.slotThemes[slot];
  }

  /** ペインにセッションが無いときなどに使う既定テーマ（Terminal 1） */
  getBaseTheme(): ThemeSlotSnapshot | undefined {
    return this.slotThemes[1];
  }

  getPresetInfo(presetKey: string | undefined): ThemePresetInfo | undefined {
    if (!presetKey) {
      return undefined;
    }
    return this.availablePresets.find((preset) => preset.key === presetKey);
  }
}
