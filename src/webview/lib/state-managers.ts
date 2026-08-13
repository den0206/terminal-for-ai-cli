import {SHARED_CONSTANTS} from '../../shared/constants';
import type {SessionMeta, ThemePresetInfo} from '../../shared/types';
import {PANES, type Pane, type ViewMode, type ViewState} from './types';
import {
  clampSplitRatio,
  debounce,
  validateTerminalHeight,
  type DebouncedFunction,
} from './utils';

// ============================================================================
// Session State Manager
// ============================================================================

export class SessionStateManager {
  activeSessionId: string | undefined;
  sessionIds: string[];
  sessionMeta: Record<string, SessionMeta>;
  totalSessions: number;
  private readonly buffers = new Map<string, string>();
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
      this.buffers.set(id, '');
      this.sessionMeta[id] = this.sessionMeta[id] ?? {
        shell: 'Shell',
        label: `Terminal ${index + 1}`,
      };
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

  addSession(id: string, shell: string, label?: string): void {
    this.sessionIds = this.sessionIds.filter((sid) => sid !== id);
    this.sessionIds.push(id);
    this.sessionMeta[id] = {
      shell,
      label: label ?? `Terminal ${this.sessionIds.length}`,
    };
    this.buffers.set(id, '');
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
    const next = (this.buffers.get(sessionId) ?? '') + chunk;
    this.buffers.set(
      sessionId,
      next.length > SHARED_CONSTANTS.MAX_BUFFER_SIZE
        ? next.slice(next.length - SHARED_CONSTANTS.MAX_BUFFER_SIZE)
        : next
    );
    this.debouncedCleanup();
  }

  getBuffer(sessionId: string): string | undefined {
    return this.buffers.get(sessionId);
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
  currentThemeKey: string | undefined;
  availablePresets: ThemePresetInfo[] = [];

  getActivePreset(): ThemePresetInfo | undefined {
    return this.availablePresets.find(
      (preset) => preset.key === this.currentThemeKey
    );
  }
}
