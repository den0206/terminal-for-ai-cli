import {FitAddon} from '@xterm/addon-fit';
import {Terminal} from '@xterm/xterm';

// ============================================================================
// Types
// ============================================================================

interface VSCodeApi<State = unknown> {
  postMessage<T = unknown>(message: T): void;
  setState(state: State): void;
  getState(): State | undefined;
}

declare const acquireVsCodeApi: <State = undefined>() => VSCodeApi<State>;

type ThemePalette = {
  background: string;
  foreground: string;
  cursor: string;
  selection: string;
};

type ThemePresetInfo = {
  key: string;
  label: string;
  description: string;
  preview: {background: string; foreground: string};
};

type ThemeUpdatePayload = {
  presetKey: string;
  palette: ThemePalette;
  presets: ThemePresetInfo[];
};

type ViewMode = 'single' | 'split';
type Pane = 'primary' | 'secondary';

type InboundMessage =
  | {type: 'session-count'; payload: {total: number}}
  | {
      type: 'session-created';
      payload: {
        id: string;
        shell: string;
        pid?: number;
        label?: string;
        restored?: boolean;
      };
    }
  | {type: 'session-data'; payload: {sessionId: string; data: string}}
  | {
      type: 'session-exited';
      payload: {sessionId: string; code: number | null; signal: string | null};
    }
  | {type: 'session-error'; payload: {message: string}}
  | {type: 'session-limit-reached'; payload: {max: number}}
  | {type: 'theme-update'; payload: ThemeUpdatePayload}
  | {type: 'all-sessions-cleared'};

type OutboundMessage =
  | {type: 'webview-ready'}
  | {type: 'request-new-session'; payload?: {cols: number; rows: number}}
  | {type: 'terminal-input'; payload: {sessionId: string; data: string}}
  | {
      type: 'terminal-resize';
      payload: {sessionId: string; cols: number; rows: number};
    }
  | {type: 'dispose-session'; payload: {sessionId: string}}
  | {type: 'dispose-all-sessions'}
  | {type: 'theme-select'; payload: {presetKey: string}}
  | {
      type: 'image-drop';
      payload: {
        fileName: string;
        mimeType: string;
        data: string;
        sessionId: string;
      };
    };

type SessionMeta = {shell: string; label: string};

type ViewState = {
  activeSessionId?: string;
  totalSessions: number;
  sessionIds: string[];
  terminalHeight?: number;
  sessionMeta?: Record<string, SessionMeta>;
  viewMode?: ViewMode;
  splitRatio?: number;
};

type PaneContext = {terminal: Terminal; fitAddon: FitAddon};

// ============================================================================
// Constants
// ============================================================================

const Constants = {
  MAX_SESSIONS: 2,
  MIN_SPLIT_RATIO: 0.2,
  MAX_SPLIT_RATIO: 0.8,
  MAX_IMAGE_SIZE_BYTES: 10 * 1024 * 1024, // 10MB
  MAX_BUFFER_SIZE: 200_000,
  MAX_BUFFER_COUNT: 10,
  MIN_TERMINAL_HEIGHT: 220,
  MAX_TERMINAL_HEIGHT: 1000,
  DEFAULT_TERMINAL_HEIGHT: 640,
} as const;

// ============================================================================
// Utility Functions
// ============================================================================

type CancellableFunction<T extends (...args: never[]) => void> = ((
  ...args: Parameters<T>
) => void) & {cancel: () => void};

function debounce<T extends (...args: never[]) => void>(
  fn: T,
  delay: number
): CancellableFunction<T> {
  let handle: number | undefined;
  const debounced = (...args: Parameters<T>) => {
    if (handle) {
      clearTimeout(handle);
    }
    handle = window.setTimeout(() => {
      fn(...args);
      handle = undefined;
    }, delay);
  };
  debounced.cancel = () => {
    if (handle) {
      clearTimeout(handle);
      handle = undefined;
    }
  };
  return debounced;
}

function throttle<T extends (...args: never[]) => void>(
  fn: T,
  delay: number
): CancellableFunction<T> {
  let lastCall = 0;
  let timeoutHandle: number | undefined;
  const throttled = (...args: Parameters<T>) => {
    const now = Date.now();
    const timeSinceLastCall = now - lastCall;

    if (timeSinceLastCall >= delay) {
      lastCall = now;
      fn(...args);
    } else {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      timeoutHandle = window.setTimeout(() => {
        lastCall = Date.now();
        fn(...args);
        timeoutHandle = undefined;
      }, delay - timeSinceLastCall);
    }
  };
  throttled.cancel = () => {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = undefined;
    }
  };
  return throttled;
}

function getComputedVar(
  name: string,
  fallbackVar?: string,
  fallbackValue?: string
): string {
  const styles = getComputedStyle(document.documentElement);
  const value = styles.getPropertyValue(name)?.trim();
  if (value) {
    return value;
  }
  if (fallbackVar) {
    const nested = styles.getPropertyValue(fallbackVar)?.trim();
    if (nested) {
      return nested;
    }
  }
  return fallbackValue ?? '';
}

