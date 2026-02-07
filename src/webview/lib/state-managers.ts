import type {SessionMeta, ThemePresetInfo} from '../../shared/types';
import {Constants} from './constants';
import type {Pane, ViewMode, ViewState} from './types';
import {
  clampSplitRatio,
  debounce,
  validateTerminalHeight,
  type CancellableFunction,
} from './utils';

// ============================================================================
// Session State Manager
// ============================================================================

export class SessionStateManager {
  private _activeSessionId: string | undefined;
  private _sessionIds: string[] = [];
  private _sessionMeta: Record<string, SessionMeta> = {};
  private _totalSessions = 0;
  private readonly _buffers = new Map<string, string>();
  private readonly _debouncedCleanup: CancellableFunction<() => void>;

  constructor(savedState: ViewState) {
    this._activeSessionId = savedState.activeSessionId;
    this._totalSessions = savedState.totalSessions ?? 0;
    this._sessionIds = Array.isArray(savedState.sessionIds)
      ? savedState.sessionIds.filter(
          (id): id is string => typeof id === 'string'
        )
      : [];
    this._sessionMeta = savedState.sessionMeta ?? {};

    // Initialize buffers for existing sessions
    this._sessionIds.forEach((id, index) => {
      if (!this._buffers.has(id)) {
        this._buffers.set(id, '');
      }
      this._sessionMeta[id] =
        this._sessionMeta[id] ??
        ({shell: 'Shell', label: `Terminal ${index + 1}`} as SessionMeta);
    });

    // Debounce buffer cleanup to avoid performance issues during high-frequency updates
    // Cleanup runs 300ms after the last appendToBuffer call
    // This is short enough to be responsive but long enough to batch rapid updates
    this._debouncedCleanup = debounce(() => {
      this.cleanupOldBuffers();
    }, 300);
  }

  get activeSessionId(): string | undefined {
    return this._activeSessionId;
  }

  set activeSessionId(value: string | undefined) {
    this._activeSessionId = value;
  }

  get sessionIds(): string[] {
    return this._sessionIds;
  }

  get totalSessions(): number {
    return this._totalSessions;
  }

  set totalSessions(value: number) {
    this._totalSessions = value;
  }

  get sessionMeta(): Record<string, SessionMeta> {
    return this._sessionMeta;
  }

  getSessionLabel(sessionId: string, fallbackIndex?: number): string {
    return (
      this._sessionMeta[sessionId]?.label ??
      (typeof fallbackIndex === 'number'
        ? `Terminal ${fallbackIndex + 1}`
        : sessionId)
    );
  }

  addSession(id: string, shell: string, label?: string): void {
    this._sessionIds = this._sessionIds.filter((sid) => sid !== id);
    this._sessionIds.push(id);
    this._sessionMeta[id] = {
      shell,
      label: label ?? `Terminal ${this._sessionIds.length}`,
    };
    this._buffers.set(id, '');
  }

  removeSession(sessionId: string): void {
    this._sessionIds = this._sessionIds.filter((id) => id !== sessionId);
    delete this._sessionMeta[sessionId];
    this._buffers.delete(sessionId);
  }

  clearAll(): void {
    // Cancel pending cleanup operations
    this._debouncedCleanup.cancel();
    this._sessionIds = [];
    this._sessionMeta = {};
    this._activeSessionId = undefined;
    this._totalSessions = 0;
    this._buffers.clear();
  }

  ensureActiveSession(): boolean {
    if (
      this._activeSessionId &&
      this._sessionIds.includes(this._activeSessionId)
    ) {
      return false;
    }
    const fallbackId = this._sessionIds[this._sessionIds.length - 1];
    this._activeSessionId = fallbackId;
    return true;
  }

  // Buffer management
  appendToBuffer(sessionId: string, chunk: string): void {
    const current = this._buffers.get(sessionId) ?? '';
    let next = current + chunk;
    if (next.length > Constants.MAX_BUFFER_SIZE) {
      next = next.slice(next.length - Constants.MAX_BUFFER_SIZE);
    }
    this._buffers.set(sessionId, next);
    // Use debounced cleanup to avoid performance issues during high-frequency updates
    this._debouncedCleanup();
  }

  getBuffer(sessionId: string): string | undefined {
    return this._buffers.get(sessionId);
  }

