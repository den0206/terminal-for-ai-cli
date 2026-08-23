import {FitAddon} from '@xterm/addon-fit';
import {WebLinksAddon} from '@xterm/addon-web-links';
import {Terminal} from '@xterm/xterm';

// Import shared modules
import {SHARED_CONSTANTS} from '../shared/constants';
import {DOMElements} from './lib/dom';
import {DragDropHandler} from './lib/drag-drop-handler';
import {ResizeController} from './lib/resize-controller';
import {
  SessionStateManager,
  UIStateManager,
  ThemeStateManager,
} from './lib/state-managers';
import {ThemeController} from './lib/theme-controller';
import {PANES} from './lib/types';
import type {
  VSCodeApi,
  InboundMessage,
  OutboundMessage,
  ViewState,
  ViewMode,
  Pane,
  PaneContext,
} from './lib/types';
import {
  debounce,
  getComputedVar,
  getComputedVarFrom,
  isValidViewState,
  webviewLog,
  type CancellableFunction,
} from './lib/utils';

declare const acquireVsCodeApi: <State = undefined>() => VSCodeApi<State>;

/**
 * Ctrl+click is a right-click on macOS, so `ctrlKey` is set there by an
 * ordinary context-menu gesture. Only Cmd counts as the open modifier on
 * macOS; every other platform uses Ctrl, matching VS Code's own terminal.
 */