function validateTerminalHeight(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return Constants.DEFAULT_TERMINAL_HEIGHT;
  }
  return Math.min(
    Constants.MAX_TERMINAL_HEIGHT,
    Math.max(Constants.MIN_TERMINAL_HEIGHT, value)
  );
}

function clampSplitRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.5;
  }
  return Math.min(
    Constants.MAX_SPLIT_RATIO,
    Math.max(Constants.MIN_SPLIT_RATIO, value)
  );
}

function isValidViewState(state: unknown): state is ViewState {
  if (!state || typeof state !== 'object') {
    return false;
  }
  const s = state as Record<string, unknown>;
  return (
    (s.totalSessions === undefined || typeof s.totalSessions === 'number') &&
    (s.sessionIds === undefined || Array.isArray(s.sessionIds)) &&
    (s.activeSessionId === undefined ||
      typeof s.activeSessionId === 'string') &&
    (s.terminalHeight === undefined || typeof s.terminalHeight === 'number') &&
    (s.sessionMeta === undefined ||
      (typeof s.sessionMeta === 'object' && s.sessionMeta !== null)) &&
    (s.viewMode === undefined ||
      s.viewMode === 'single' ||
      s.viewMode === 'split') &&
    (s.splitRatio === undefined || typeof s.splitRatio === 'number')
  );
}

// ============================================================================
// DOM Elements Manager
// ============================================================================

class DOMElements {
  readonly status = document.querySelector(
    '[data-session-status]'
  ) as HTMLSpanElement | null;
  readonly addSessionButton = document.querySelector(
    '[data-session-add]'
  ) as HTMLButtonElement | null;
  readonly viewToggleButton = document.querySelector(
    '[data-view-toggle]'
  ) as HTMLButtonElement | null;
  readonly viewToggleIcon = document.querySelector(
    '[data-view-toggle-icon]'
  ) as HTMLSpanElement | null;
  readonly removeSessionButton = document.querySelector(
    '[data-session-remove]'
  ) as HTMLButtonElement | null;
  readonly terminalShell = document.querySelector(
    '[data-terminal-shell]'
  ) as HTMLDivElement | null;
  readonly terminalStack = document.querySelector(
    '[data-terminal-stack]'
  ) as HTMLDivElement | null;
  readonly splitResizer = document.querySelector(
    '[data-split-resizer]'
  ) as HTMLDivElement | null;
  readonly resizer = document.querySelector(
    '[data-terminal-resizer]'
  ) as HTMLDivElement | null;
  readonly sessionSelect = document.querySelector(
    '[data-session-select]'
  ) as HTMLSelectElement | null;
  readonly themeSelect = document.querySelector(
    '[data-theme-select]'
  ) as HTMLSelectElement | null;
  readonly themeActiveLabel = document.querySelector(
    '[data-theme-active-label]'
  ) as HTMLSpanElement | null;
  readonly themePreviewText = document.querySelector(
    '[data-theme-preview-text]'
  ) as HTMLSpanElement | null;
  readonly themePreviewSwatch = document.querySelector(
    '[data-theme-swatch]'
  ) as HTMLSpanElement | null;
  readonly clearAllButton = document.querySelector(
    '[data-session-clear-all]'
  ) as HTMLButtonElement | null;
  readonly clearAllConfirm = document.querySelector(
    '[data-clear-all-confirm]'
  ) as HTMLDivElement | null;
  readonly clearAllConfirmAccept = document.querySelector(
    '[data-clear-all-confirm-accept]'
  ) as HTMLButtonElement | null;
  readonly clearAllConfirmCancel = document.querySelector(
    '[data-clear-all-confirm-cancel]'
  ) as HTMLButtonElement | null;

  readonly paneElements: Record<Pane, HTMLDivElement | null> = {
    primary: document.querySelector(
      '[data-terminal-pane="primary"]'
    ) as HTMLDivElement | null,
    secondary: document.querySelector(
      '[data-terminal-pane="secondary"]'
    ) as HTMLDivElement | null,
  };

  readonly paneLabels: Record<Pane, HTMLSpanElement | null> = {
    primary: document.querySelector(
      '[data-pane-label="primary"]'
    ) as HTMLSpanElement | null,
    secondary: document.querySelector(
      '[data-pane-label="secondary"]'
    ) as HTMLSpanElement | null,
  };

  readonly paneRoots: Record<Pane, HTMLDivElement | null> = {
    primary: document.querySelector(
      '[data-terminal-root="primary"]'
    ) as HTMLDivElement | null,
    secondary: document.querySelector(
      '[data-terminal-root="secondary"]'
    ) as HTMLDivElement | null,
  };
}

// ============================================================================
// Session State Manager
// ============================================================================