  private cleanupOldBuffers(): void {
    // Immediately remove orphaned buffers (not in active sessions)
    // This is more aggressive than waiting for MAX_BUFFER_COUNT to be exceeded
    for (const key of this._buffers.keys()) {
      if (!this._sessionIds.includes(key)) {
        this._buffers.delete(key);
      }
    }

    // Failsafe: If we still exceed MAX_BUFFER_COUNT (shouldn't happen in practice),
    // remove the oldest buffers based on insertion order
    if (this._buffers.size > Constants.MAX_BUFFER_COUNT) {
      const keysToRemove = Array.from(this._buffers.keys()).slice(
        0,
        this._buffers.size - Constants.MAX_BUFFER_COUNT
      );
      for (const key of keysToRemove) {
        this._buffers.delete(key);
      }
    }
  }

  toViewState(uiState: UIStateManager): ViewState {
    // Only persist metadata for currently active sessions to prevent unbounded growth
    const activeMeta: Record<string, SessionMeta> = {};
    for (const id of this._sessionIds) {
      if (this._sessionMeta[id]) {
        activeMeta[id] = this._sessionMeta[id];
      }
    }

    return {
      activeSessionId: this._activeSessionId,
      totalSessions: this._totalSessions,
      sessionIds: this._sessionIds,
      terminalHeight: uiState.terminalHeight,
      sessionMeta: activeMeta, // Only active sessions, not historical data
      viewMode: uiState.viewMode,
      splitRatio: uiState.splitRatio,
    };
  }
}

// ============================================================================
// UI State Manager
// ============================================================================

export class UIStateManager {
  private _pendingSessionRequest = false;
  private _clearingAll = false;
  private _confirmingClearAll = false;
  private _terminalHeight: number;
  private _viewMode: ViewMode;
  private _splitRatio: number;
  readonly paneSessions: Record<Pane, string | undefined> = {
    primary: undefined,
    secondary: undefined,
  };

  constructor(savedState: ViewState) {
    this._terminalHeight = validateTerminalHeight(savedState.terminalHeight);
    this._viewMode = savedState.viewMode === 'split' ? 'split' : 'single';
    this._splitRatio = clampSplitRatio(
      typeof savedState.splitRatio === 'number' ? savedState.splitRatio : 0.5
    );
  }

  get pendingSessionRequest(): boolean {
    return this._pendingSessionRequest;
  }

  set pendingSessionRequest(value: boolean) {
    this._pendingSessionRequest = value;
  }

  get clearingAll(): boolean {
    return this._clearingAll;
  }

  set clearingAll(value: boolean) {
    this._clearingAll = value;
  }

  get confirmingClearAll(): boolean {
    return this._confirmingClearAll;
  }

  set confirmingClearAll(value: boolean) {
    this._confirmingClearAll = value;
  }

  get terminalHeight(): number {
    return this._terminalHeight;
  }

  set terminalHeight(value: number) {
    this._terminalHeight = validateTerminalHeight(value);
  }

  get viewMode(): ViewMode {
    return this._viewMode;
  }

  set viewMode(value: ViewMode) {
    this._viewMode = value;
  }

  get splitRatio(): number {
    return this._splitRatio;
  }

  set splitRatio(value: number) {
    this._splitRatio = clampSplitRatio(value);
  }

  isSplitModeActive(): boolean {
    return (
      this._viewMode === 'split' &&
      Boolean(this.paneSessions.primary && this.paneSessions.secondary)
    );
  }

  getPaneForSession(sessionId?: string): Pane | undefined {
    if (!sessionId) {
      return undefined;
    }
    return (['primary', 'secondary'] as const).find(
      (pane) => this.paneSessions[pane] === sessionId
    );
  }

  resetClearAllState(): void {
    this._clearingAll = false;
    this._pendingSessionRequest = false;
    this._confirmingClearAll = false;
  }
}

// ============================================================================
// Theme State Manager
// ============================================================================

export class ThemeStateManager {
  private _currentThemeKey: string | undefined;
  private _availablePresets: ThemePresetInfo[] = [];

  get currentThemeKey(): string | undefined {
    return this._currentThemeKey;
  }

  set currentThemeKey(value: string | undefined) {
    this._currentThemeKey = value;
  }

  get availablePresets(): ThemePresetInfo[] {
    return this._availablePresets;
  }

  set availablePresets(value: ThemePresetInfo[]) {
    this._availablePresets = value;
  }

  getActivePreset(): ThemePresetInfo | undefined {
    return this._availablePresets.find(
      (preset) => preset.key === this._currentThemeKey
    );
  }
}