const IS_MAC = /mac/i.test(navigator.userAgent);

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
      // OSC 8 hyperlinks (emitted by gh, npm, ...). Plain-text URLs are handled
      // by WebLinksAddon below; both go through the same modifier check.
      linkHandler: {
        activate: (event, uri) => this.openLink(event, uri),
      },
      cursorBlink: true,
      scrollback: SHARED_CONSTANTS.TERMINAL_SCROLLBACK_LINES,
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

  private openLink(event: MouseEvent, uri: string): void {
    if (IS_MAC ? event.metaKey : event.ctrlKey) {
      this.postMessage({type: 'open-link', payload: {uri}});
    }
  }

  private createPaneContext(pane: Pane): PaneContext {
    const terminal = this.createTerminalInstance();
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    // Cmd (macOS) / Ctrl (Windows, Linux) + click opens the URL in the default
    // browser, matching VS Code's own terminal. A plain click is ignored so
    // selecting text over a link stays harmless.
    terminal.loadAddon(
      new WebLinksAddon((event, uri) => this.openLink(event, uri))
    );
    const root = this.dom.paneRoots[pane];
    if (root) {
      terminal.open(root);
    }
    // Note: terminal.onData() returns IDisposable, but Terminal.dispose()
    // automatically cleans up all event listeners, so we don't need to track it
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
    PANES.forEach((pane) => {
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

  /**
   * Syncs one pane's xterm colors with the CSS variables resolved on that
   * pane's element, so panes showing different terminals keep their own theme.
   */
  refreshPaneTheme(pane: Pane): void {
    const element = this.dom.paneElements[pane];
    this.paneContexts[pane].terminal.options.theme = {
      background: getComputedVarFrom(
        element,
        '--terminal-bg',
        '--vscode-editor-background',
        '#1e1e1e'
      ),
      foreground: getComputedVarFrom(
        element,
        '--terminal-fg',
        '--vscode-editor-foreground',
        '#cccccc'
      ),
      cursor: getComputedVarFrom(
        element,
        '--terminal-cursor',
        '--vscode-terminalCursor-foreground',
        '#ffffff'
      ),
      selectionBackground: getComputedVarFrom(
        element,
        '--terminal-selection',
        '--vscode-editor-selectionBackground',
        'rgba(255,255,255,0.15)'
      ),
    };
  }

  refreshTheme(): void {
    PANES.forEach((pane) => {
      this.refreshPaneTheme(pane);
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

  /**
   * Dispose a single pane's terminal and fit addon to free memory
   * @param pane The pane to dispose
   */
  disposePane(pane: Pane): void {
    const context = this.paneContexts[pane];
    if (context) {
      try {
        // Dispose addon first, then terminal
        // Terminal.dispose() automatically cleans up all event listeners
        context.fitAddon.dispose();
        context.terminal.dispose();
      } catch (error) {
        webviewLog.error(`Failed to dispose ${pane} pane:`, error);
      }
    }
  }

  /**
   * Dispose all terminal instances to prevent memory leaks
   * Should be called on page unload or extension deactivation
   */
  disposeAll(): void {
    PANES.forEach((pane) => {
      this.disposePane(pane);
    });
  }

  scrollToBottom(pane: Pane): void {
    this.paneContexts[pane].terminal.scrollToBottom();
  }

  focusTerminal(pane: Pane): void {
    this.paneContexts[pane].terminal.focus();
  }

  deliverDataToPanes(sessionId: string, chunk: string): void {
    PANES.forEach((pane) => {
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
  private readonly resizeController: ResizeController;
  private readonly themeController: ThemeController;
  private readonly dragDropHandler: DragDropHandler;
  private readonly debouncedResize: CancellableFunction<() => void>;
  // Store event listener references for proper cleanup
  private readonly _eventListeners: Array<{
    target: EventTarget;
    event: string;
    handler: EventListener;
  }> = [];

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

    this.resizeController = new ResizeController(
      this.dom,
      this.uiState,
      () => this.terminalManager.fitVisibleTerminals(),
      (target, event, handler) => this.addEventListener(target, event, handler),
      () => this.persistState(),
      () => this.notifyResize()
    );

    this.themeController = new ThemeController(
      this.dom,
      this.themeState,
      (pane) => this.terminalManager.refreshPaneTheme(pane),
      (msg) => this.vscode.postMessage(msg),
      (target, event, handler) => this.addEventListener(target, event, handler),
      (pane) =>
        this.sessionState.getSessionSlot(this.uiState.paneSessions[pane]),
      () => this.sessionState.getSessionSlot(this.sessionState.activeSessionId)
    );

    this.dragDropHandler = new DragDropHandler(
      () => this.sessionState.activeSessionId,
      (msg) => this.vscode.postMessage(msg),
      (target, event, handler) => this.addEventListener(target, event, handler)
    );

    this.debouncedResize = debounce(() => {
      this.terminalManager.fitVisibleTerminals();
      this.notifyResize();
    }, 150);

    this.initialize();

    // Cleanup on page unload to prevent memory leaks
    // Note: This listener is intentionally not tracked in _eventListeners
    // because it's the one responsible for cleanup itself
    window.addEventListener('beforeunload', () => {
      this.cleanup();
    });
  }

  /**
   * Cleanup all resources to prevent memory leaks
   * Called on page unload or when webview is disposed
   */
  private cleanup(): void {
    // Cancel pending resize operations
    this.debouncedResize.cancel();

    // Clean up any active drag operation listeners
    this.resizeController.cleanupActiveDrags();

    // Remove all event listeners
    for (const {target, event, handler} of this._eventListeners) {
      target.removeEventListener(event, handler);
    }
    this._eventListeners.length = 0;

    // Dispose all terminal instances
    this.terminalManager.disposeAll();

    // Clear session buffers
    this.sessionState.clearAll();
  }

  /**
   * Helper method to add event listeners with automatic cleanup tracking
   */
  private addEventListener(
    target: EventTarget,
    event: string,
    handler: EventListener
  ): void {
    target.addEventListener(event, handler);
    this._eventListeners.push({target, event, handler});
  }

  private initialize(): void {
    this.setupEventListeners();
    this.resizeController.applyTerminalHeight(this.uiState.terminalHeight, false);
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
    this.addEventListener(
      window,
      'message',
      (event: Event) => {
        const messageEvent = event as MessageEvent<InboundMessage>;
        this.handleMessage(messageEvent.data);
      }
    );

    if (this.dom.addSessionButton) {
      this.addEventListener(this.dom.addSessionButton, 'click', () => {
        this.requestNewSession();
      });
    }

    if (this.dom.viewToggleButton) {
      this.addEventListener(this.dom.viewToggleButton, 'click', () => {
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
    }

    if (this.dom.removeSessionButton) {
      this.addEventListener(this.dom.removeSessionButton, 'click', () => {
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
    }

    if (this.dom.clearAllButton) {
      this.addEventListener(this.dom.clearAllButton, 'click', () => {
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
    }

    if (this.dom.clearAllConfirmAccept) {
      this.addEventListener(this.dom.clearAllConfirmAccept, 'click', () => {
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
    }

    if (this.dom.clearAllConfirmCancel) {
      this.addEventListener(this.dom.clearAllConfirmCancel, 'click', () => {
        this.uiState.confirmingClearAll = false;
        this.toggleClearAllConfirm(false);
      });
    }

    if (this.dom.sessionSelect) {
      this.addEventListener(this.dom.sessionSelect, 'change', () => {
        const nextSessionId = this.dom.sessionSelect?.value;
        if (!nextSessionId || nextSessionId === this.sessionState.activeSessionId) {
          return;
        }
        this.switchActiveSession(
          nextSessionId,
          `Switched to ${this.sessionState.getSessionLabel(nextSessionId)}`
        );
      });
    }

    // リサイズ時は debounce のみ使用。throttle と併用すると fit() が短時間に複数回
    // 実行され xterm の再計測・再描画が連続してチラつく（特に長い行で顕著）。
    this.addEventListener(window, 'resize', () => {
      this.debouncedResize();
    });

    this.resizeController.setupResizer();
    this.resizeController.setupSplitResizer();
    this.themeController.setupThemeSelect();
    this.setupPaneFocus();
    this.dragDropHandler.setup();
  }

  private setupPaneFocus(): void {
    PANES.forEach((pane) => {
      const root = this.dom.paneRoots[pane];
      if (root) {
        this.addEventListener(root, 'pointerdown', () =>
          this.handlePaneFocus(pane)
        );
        this.addEventListener(root, 'focusin', () =>
          this.handlePaneFocus(pane)
        );
      }
    });
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
          message.payload.label,
          message.payload.slot
        );
        this.persistState();
        this.switchActiveSession(
          message.payload.id,
          `Connected to ${this.sessionState.getSessionLabel(
            message.payload.id
          )} (${message.payload.shell})`
        );
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

      case 'usage-update':
        if (this.dom.usage) {
          this.dom.usage.textContent = message.payload.text;
        }
        break;

      case 'theme-update':
        this.themeController.applyThemeUpdate(message.payload);
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
    if (this.sessionState.sessionIds.length >= SHARED_CONSTANTS.MAX_SESSIONS) {
      this.setStatus(`Maximum of ${SHARED_CONSTANTS.MAX_SESSIONS} sessions reached.`);
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
      this.sessionState.sessionIds.length >= SHARED_CONSTANTS.MAX_SESSIONS;
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

  private persistState(): void {
    this.vscode.setState(this.sessionState.toViewState(this.uiState));
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
    this.resizeController.applySplitSizing();
    this.refreshThemeUi();
  }

  /**
   * Re-applies each pane's theme (pane assignments decide which terminal's
   * theme applies) and points the theme picker at the focused terminal.
   */
  private refreshThemeUi(): void {
    this.themeController.applyPaneThemes();
    this.themeController.renderThemeDropdown();
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
    this.themeController.renderThemeDropdown();
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
    PANES.forEach((pane) => {
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