class SessionStateManager {
  private _activeSessionId: string | undefined;
  private _sessionIds: string[] = [];
  private _sessionMeta: Record<string, SessionMeta> = {};
  private _totalSessions = 0;
  private readonly _buffers = new Map<string, string>();

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
    this._sessionIds = [];
    this._sessionMeta = {};
    this._activeSessionId = undefined;
    this._totalSessions = 0;
    this._buffers.clear();
  }

  ensureActiveSession(): boolean {
    if (this._activeSessionId && this._sessionIds.includes(this._activeSessionId)) {
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
    this.cleanupOldBuffers();
  }

  getBuffer(sessionId: string): string | undefined {
    return this._buffers.get(sessionId);
  }

  private cleanupOldBuffers(): void {
    if (this._buffers.size <= Constants.MAX_BUFFER_COUNT) {
      return;
    }

    const keysToRemove: string[] = [];
    for (const key of this._buffers.keys()) {
      if (!this._sessionIds.includes(key)) {
        keysToRemove.push(key);
      }
    }

    const excessCount = this._buffers.size - Constants.MAX_BUFFER_COUNT;
    for (let i = 0; i < Math.min(keysToRemove.length, excessCount); i++) {
      this._buffers.delete(keysToRemove[i]);
    }
  }

  toViewState(uiState: UIStateManager, _themeState: ThemeStateManager): ViewState {
    return {
      activeSessionId: this._activeSessionId,
      totalSessions: this._totalSessions,
      sessionIds: this._sessionIds,
      terminalHeight: uiState.terminalHeight,
      sessionMeta: this._sessionMeta,
      viewMode: uiState.viewMode,
      splitRatio: uiState.splitRatio,
    };
  }
}

// ============================================================================
// UI State Manager
// ============================================================================

class UIStateManager {
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

class ThemeStateManager {
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

// ============================================================================
// Terminal Manager
// ============================================================================

class TerminalManager {
  readonly paneContexts: Record<Pane, PaneContext>;

  constructor(
    private readonly dom: DOMElements,
    private readonly uiState: UIStateManager,
    private readonly postMessage: (message: OutboundMessage) => void
  ) {
    this.paneContexts = {
      primary: this.createPaneContext('primary'),
      secondary: this.createPaneContext('secondary'),
    };
  }

  private createTerminalInstance(): Terminal {
    return new Terminal({
      allowTransparency: true,
      convertEol: true,
      cursorBlink: true,
      scrollback: 2000,
      fontFamily: getComputedVar(
        '--vscode-editor-font-family',
        'var(--monaco-monospace-font)',
        'monospace'
      ),
      fontSize:
        Number.parseInt(
          getComputedVar('--vscode-editor-font-size', undefined, '13'),
          10
        ) || 13,
      theme: {
        background: getComputedVar(
          '--vscode-editor-background',
          undefined,
          '#1e1e1e'
        ),
        foreground: getComputedVar(
          '--vscode-editor-foreground',
          undefined,
          '#cccccc'
        ),
        cursor: getComputedVar(
          '--vscode-terminalCursor-foreground',
          undefined,
          '#ffffff'
        ),
        selectionBackground: getComputedVar(
          '--vscode-editor-selectionBackground',
          undefined,
          'rgba(255,255,255,0.15)'
        ),
      },
    });
  }

  private createPaneContext(pane: Pane): PaneContext {
    const terminal = this.createTerminalInstance();
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    const root = this.dom.paneRoots[pane];
    if (root) {
      terminal.open(root);
    }
    terminal.onData((data) => {
      const sessionId = this.uiState.paneSessions[pane];
      if (sessionId) {
        this.postMessage({
          type: 'terminal-input',
          payload: {sessionId, data},
        });
      }
    });
    return {terminal, fitAddon};
  }

  getPaneDimensions(pane: Pane): {cols: number; rows: number} {
    const context = this.paneContexts[pane];
    return {
      cols: context.terminal.cols || 80,
      rows: context.terminal.rows || 24,
    };
  }

  fitVisibleTerminals(): void {
    (['primary', 'secondary'] as const).forEach((pane) => {
      const context = this.paneContexts[pane];
      const isVisible =
        pane === 'primary'
          ? Boolean(this.uiState.paneSessions.primary)
          : this.dom.paneElements[pane]?.getAttribute('data-pane-visible') ===
            'true';
      if (isVisible) {
        context.fitAddon.fit();
      }
    });
  }

  refreshTheme(): void {
    const theme = {
      background: getComputedVar(
        '--terminal-bg',
        '--vscode-editor-background',
        '#1e1e1e'
      ),
      foreground: getComputedVar(
        '--terminal-fg',
        '--vscode-editor-foreground',
        '#cccccc'
      ),
      cursor: getComputedVar(
        '--terminal-cursor',
        '--vscode-terminalCursor-foreground',
        '#ffffff'
      ),
      selectionBackground: getComputedVar(
        '--terminal-selection',
        '--vscode-editor-selectionBackground',
        'rgba(255,255,255,0.15)'
      ),
    };
    (['primary', 'secondary'] as const).forEach((pane) => {
      this.paneContexts[pane].terminal.options.theme = {...theme};
    });
  }

  writeBufferToTerminal(sessionId: string, buffer: string | undefined): void {
    const pane = this.uiState.getPaneForSession(sessionId);
    if (pane && buffer) {
      this.paneContexts[pane].terminal.write(buffer);
    }
  }

  resetTerminal(pane: Pane): void {
    this.paneContexts[pane].terminal.reset();
  }

  writeToTerminal(pane: Pane, data: string): void {
    this.paneContexts[pane].terminal.write(data);
  }

  scrollToBottom(pane: Pane): void {
    this.paneContexts[pane].terminal.scrollToBottom();
  }

