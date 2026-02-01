import {FitAddon} from '@xterm/addon-fit';
import {Terminal} from '@xterm/xterm';

// Import shared modules
import {Constants} from './lib/constants';
import {DOMElements} from './lib/dom';
import {
  SessionStateManager,
  UIStateManager,
  ThemeStateManager,
} from './lib/state-managers';
import type {
  VSCodeApi,
  ThemePalette,
  ThemePresetInfo,
  InboundMessage,
  OutboundMessage,
  ViewState,
  ViewMode,
  Pane,
  PaneContext,
} from './lib/types';
import {
  debounce,
  throttle,
  getComputedVar,
  clampSplitRatio,
  isValidViewState,
  type CancellableFunction,
} from './lib/utils';

declare const acquireVsCodeApi: <State = undefined>() => VSCodeApi<State>;

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
      scrollback: Constants.TERMINAL_SCROLLBACK_LINES,
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
        console.error(`Failed to dispose ${pane} pane:`, error);
      }
    }
  }

  /**
   * Dispose all terminal instances to prevent memory leaks
   * Should be called on page unload or extension deactivation
   */
  disposeAll(): void {
    (['primary', 'secondary'] as const).forEach((pane) => {
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
  // Store event listener references for proper cleanup
  private readonly _eventListeners: Array<{
    target: EventTarget;
    event: string;
    handler: EventListener;
  }> = [];
  // Store active drag cleanup functions for proper cleanup on page unload
  private _activeDragCleanup: (() => void) | null = null;

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
    this.throttledResize.cancel();
    this.debouncedResize.cancel();

    // Clean up any active drag operation listeners
    if (this._activeDragCleanup) {
      this._activeDragCleanup();
      this._activeDragCleanup = null;
    }

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

    this.addEventListener(window, 'resize', () => {
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
    if (!this.dom.resizer) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
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

      const cleanup = (moveEvent?: PointerEvent) => {
        if (moveEvent && moveEvent.pointerId !== pointerId) {
          return;
        }
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', cleanup);
        window.removeEventListener('pointercancel', cleanup);
        throttledMove.cancel();
        this._activeDragCleanup = null;
        if (moveEvent) {
          this.persistState();
        }
      };

      // Store cleanup function for emergency cleanup on page unload
      this._activeDragCleanup = () => cleanup();

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', cleanup);
      window.addEventListener('pointercancel', cleanup);
    };
    this.addEventListener(this.dom.resizer, 'pointerdown', handlePointerDown);
  }

  private setupSplitResizer(): void {
    if (!this.dom.splitResizer) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
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

      const cleanup = (moveEvent?: PointerEvent) => {
        if (moveEvent && moveEvent.pointerId !== pointerId) {
          return;
        }
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', cleanup);
        window.removeEventListener('pointercancel', cleanup);
        throttledMove.cancel();
        this._activeDragCleanup = null;
        if (moveEvent) {
          this.persistState();
        }
      };

      // Store cleanup function for emergency cleanup on page unload
      this._activeDragCleanup = () => cleanup();

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', cleanup);
      window.addEventListener('pointercancel', cleanup);
    };
    this.addEventListener(
      this.dom.splitResizer,
      'pointerdown',
      handlePointerDown
    );
  }

  private setupThemeSelect(): void {
    if (this.dom.themeSelect) {
      this.addEventListener(this.dom.themeSelect, 'change', () => {
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
  }

  private setupPaneFocus(): void {
    (['primary', 'secondary'] as const).forEach((pane) => {
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

    this.addEventListener(document, 'dragover', handleDragOver);
    this.addEventListener(document, 'drop', handleDrop);
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
    this.vscode.setState(this.sessionState.toViewState(this.uiState));
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