  focusTerminal(pane: Pane): void {
    this.paneContexts[pane].terminal.focus();
  }

  deliverDataToPanes(sessionId: string, chunk: string): void {
    (['primary', 'secondary'] as const).forEach((pane) => {
      if (this.uiState.paneSessions[pane] === sessionId) {
        this.paneContexts[pane].terminal.write(chunk);
      }
    });
  }
}

// ============================================================================
// Application Controller
// ============================================================================

class AppController {
  private readonly vscode: VSCodeApi<ViewState>;
  private readonly dom: DOMElements;
  private readonly sessionState: SessionStateManager;
  private readonly uiState: UIStateManager;
  private readonly themeState: ThemeStateManager;
  private readonly terminalManager: TerminalManager;
  private readonly throttledResize: CancellableFunction<() => void>;
  private readonly debouncedResize: CancellableFunction<() => void>;

  constructor() {
    this.vscode = acquireVsCodeApi<ViewState>();
    this.dom = new DOMElements();

    const rawSavedState = this.vscode.getState();
    const savedState: ViewState = isValidViewState(rawSavedState)
      ? rawSavedState
      : {totalSessions: 0, sessionIds: []};

    this.sessionState = new SessionStateManager(savedState);
    this.uiState = new UIStateManager(savedState);
    this.themeState = new ThemeStateManager();
    this.terminalManager = new TerminalManager(
      this.dom,
      this.uiState,
      (msg) => this.vscode.postMessage(msg)
    );

    this.throttledResize = throttle(() => {
      this.terminalManager.fitVisibleTerminals();
      this.notifyResize();
    }, 100);

    this.debouncedResize = debounce(() => {
      this.terminalManager.fitVisibleTerminals();
      this.notifyResize();
    }, 150);

    this.initialize();
  }

  private initialize(): void {
    this.setupEventListeners();
    this.applyTerminalHeight(this.uiState.terminalHeight, false);
    this.terminalManager.refreshTheme();
    this.syncPaneAssignments(true);
    this.focusActivePane();

    this.vscode.postMessage<OutboundMessage>({type: 'webview-ready'});
    if (this.sessionState.activeSessionId) {
      this.setStatus(
        `Restoring session ${this.sessionState.activeSessionId}...`
      );
      this.notifyResize();
    } else {
      this.setStatus('Initializing session...');
    }
    this.updateSessionControls();
  }

  private setupEventListeners(): void {
    window.addEventListener(
      'message',
      (event: MessageEvent<InboundMessage>) => {
        this.handleMessage(event.data);
      }
    );

    this.dom.addSessionButton?.addEventListener('click', () => {
      this.requestNewSession();
    });

    this.dom.viewToggleButton?.addEventListener('click', () => {
      if (this.dom.viewToggleButton?.disabled) {
        return;
      }
      if (
        this.uiState.viewMode === 'single' &&
        this.sessionState.sessionIds.length < 2
      ) {
        this.setStatus('Add a second session to enable split view.');
        return;
      }
      this.setViewMode(
        this.uiState.viewMode === 'single' ? 'split' : 'single'
      );
    });

    this.dom.removeSessionButton?.addEventListener('click', () => {
      if (
        !this.sessionState.activeSessionId ||
        this.uiState.pendingSessionRequest
      ) {
        return;
      }
      this.setStatus('Ending session...');
      this.updateSessionControls();
      this.vscode.postMessage<OutboundMessage>({
        type: 'dispose-session',
        payload: {sessionId: this.sessionState.activeSessionId},
      });
    });

    this.dom.clearAllButton?.addEventListener('click', () => {
      if (
        this.uiState.pendingSessionRequest ||
        this.uiState.clearingAll ||
        this.sessionState.sessionIds.length === 0
      ) {
        return;
      }
      if (!this.uiState.confirmingClearAll) {
        this.uiState.confirmingClearAll = true;
        this.toggleClearAllConfirm(true);
      }
    });

    this.dom.clearAllConfirmAccept?.addEventListener('click', () => {
      if (
        this.uiState.pendingSessionRequest ||
        this.uiState.clearingAll ||
        this.sessionState.sessionIds.length === 0
      ) {
        return;
      }
      this.uiState.confirmingClearAll = false;
      this.toggleClearAllConfirm(false);
      this.uiState.clearingAll = true;
      this.setStatus('Clearing all sessions...');
      this.updateSessionControls();
      this.vscode.postMessage<OutboundMessage>({type: 'dispose-all-sessions'});
    });

    this.dom.clearAllConfirmCancel?.addEventListener('click', () => {
      this.uiState.confirmingClearAll = false;
      this.toggleClearAllConfirm(false);
    });

    this.dom.sessionSelect?.addEventListener('change', () => {
      const nextSessionId = this.dom.sessionSelect?.value;
      if (!nextSessionId || nextSessionId === this.sessionState.activeSessionId) {
        return;
      }
      this.switchActiveSession(
        nextSessionId,
        `Switched to ${this.sessionState.getSessionLabel(nextSessionId)}`
      );
    });

    window.addEventListener('resize', () => {
      this.throttledResize();
      this.debouncedResize();
    });

    this.setupResizer();
    this.setupSplitResizer();
    this.setupThemeSelect();
    this.setupPaneFocus();
    this.setupImageDragAndDrop();
  }

  private setupResizer(): void {
    this.dom.resizer?.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      const pointerId = event.pointerId;
      const startY = event.clientY;
      const startHeight = this.uiState.terminalHeight;

      const throttledMove = throttle((delta: number) => {
        this.applyTerminalHeight(startHeight + delta, false);
      }, 16);

      const onMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) {
          return;
        }
        const delta = moveEvent.clientY - startY;
        throttledMove(delta);
      };

      const cleanup = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) {
          return;
        }
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', cleanup);
        window.removeEventListener('pointercancel', cleanup);
        this.persistState();
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', cleanup);
      window.addEventListener('pointercancel', cleanup);
    });
  }

  private setupSplitResizer(): void {
    this.dom.splitResizer?.addEventListener('pointerdown', (event) => {
      if (!this.uiState.isSplitModeActive()) {
        return;
      }
      const stackRect = this.dom.terminalStack?.getBoundingClientRect();
      if (!stackRect || stackRect.height <= 0) {
        return;
      }
      event.preventDefault();
      const pointerId = event.pointerId;
      const startY = event.clientY;
      const startRatio = this.uiState.splitRatio;

      const throttledMove = throttle((deltaRatio: number) => {
        this.setSplitRatio(startRatio + deltaRatio, false);
      }, 16);

      const onMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) {
          return;
        }
        const delta = moveEvent.clientY - startY;
        const deltaRatio = delta / stackRect.height;
        throttledMove(deltaRatio);
      };

      const cleanup = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) {
          return;
        }
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', cleanup);
        window.removeEventListener('pointercancel', cleanup);
        this.persistState();
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', cleanup);
      window.addEventListener('pointercancel', cleanup);
    });
  }

  private setupThemeSelect(): void {
    this.dom.themeSelect?.addEventListener('change', () => {
      const presetKey = this.dom.themeSelect?.value;
      if (!presetKey || presetKey === this.themeState.currentThemeKey) {
        return;
      }
      this.vscode.postMessage<OutboundMessage>({
        type: 'theme-select',
        payload: {presetKey},
      });
    });
  }

  private setupPaneFocus(): void {
    (['primary', 'secondary'] as const).forEach((pane) => {
      const root = this.dom.paneRoots[pane];
      root?.addEventListener('pointerdown', () => this.handlePaneFocus(pane));
      root?.addEventListener('focusin', () => this.handlePaneFocus(pane));
    });
  }

  private setupImageDragAndDrop(): void {
    const handleDragOver = (event: DragEvent) => {
      if (!event.shiftKey || !event.dataTransfer) {
        return;
      }
      if (!event.dataTransfer.types.includes('Files')) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'copy';
    };

    const handleDrop = async (event: DragEvent) => {
      if (!event.shiftKey || !event.dataTransfer?.files.length) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();

      const files = Array.from(event.dataTransfer.files);
      const imageFiles = files.filter((file) => file.type.startsWith('image/'));
      if (imageFiles.length === 0) {
        return;
      }

      const sessionId = this.sessionState.activeSessionId;
      if (!sessionId) {
        return;
      }

      for (const file of imageFiles) {
        try {
          if (file.size > Constants.MAX_IMAGE_SIZE_BYTES) {
            const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
            const maxMB = (Constants.MAX_IMAGE_SIZE_BYTES / (1024 * 1024)).toFixed(0);
            console.warn(
              `Image file "${file.name}" is too large: ${sizeMB}MB (maximum: ${maxMB}MB). Skipping.`
            );
            continue;
          }

          const arrayBuffer = await file.arrayBuffer();
          const uint8Array = new Uint8Array(arrayBuffer);
          const base64 = btoa(
            uint8Array.reduce(
              (data, byte) => data + String.fromCharCode(byte),
              ''
            )
          );

          this.vscode.postMessage<OutboundMessage>({
            type: 'image-drop',
            payload: {
              fileName: file.name,
              mimeType: file.type,
              data: base64,
              sessionId,
            },
          });
        } catch (error) {
          console.error(`Failed to process image file "${file.name}":`, error);
        }
      }
    };

    document.addEventListener('dragover', handleDragOver);
    document.addEventListener('drop', handleDrop);
  }

  private handleMessage(message: InboundMessage): void {
    if (!message) {
      return;
    }

    switch (message.type) {
      case 'session-count':
        this.sessionState.totalSessions = message.payload.total;
        if (this.sessionState.totalSessions === 0) {
          this.sessionState.clearAll();
          this.syncPaneAssignments(true);
          this.setStatus('No sessions available');
        } else {
          this.setStatus(
            `Registered sessions: ${this.sessionState.totalSessions}`
          );
        }
        this.persistState();
        this.updateSessionControls();
        break;

      case 'session-created':
        this.uiState.pendingSessionRequest = false;
        this.updateAddButtonState(false);
        this.sessionState.addSession(
          message.payload.id,
          message.payload.shell,
          message.payload.label
        );
        this.persistState();
        this.activateSession(message.payload.id, message.payload.shell);
        break;

      case 'session-data':
        if (!this.sessionState.activeSessionId) {
          this.sessionState.activeSessionId = message.payload.sessionId;
          this.persistState();
          this.updateSessionControls();
        }
        this.sessionState.appendToBuffer(
          message.payload.sessionId,
          message.payload.data
        );
        this.terminalManager.deliverDataToPanes(
          message.payload.sessionId,
          message.payload.data
        );
        break;

      case 'session-exited':
        this.sessionState.removeSession(message.payload.sessionId);
        this.persistState();
        if (message.payload.sessionId === this.sessionState.activeSessionId) {
          const fallbackId =
            this.sessionState.sessionIds[
              this.sessionState.sessionIds.length - 1
            ];
          if (fallbackId) {
            this.switchActiveSession(
              fallbackId,
              `Switched to session ${fallbackId}`
            );
          } else {
            this.sessionState.activeSessionId = undefined;
            this.setStatus('Session has ended');
          }
          this.persistState();
        }
        this.syncPaneAssignments(true);
        this.focusActivePane();
        this.terminalManager.fitVisibleTerminals();
        this.notifyResize();
        this.updateSessionControls();
        break;

      case 'session-error':
        this.uiState.pendingSessionRequest = false;
        this.updateAddButtonState(false);
        this.setStatus(`Error: ${message.payload.message}`);
        break;

      case 'session-limit-reached':
        this.uiState.pendingSessionRequest = false;
        this.updateAddButtonState(false);
        this.setStatus(
          `Maximum of ${message.payload.max} terminals are supported.`
        );
        this.updateSessionControls();
        break;

      case 'theme-update':
        this.applyTheme(message.payload.palette);
        this.themeState.currentThemeKey = message.payload.presetKey;
        this.themeState.availablePresets = message.payload.presets;
        this.renderThemeDropdown();
        break;

      case 'all-sessions-cleared':
        this.uiState.resetClearAllState();
        this.toggleClearAllConfirm(false);
        this.sessionState.clearAll();
        this.syncPaneAssignments(true);
        this.persistState();
        this.setStatus('All sessions cleared');
        this.updateSessionControls();
        break;
    }
  }

  private requestNewSession(): void {
    if (this.uiState.pendingSessionRequest) {
      return;
    }
    if (this.sessionState.sessionIds.length >= Constants.MAX_SESSIONS) {
      this.setStatus(`Maximum of ${Constants.MAX_SESSIONS} sessions reached.`);
      this.updateAddButtonState(false);
      return;
    }
    this.uiState.pendingSessionRequest = true;
    this.updateAddButtonState(true);
    this.setStatus('Initializing a new session...');
    this.terminalManager.fitVisibleTerminals();
    this.vscode.postMessage<OutboundMessage>({
      type: 'request-new-session',
      payload: this.terminalManager.getPaneDimensions('primary'),
    });
  }

  private activateSession(sessionId: string, shell?: string): void {
    this.sessionState.activeSessionId = sessionId;
    this.persistState();
    this.syncPaneAssignments();
    this.focusActivePane();
    this.terminalManager.fitVisibleTerminals();
    this.notifyResize();
    this.setStatus(
      `Connected to ${this.sessionState.getSessionLabel(sessionId)} (${
        shell ?? this.sessionState.sessionMeta[sessionId]?.shell ?? 'Shell'
      })`
    );
    this.updateSessionControls();
  }

  private switchActiveSession(sessionId: string, message: string): void {
    this.sessionState.activeSessionId = sessionId;
    this.persistState();
    this.syncPaneAssignments();
    this.focusActivePane();
    this.terminalManager.fitVisibleTerminals();
    this.notifyResize();
    this.setStatus(message);
    this.updateSessionControls();
  }

  private notifyResize(): void {
    const primarySession = this.uiState.paneSessions.primary;
    const secondarySession = this.uiState.paneSessions.secondary;
    if (!primarySession && !secondarySession) {
      return;
    }
    if (primarySession) {
      const {cols, rows} = this.terminalManager.getPaneDimensions('primary');
      this.vscode.postMessage<OutboundMessage>({
        type: 'terminal-resize',
        payload: {sessionId: primarySession, cols, rows},
      });
    }
    if (secondarySession) {
      const {cols, rows} = this.terminalManager.getPaneDimensions('secondary');
      this.vscode.postMessage<OutboundMessage>({
        type: 'terminal-resize',
        payload: {sessionId: secondarySession, cols, rows},
      });
    }
  }

  private setStatus(text: string): void {
    if (this.dom.status) {
      this.dom.status.textContent = text;
    }
  }

  private updateAddButtonState(isBusy: boolean): void {
    if (!this.dom.addSessionButton) {
      return;
    }
    const atLimit =
      this.sessionState.sessionIds.length >= Constants.MAX_SESSIONS;
    this.dom.addSessionButton.disabled = isBusy || atLimit;
  }

  private updateSessionControls(): void {
    if (this.dom.removeSessionButton) {
      this.dom.removeSessionButton.disabled =
        !this.sessionState.activeSessionId ||
        this.uiState.pendingSessionRequest;
    }
    if (this.dom.clearAllButton) {
      this.dom.clearAllButton.disabled =
        this.uiState.clearingAll ||
        this.uiState.pendingSessionRequest ||
        this.sessionState.sessionIds.length === 0;
      if (
        this.dom.clearAllButton.disabled &&
        this.uiState.confirmingClearAll
      ) {
        this.uiState.confirmingClearAll = false;
        this.toggleClearAllConfirm(false);
      }
    }
    if (this.dom.sessionSelect) {
      this.dom.sessionSelect.disabled =
        this.sessionState.sessionIds.length === 0;
    }
    this.updateAddButtonState(this.uiState.pendingSessionRequest);
    if (this.dom.viewToggleButton) {
      this.dom.viewToggleButton.disabled =
        this.sessionState.sessionIds.length < 2 ||
        this.uiState.pendingSessionRequest;
    }
    this.renderSessionSelect();
    this.updateViewToggleButton();
  }

  private setViewMode(mode: ViewMode): void {
    if (mode === 'split' && this.sessionState.sessionIds.length < 2) {
      this.setStatus('Two sessions are required for split view.');
      return;
    }
    if (this.uiState.viewMode === mode) {
      return;
    }
    this.uiState.viewMode = mode;
    this.persistState();
    this.syncPaneAssignments(true);
    this.focusActivePane();
    this.terminalManager.fitVisibleTerminals();
    this.notifyResize();
    this.updateViewToggleButton();
  }

  private setSplitRatio(value: number, persistNow = true): void {
    const clamped = clampSplitRatio(value);
    if (Math.abs(clamped - this.uiState.splitRatio) < 0.001) {
      return;
    }
    this.uiState.splitRatio = clamped;
    if (persistNow) {
      this.persistState();
    }
    this.applySplitSizing();
    this.terminalManager.fitVisibleTerminals();
    this.notifyResize();
  }

  private updateViewToggleButton(): void {
    if (!this.dom.viewToggleButton) {
      return;
    }
    const splitEnabled =
      this.uiState.viewMode === 'split' &&
      this.sessionState.sessionIds.length >= 2;
    this.dom.viewToggleButton.setAttribute(
      'aria-pressed',
      splitEnabled ? 'true' : 'false'
    );
    if (this.dom.viewToggleIcon) {
      this.dom.viewToggleIcon.textContent = splitEnabled ? '▦' : '▢';
    }
    if (this.dom.viewToggleButton.disabled) {
      this.dom.viewToggleButton.title =
        'Add a second session to enable split view';
    } else {
      this.dom.viewToggleButton.title = splitEnabled
        ? 'Show a single terminal'
        : 'Show split view';
    }
  }

  private renderSessionSelect(): void {
    if (!this.dom.sessionSelect) {
      return;
    }
    this.dom.sessionSelect.innerHTML = '';
    this.sessionState.sessionIds.forEach((id, index) => {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = this.sessionState.getSessionLabel(id, index);
      this.dom.sessionSelect?.appendChild(option);
    });
    if (this.sessionState.activeSessionId) {
      this.dom.sessionSelect.value = this.sessionState.activeSessionId;
    }
    this.dom.sessionSelect.disabled =
      this.sessionState.sessionIds.length === 0;
  }

  private applySplitSizing(): void {
    const splitActive = this.uiState.isSplitModeActive();
    if (this.dom.paneElements.primary) {
      this.dom.paneElements.primary.style.flex = splitActive
        ? `${this.uiState.splitRatio} 1 0%`
        : '1 1 auto';
    }
    if (this.dom.paneElements.secondary) {
      const secondaryRatio = Math.max(0.01, 1 - this.uiState.splitRatio);
      this.dom.paneElements.secondary.style.flex = splitActive
        ? `${secondaryRatio} 1 0%`
        : '0 0 auto';
    }
    if (this.dom.splitResizer) {
      this.dom.splitResizer.style.display = splitActive ? 'flex' : 'none';
    }
  }

  private persistState(): void {
    this.vscode.setState(
      this.sessionState.toViewState(this.uiState, this.themeState)
    );
  }

  private applyTerminalHeight(value: number, persist = true): void {
    this.uiState.terminalHeight = value;
    if (this.dom.terminalShell) {
      this.dom.terminalShell.style.setProperty(
        '--terminal-height',
        `${this.uiState.terminalHeight}px`
      );
    }
    this.terminalManager.fitVisibleTerminals();
    this.notifyResize();
    if (persist) {
      this.persistState();
    }
  }

  private applyTheme(palette: ThemePalette): void {
    const root = document.documentElement;
    root.style.setProperty('--terminal-bg', palette.background);
    root.style.setProperty('--terminal-fg', palette.foreground);
    root.style.setProperty('--terminal-cursor', palette.cursor);
    root.style.setProperty('--terminal-selection', palette.selection);
    this.terminalManager.refreshTheme();
  }

  private renderThemeDropdown(): void {
    if (!this.dom.themeSelect) {
      return;
    }
    this.dom.themeSelect.innerHTML = '';
    this.themeState.availablePresets.forEach((preset) => {
      const option = document.createElement('option');
      option.value = preset.key;
      option.textContent = preset.label;
      this.dom.themeSelect?.appendChild(option);
    });
    if (this.themeState.currentThemeKey) {
      this.dom.themeSelect.value = this.themeState.currentThemeKey;
    }
    const active = this.themeState.getActivePreset();
    if (this.dom.themeActiveLabel) {
      this.dom.themeActiveLabel.textContent = active ? active.description : '―';
    }
    this.updateThemePreview(active ?? null);
  }

  private updateThemePreview(preset: ThemePresetInfo | null): void {
    if (!this.dom.themePreviewText || !this.dom.themePreviewSwatch) {
      return;
    }
    if (preset) {
      this.dom.themePreviewText.textContent = preset.label;
      this.dom.themePreviewSwatch.style.background = preset.preview.background;
      this.dom.themePreviewSwatch.style.color = preset.preview.foreground;
    } else {
      this.dom.themePreviewText.textContent = 'Preview';
      this.dom.themePreviewSwatch.style.background = '';
    }
  }

  private syncPaneAssignments(force = false): void {
    const activeChanged = this.sessionState.ensureActiveSession();
    if (activeChanged) {
      this.persistState();
    }
    const primarySession = this.getDesiredPaneSession('primary');
    const secondarySession = this.getDesiredPaneSession('secondary');
    this.assignPane('primary', primarySession, force);
    this.assignPane('secondary', secondarySession, force);
    this.updatePaneActiveStates();
    if (this.dom.terminalStack) {
      const splitActive =
        this.uiState.viewMode === 'split' && Boolean(secondarySession);
      this.dom.terminalStack.setAttribute(
        'data-view-mode',
        splitActive ? 'split' : 'single'
      );
    }
    this.applySplitSizing();
  }

  private assignPane(
    pane: Pane,
    sessionId: string | undefined,
    force = false
  ): void {
    const current = this.uiState.paneSessions[pane];
    if (!force && current === sessionId) {
      this.updatePaneVisibility(pane, Boolean(sessionId));
      this.updatePaneLabel(pane, sessionId);
      return;
    }
    this.uiState.paneSessions[pane] = sessionId;
    this.terminalManager.resetTerminal(pane);
    if (sessionId) {
      const buffer = this.sessionState.getBuffer(sessionId);
      if (buffer) {
        this.terminalManager.writeToTerminal(pane, buffer);
      }
      this.terminalManager.scrollToBottom(pane);
      this.terminalManager.writeToTerminal(pane, '\u001b[?25h');
    }
    this.updatePaneVisibility(pane, Boolean(sessionId));
    this.updatePaneLabel(pane, sessionId);
  }

  private updatePaneVisibility(pane: Pane, visible: boolean): void {
    const paneElement = this.dom.paneElements[pane];
    if (paneElement) {
      paneElement.setAttribute('data-pane-visible', visible ? 'true' : 'false');
    }
  }

  private focusActivePane(): void {
    const pane = this.uiState.getPaneForSession(
      this.sessionState.activeSessionId
    );
    if (!pane) {
      return;
    }
    this.terminalManager.focusTerminal(pane);
    this.updatePaneActiveStates();
  }

  private handlePaneFocus(pane: Pane): void {
    const sessionId = this.uiState.paneSessions[pane];
    if (!sessionId || this.sessionState.activeSessionId === sessionId) {
      this.updatePaneActiveStates();
      return;
    }
    this.sessionState.activeSessionId = sessionId;
    this.persistState();
    this.updateSessionControls();
    this.updatePaneActiveStates();
    this.terminalManager.focusTerminal(pane);
    this.setStatus(`Focused ${this.sessionState.getSessionLabel(sessionId)}`);
  }

  private updatePaneLabel(pane: Pane, sessionId?: string): void {
    const label = this.dom.paneLabels[pane];
    if (!label) {
      return;
    }
    label.textContent = sessionId
      ? this.sessionState.getSessionLabel(sessionId)
      : 'No session';
  }

  private updatePaneActiveStates(): void {
    (['primary', 'secondary'] as const).forEach((pane) => {
      const paneElement = this.dom.paneElements[pane];
      if (!paneElement) {
        return;
      }
      const isActive =
        this.uiState.paneSessions[pane] === this.sessionState.activeSessionId;
      paneElement.setAttribute('data-active', isActive ? 'true' : 'false');
    });
  }

  private getDesiredPaneSession(pane: Pane): string | undefined {
    if (
      this.uiState.viewMode === 'split' &&
      this.sessionState.sessionIds.length >= 2
    ) {
      return pane === 'primary'
        ? this.sessionState.sessionIds[0]
        : this.sessionState.sessionIds[1];
    }
    if (pane === 'primary') {
      return (
        this.sessionState.activeSessionId ??
        this.sessionState.sessionIds[this.sessionState.sessionIds.length - 1]
      );
    }
    return undefined;
  }

  private toggleClearAllConfirm(visible: boolean): void {
    if (!this.dom.clearAllConfirm) {
      return;
    }
    this.dom.clearAllConfirm.setAttribute(
      'aria-hidden',
      visible ? 'false' : 'true'
    );
  }
}

// ============================================================================
// Initialize Application
// ============================================================================

new AppController();
