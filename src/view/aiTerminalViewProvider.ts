import * as vscode from 'vscode';
import {SHARED_CONSTANTS} from '../shared/constants';
import type {
  InboundMessage as WebviewInboundMessage,
  OutboundMessage as WebviewOutboundMessage,
} from '../shared/types';
import {SessionManager} from '../terminal/sessionManager';
import {isValidPresetKey} from '../theming/themePresets';
import {Logger} from '../utils/logger';
import {getNonce} from '../utils/nonce';
import {
  getDefaultShell,
  validateShellPath,
  validateStartupCommands,
} from '../utils/validation';
import {resolveWorkingDirectory} from '../utils/workingDirectory';
import {ThemeSnapshot, buildWebviewHtml} from './htmlTemplate';
import {ImageManager} from './imageManager';
import {getThemeSnapshot} from './themeSnapshot';

// Extension 視点: 送信 = WebviewInboundMessage (shared), 受信 = WebviewOutboundMessage (shared)
type OutboundMessage = WebviewInboundMessage;
type InboundMessage = WebviewOutboundMessage;

/**
 * Provides the webview view for Terminal For AI CLI.
 *
 * This class is the main bridge between the VS Code extension host and the webview UI.
 * It manages the complete lifecycle of terminal sessions, handles bidirectional
 * communication with the webview, and coordinates theme management, image handling,
 * and session state.
 *
 * ## Responsibilities
 * - Webview lifecycle management (creation, disposal, message routing)
 * - Session lifecycle management (creation, disposal, cleanup)
 * - Theme management (preset selection, application, synchronization)
 * - Image handling (drag & drop, storage, cleanup)
 * - Configuration validation and monitoring
 * - Message queue management for webview communication
 *
 * ## Architecture
 * The provider uses a message-based architecture:
 * - **Inbound messages** (Webview → Extension): User actions, terminal input, resize events
 * - **Outbound messages** (Extension → Webview): Session data, events, theme updates
 *
 * Messages are queued when the webview is not ready and flushed on initialization.
 *
 * ## Message Flow
 * ```
 * User Action → Webview → InboundMessage → handleMessage() → SessionManager
 *                                                           → Update state
 *                                                           → OutboundMessage → Webview
 * ```
 *
 * @remarks
 * - The provider maintains session labels (e.g., "Terminal 1", "Terminal 2") that
 *   intelligently reuse freed numbers when sessions are closed.
 * - Images dropped into the terminal are saved to global storage and tracked per session
 *   for automatic cleanup on session disposal.
 * - Performance monitoring can be enabled via settings to log warnings about queue size
 *   and session count.
 *
 * @example
 * ```typescript
 * const provider = new AiTerminalViewProvider(context, sessionManager);
 * context.subscriptions.push(
 *   vscode.window.registerWebviewViewProvider(VIEW_ID, provider, {
 *     webviewOptions: { retainContextWhenHidden: true }
 *   })
 * );
 * ```
 *
 * @see {@link SessionManager} for terminal process management
 * @see {@link buildWebviewHtml} for HTML template generation
 */
export class AiTerminalViewProvider
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  private webviewView?: vscode.WebviewView;
  private webviewReady = false;
  private initialSessionEnsured = false;
  private readonly messageQueue: OutboundMessage[] = [];
  private readonly disposables: vscode.Disposable[] = [];
  private messageDisposable?: vscode.Disposable;
  private readonly sessionLabels = new Map<string, string>();
  private readonly imageManager: ImageManager;

  /**
   * Creates a new webview provider instance.
   *
   * @param context - The extension context
   * @param sessionManager - The session manager instance
   */
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly sessionManager: SessionManager,
  ) {
    this.imageManager = new ImageManager(context);
    // Validate configuration on initialization
    this.validateConfiguration();
    this.disposables.push(
      this.sessionManager.onDidWriteData(({id, data}) => {
        this.postMessage({
          type: 'session-data',
          payload: {sessionId: id, data},
        });
      }),
      this.sessionManager.onDidExit(({id, code, signal}) => {
        this.postMessage({
          type: 'session-exited',
          payload: {sessionId: id, code, signal},
        });
        this.sessionLabels.delete(id);
        this.imageManager.deleteSessionImages(id).catch((error) => {
          Logger.error(`Failed to delete images for session ${id}`, error);
        });
        this.postSessionCount();
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('aiTerminal.themePreset')) {
          this.postThemeUpdate();
        }
        if (event.affectsConfiguration('aiTerminal')) {
          this.validateConfiguration();
        }
      }),
    );
  }

  /**
   * Disposes the provider and cleans up all resources.
   *
   * This method ensures complete cleanup of:
   * - All event listeners and disposables
   * - Session label mappings
   * - Session image tracking
   * - Queued messages
   * - Webview references
   *
   * Safe to call multiple times - subsequent calls are no-ops.
   *
   * @remarks
   * This method is automatically called by VS Code when the extension is deactivated
   * or when the provider is explicitly disposed. All subscriptions registered via
   * `context.subscriptions.push()` will also be disposed.
   *
   * @example
   * ```typescript
   * const provider = new AiTerminalViewProvider(context, sessionManager);
   * // ... use provider ...
   * provider.dispose(); // Cleanup when done
   * ```
   */
  dispose() {
    // Dispose message listener separately as it's managed outside disposables array
    if (this.messageDisposable) {
      this.messageDisposable.dispose();
      this.messageDisposable = undefined;
    }
    vscode.Disposable.from(...this.disposables).dispose();
    this.sessionLabels.clear();
    this.imageManager.clearTracking();
    this.messageQueue.length = 0;
    this.webviewView = undefined;
    this.webviewReady = false;
    this.initialSessionEnsured = false;
  }

  /**
   * Resolves the webview view when it becomes visible.
   *
   * This method is called by VS Code when the webview view is first shown.
   * It performs the following initialization:
   * 1. Configures webview options (scripts enabled, resource roots)
   * 2. Generates and sets the HTML content with CSP nonce
   * 3. Sets up message listener for bidirectional communication
   * 4. Resets internal state flags for fresh initialization
   *
   * The webview is not considered "ready" until it sends a 'webview-ready' message,
   * at which point queued messages are flushed and initial session creation begins.
   *
   * @param webviewView - The webview view instance provided by VS Code
   *
   * @remarks
   * The `retainContextWhenHidden: true` option (set during registration) ensures
   * that the webview maintains its state when hidden, avoiding unnecessary reloads.
   *
   * @example
   * ```typescript
   * // This method is automatically called by VS Code
   * vscode.window.registerWebviewViewProvider(VIEW_ID, provider, {
   *   webviewOptions: { retainContextWhenHidden: true }
   * });
   * ```
   */
  resolveWebviewView(webviewView: vscode.WebviewView) {
    this.webviewView = webviewView;
    this.webviewReady = false;
    this.initialSessionEnsured = false;

    const webview = webviewView.webview;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };

    webview.html = this.getHtml(webview);

    // Clean up previous message listener if webview is re-resolved
    if (this.messageDisposable) {
      this.messageDisposable.dispose();
      this.messageDisposable = undefined;
    }

    this.messageDisposable = webview.onDidReceiveMessage((message) => {
      this.handleMessage(message);
    });
  }

  /**
   * Reveals the webview view in the sidebar.
   *
   * Brings the Terminal For AI CLI view into focus, making it visible in the
   * activity bar's secondary sidebar. If the view is already visible, this
   * ensures it has focus.
   *
   * @remarks
   * This method is typically called from the 'terminal-for-ai-cli.focus' command.
   * The `show(true)` parameter preserves focus on the webview.
   *
   * @example
   * ```typescript
   * // Programmatically show the terminal view
   * provider.reveal();
   * ```
   */
  reveal() {
    if (this.webviewView) {
      this.webviewView.show?.(true);
    }
  }

  /**
   * Creates a new terminal session.
   *
   * This is a public API method that can be called from command palette
   * or programmatically. It delegates to the internal `handleSessionRequest()`
   * method which performs validation and session creation.
   *
   * @remarks
   * - Checks session limit (SHARED_CONSTANTS.MAX_SESSIONS) before creating
   * - Validates configuration (shell path, startup commands)
   * - Creates session with appropriate dimensions from webview
   * - Updates UI state and notifies webview on success/failure
   *
   * @example
   * ```typescript
   * // From command palette
   * vscode.commands.registerCommand('terminal-for-ai-cli.newSession', () => {
   *   provider.newSession();
   * });
   *
   * // Programmatically
   * provider.newSession();
   * ```
   *
   * @see {@link handleSessionRequest} for implementation details
   */
  newSession() {
    this.handleSessionRequest();
  }

  /**
   * Handles incoming messages from the webview.
   *
   * Routes messages to appropriate handlers based on message type.
   * All message types are handled with exhaustive type checking.
   *
   * @param message - The incoming message from the webview
   * @throws {Error} If message handling fails, logs error and sends error message to webview
   * @private
   */
  private async handleMessage(message: InboundMessage): Promise<void> {
    try {
      switch (message.type) {
        case 'webview-ready':
          // Prevent duplicate webview-ready processing
          if (this.webviewReady) {
            Logger.debug('Duplicate webview-ready message received, ignoring');
            break;
          }
          // Flush queued messages before setting webviewReady to maintain message ordering
          this.flushQueuedMessages();
          this.webviewReady = true;
          this.postSessionCount();
          this.postThemeUpdate();
          this.postExistingSessions();
          this.ensureInitialSession();
          // Check performance after initialization
          this.checkMessageQueuePerformance();
          break;
        case 'request-new-session':
          this.handleSessionRequest(message.payload);
          break;
        case 'terminal-input':
          this.sessionManager.write(
            message.payload.sessionId,
            message.payload.data,
          );
          break;
        case 'terminal-resize':
          this.sessionManager.resize(
            message.payload.sessionId,
            message.payload.cols,
            message.payload.rows,
          );
          break;
        case 'dispose-session':
          await this.imageManager.deleteSessionImages(
            message.payload.sessionId,
          );
          this.sessionLabels.delete(message.payload.sessionId);
          this.removeSessionFromQueue(message.payload.sessionId);
          this.sessionManager.disposeSession(message.payload.sessionId);
          this.postSessionCount();
          break;
        case 'dispose-all-sessions':
          await this.handleClearAllSessions();
          break;
        case 'theme-select':
          await this.updateThemePreset(message.payload.presetKey);
          break;
        case 'image-drop':
          await this.handleImageDrop(message.payload);
          break;
        default: {
          // TypeScript exhaustive check - this should never happen
          const _exhaustive: never = message;
          Logger.warn(
            `Unknown message type received: ${
              (_exhaustive as InboundMessage).type
            }`,
          );
          break;
        }
      }
    } catch (error) {
      Logger.error(`Error handling message type: ${message.type}`, error);
      if (
        message.type === 'request-new-session' ||
        message.type === 'dispose-session'
      ) {
        this.postMessage({
          type: 'session-error',
          payload: {
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }
  }

  /**
   * Handles a request to create a new terminal session.
   *
   * Validates configuration (shell path, startup commands), checks session limits,
   * and creates a new session via SessionManager. Sends appropriate messages to webview
   * on success or failure.
   *
   * @param dimensions - Optional terminal dimensions (cols, rows) from the webview
   * @remarks If session limit is reached, shows warning and sends limit-reached message.
   *          Invalid shell paths fall back to default shell with warning.
   * @private
   */
  private handleSessionRequest(dimensions?: {cols?: number; rows?: number}) {
    if (
      this.sessionManager.getSessionCount() >= SHARED_CONSTANTS.MAX_SESSIONS
    ) {
      vscode.window.showWarningMessage(
        `Terminal For AI CLI supports up to ${SHARED_CONSTANTS.MAX_SESSIONS} sessions.`,
      );
      this.postMessage({
        type: 'session-limit-reached',
        payload: {max: SHARED_CONSTANTS.MAX_SESSIONS},
      });
      return;
    }
    const config = vscode.workspace.getConfiguration('aiTerminal');
    const configuredShell = config.get<string>('defaultShell')?.trim();
    const configuredCommands = config.get<string[]>('startupCommands');

    // Validate and sanitize shell path
    let shell: string | undefined;
    if (configuredShell) {
      if (validateShellPath(configuredShell)) {
        shell = configuredShell;
      } else {
        Logger.warn(
          `Invalid shell path configured: "${configuredShell}". Using default shell instead.`,
        );
        vscode.window.showWarningMessage(
          `Invalid shell path configured: "${configuredShell}". Using default shell instead.`,
        );
        shell = getDefaultShell();
      }
    } else {
      shell = undefined; // Let SessionManager use its default
    }

    // Validate and sanitize startup commands
    const startupCommands = validateStartupCommands(configuredCommands);

    // Log validation results for debugging
    if (configuredCommands && configuredCommands.length > 0) {
      const validCount = startupCommands.length;
      const invalidCount = configuredCommands.length - validCount;
      if (invalidCount > 0) {
        Logger.warn(
          `Filtered out ${invalidCount} invalid startup command(s). ${validCount} valid command(s) will be executed.`,
        );
      }
    }

    try {
      const info = this.sessionManager.createSession({
        shell,
        cols: dimensions?.cols,
        rows: dimensions?.rows,
        startupCommands,
        cwd: resolveWorkingDirectory(),
      });
      const label = this.getOrCreateLabel(info.id);

      this.postMessage({type: 'session-created', payload: {...info, label}});
      this.postSessionCount();
    } catch (error) {
      Logger.error('Failed to create Terminal For AI CLI session', error);

      // Provide user-friendly error messages
      let userMessage = 'Failed to create a terminal session.';
      if (error instanceof Error) {
        const errorMessage = error.message.toLowerCase();
        if (
          errorMessage.includes('enoent') ||
          errorMessage.includes('not found')
        ) {
          userMessage = `Shell not found. Please check your "aiTerminal.defaultShell" setting or ensure your default shell is available.`;
        } else if (
          errorMessage.includes('eacces') ||
          errorMessage.includes('permission')
        ) {
          userMessage = `Permission denied. Please check that the shell is executable.`;
        } else if (errorMessage.includes('spawn')) {
          userMessage = `Failed to start shell process. Please check your shell configuration.`;
        } else {
          userMessage = `Failed to create session: ${error.message}`;
        }
      }

      vscode.window.showErrorMessage(
        `Terminal For AI CLI: ${userMessage} Check the Output channel for details.`,
      );
      this.postMessage({
        type: 'session-error',
        payload: {
          message: userMessage,
        },
      });
    }
  }

  /**
   * Posts the current session count to the webview.
   *
   * @private
   */
  private postSessionCount() {
    this.postMessage({
      type: 'session-count',
      payload: {total: this.sessionManager.getSessionCount()},
    });
  }

  /**
   * Posts a message to the webview, or queues it if the webview is not ready.
   *
   * Messages are queued when the webview is not ready and flushed when it becomes ready.
   * The queue has a maximum size of 100 messages; older messages are dropped if exceeded.
   *
   * @param message - The message to send to the webview
   * @private
   */
  private postMessage(message: OutboundMessage): void {
    if (!this.webviewView || !this.webviewReady) {
      // Limit queue size to prevent memory issues
      const MAX_QUEUE_SIZE = 100;
      if (this.messageQueue.length >= MAX_QUEUE_SIZE) {
        Logger.warn('Message queue is full, dropping oldest message');
        this.messageQueue.shift();
      }
      this.messageQueue.push(message);

      // Check for performance warnings
      this.checkMessageQueuePerformance();
      return;
    }
    try {
      this.webviewView.webview.postMessage(message);
    } catch (error) {
      Logger.error('Failed to post message to webview', error);
    }
  }

  /**
   * Checks message queue performance and logs warnings if thresholds are exceeded.
   *
   * @private
   */
  private checkMessageQueuePerformance(): void {
    const config = vscode.workspace.getConfiguration('aiTerminal');
    const monitoringEnabled = config.get<boolean>(
      'enablePerformanceMonitoring',
      true,
    );

    if (!monitoringEnabled) {
      return;
    }

    const MAX_QUEUE_SIZE = 100;
    const queueSize = this.messageQueue.length;
    const queuePercentage = (queueSize / MAX_QUEUE_SIZE) * 100;

    // Warn if queue exceeds 80% of limit
    if (queuePercentage >= 80) {
      Logger.warn(
        `Message queue is ${queueSize}/${MAX_QUEUE_SIZE} (${Math.round(queuePercentage)}% full). ` +
          `Consider checking webview connection status.`,
      );
    }

    // Check session manager performance
    const sessionWarnings = this.sessionManager.checkPerformanceWarnings();
    for (const warning of sessionWarnings) {
      Logger.warn(warning);
    }
  }

  /**
   * Posts the current theme configuration to the webview.
   *
   * @private
   */
  private postThemeUpdate() {
    this.postMessage({type: 'theme-update', payload: this.getThemeValues()});
  }

  /**
   * Updates the theme preset in VS Code settings and notifies the webview.
   *
   * @param presetKey - The theme preset key to apply
   * @remarks Invalid preset keys are ignored. The change is saved to global settings.
   * @private
   */
  private async updateThemePreset(presetKey: string) {
    if (!isValidPresetKey(presetKey)) {
      return;
    }
    const config = vscode.workspace.getConfiguration('aiTerminal');
    await config.update(
      'themePreset',
      presetKey,
      vscode.ConfigurationTarget.Global,
    );
    this.postThemeUpdate();
  }

  /**
   * Flushes all queued messages to the webview.
   *
   * Called when the webview becomes ready to ensure no messages are lost.
   * Continues flushing even if individual messages fail.
   *
   * @private
   */
  private flushQueuedMessages() {
    if (!this.webviewView || this.messageQueue.length === 0) {
      return;
    }
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (message) {
        try {
          this.webviewView.webview.postMessage(message);
        } catch (error) {
          Logger.error('Failed to flush queued message to webview', error);
          // Continue flushing remaining messages
        }
      }
    }
  }

  /**
   * Removes all messages related to a session from the message queue.
   *
   * Used when a session is disposed to prevent sending stale data to the webview.
   *
   * @param sessionId - The session ID whose messages should be removed
   * @private
   */
  private removeSessionFromQueue(sessionId: string) {
    for (let i = this.messageQueue.length - 1; i >= 0; i--) {
      const message = this.messageQueue[i];
      let shouldRemove = false;

      switch (message.type) {
        case 'session-data':
        case 'session-exited':
          shouldRemove = message.payload.sessionId === sessionId;
          break;
        case 'session-created':
          shouldRemove = message.payload.id === sessionId;
          break;
      }

      if (shouldRemove) {
        this.messageQueue.splice(i, 1);
      }
    }
  }

  /**
   * Ensures at least one session exists when the webview becomes ready.
   *
   * Creates a new session if no sessions are currently active.
   * Prevents duplicate session creation by tracking if initial session has been ensured.
   *
   * @private
   */
  private ensureInitialSession() {
    // Prevent duplicate initial session creation
    if (this.initialSessionEnsured) {
      Logger.debug('Initial session already ensured, skipping');
      return;
    }

    const sessionCount = this.sessionManager.getSessionCount();
    if (sessionCount === 0) {
      this.initialSessionEnsured = true;
      this.handleSessionRequest();
    } else {
      // Mark as ensured even if sessions already exist (e.g., restored from previous state)
      this.initialSessionEnsured = true;
      Logger.debug(
        `Initial session check: ${sessionCount} session(s) already exist`,
      );
    }
  }

  /**
   * Handles clearing all terminal sessions.
   *
   * Disposes all active sessions, clears session labels and images,
   * and notifies the webview. Safe to call when no sessions exist.
   *
   * @private
   */
  private async handleClearAllSessions() {
    const sessions = this.sessionManager.getActiveSessions();
    if (sessions.length === 0) {
      this.sessionLabels.clear();
      this.postMessage({type: 'all-sessions-cleared'});
      this.postSessionCount();
      await this.imageManager.clearAllImages();
      return;
    }

    for (const session of sessions) {
      this.sessionManager.disposeSession(session.id);
    }
    this.sessionLabels.clear();
    this.postMessage({type: 'all-sessions-cleared'});
    this.postSessionCount();
    await this.imageManager.clearAllImages();
  }

  /**
   * Cleanup orphaned images from previous sessions that weren't properly cleaned up.
   * This is called on extension activation and can be called manually.
   * @returns The number of deleted files
   */
  async cleanupOrphanedImages(): Promise<number> {
    return this.imageManager.cleanupOrphanedImages();
  }

  /**
   * Gets the current theme configuration from VS Code settings.
   *
   * Validates the theme preset key and falls back to 'modern' if invalid.
   * Returns the active palette and all available presets for the webview.
   *
   * @returns Theme snapshot containing preset key, palette, and available presets
   * @private
   */
  private getThemeValues(): ThemeSnapshot {
    const config = vscode.workspace.getConfiguration('aiTerminal');
    return getThemeSnapshot((key: string) => config.get(key), {
      logWarning: (msg: string) => Logger.warn(msg),
    });
  }

  /**
   * Posts all existing active sessions to the webview.
   *
   * Called when the webview becomes ready to restore session state.
   * Sessions are marked as 'restored' to distinguish from newly created sessions.
   *
   * @private
   */
  private postExistingSessions() {
    const sessions = this.sessionManager.getActiveSessions();
    if (!sessions.length) {
      return;
    }
    for (const session of sessions) {
      const label = this.getOrCreateLabel(session.id);
      this.postMessage({
        type: 'session-created',
        payload: {...session, label, restored: true},
      });
    }
  }

  /**
   * Gets or creates a label for a session.
   *
   * Returns existing label if available, otherwise creates a new label
   * using the next available index (e.g., "Terminal 1", "Terminal 2").
   *
   * @param sessionId - The session ID to get or create a label for
   * @returns The session label
   * @private
   */
  private getOrCreateLabel(sessionId: string) {
    const existing = this.sessionLabels.get(sessionId);
    if (existing) {
      return existing;
    }
    const label = `Terminal ${this.findNextLabelIndex()}`;
    this.sessionLabels.set(sessionId, label);
    return label;
  }

  /**
   * Finds the next available label index for a new session.
   *
   * Scans existing labels and finds the lowest unused index starting from 1.
   * Reuses freed numbers (e.g., if Terminal 1 and 3 exist, returns 2).
   *
   * @returns The next available label index
   * @private
   */
  private findNextLabelIndex() {
    const usedIndexes = new Set<number>();
    for (const label of this.sessionLabels.values()) {
      const match = label.match(/Terminal\s*(\d+)/);
      if (match) {
        usedIndexes.add(Number(match[1]));
      }
    }

    let index = 1;
    while (usedIndexes.has(index)) {
      index++;
    }
    return index;
  }

  /**
   * Handles image drop events from the webview.
   *
   * Delegates to ImageManager for validation and storage, then writes
   * the escaped file path to the terminal session.
   *
   * @param payload - The image drop payload from the webview
   * @private
   */
  private async handleImageDrop(payload: {
    fileName: string;
    mimeType: string;
    data: string;
    sessionId: string;
  }) {
    try {
      const escapedPath = await this.imageManager.handleImageDrop(
        payload.fileName,
        payload.mimeType,
        payload.data,
        payload.sessionId,
      );
      this.sessionManager.write(payload.sessionId, escapedPath);
    } catch (error) {
      Logger.error('Failed to save image', error);

      let userMessage = 'Failed to save image.';
      if (error instanceof Error) {
        const errorMessage = error.message.toLowerCase();
        if (errorMessage.includes('too large')) {
          userMessage = error.message;
        } else if (errorMessage.includes('invalid file type')) {
          userMessage = 'Only image files are supported.';
        } else if (errorMessage.includes('invalid base64')) {
          userMessage =
            'Invalid image data. Please try dropping the image again.';
        } else if (errorMessage.includes('invalid filename')) {
          userMessage = 'Invalid filename. Please use a valid file name.';
        } else {
          userMessage = `Failed to save image: ${error.message}`;
        }
      }

      vscode.window.showErrorMessage(`Terminal For AI CLI: ${userMessage}`);
    }
  }

  /**
   * Validates configuration values and logs warnings for invalid settings.
   *
   * This method is called during initialization and when configuration changes.
   * It performs comprehensive validation of all extension settings:
   *
   * - **Shell path** (`aiTerminal.defaultShell`):
   *   - Must be an absolute path
   *   - Must exist and be executable
   *   - Falls back to default shell if invalid
   *
   * - **Startup commands** (`aiTerminal.startupCommands`):
   *   - Must be an array of strings
   *   - Dangerous commands (rm -rf, fork bombs) trigger warnings but are not blocked
   *   - Invalid commands are filtered out
   *
   * - **Theme preset** (`aiTerminal.themePreset`):
   *   - Must be one of the predefined preset keys
   *   - Falls back to "modern" if invalid
   *
   * - **Log level** (`aiTerminal.logLevel`):
   *   - Must be one of: error, warn, info, debug
   *   - Falls back to "info" if invalid
   *
   * @remarks
   * This method does not modify configuration - it only validates and logs warnings.
   * Actual fallback to safe defaults happens at runtime when values are used.
   *
   * @private
   *
   * @example
   * ```typescript
   * // Called automatically during initialization
   * this.validateConfiguration();
   *
   * // Called when configuration changes
   * vscode.workspace.onDidChangeConfiguration((event) => {
   *   if (event.affectsConfiguration('aiTerminal')) {
   *     this.validateConfiguration();
   *   }
   * });
   * ```
   */
  private validateConfiguration(): void {
    const config = vscode.workspace.getConfiguration('aiTerminal');

    // Validate shell path
    const configuredShell = config.get<string>('defaultShell')?.trim();
    if (configuredShell && !validateShellPath(configuredShell)) {
      Logger.warn(
        `Invalid shell path in configuration: "${configuredShell}". ` +
          `Please update the "aiTerminal.defaultShell" setting with a valid absolute path.`,
      );
    }

    // Validate startup commands
    const configuredCommands = config.get<unknown>('startupCommands');
    const validatedCommands = validateStartupCommands(configuredCommands);
    if (
      Array.isArray(configuredCommands) &&
      configuredCommands.length !== validatedCommands.length
    ) {
      const invalidCount = configuredCommands.length - validatedCommands.length;
      Logger.warn(
        `Filtered out ${invalidCount} invalid startup command(s) from configuration. ` +
          `${validatedCommands.length} valid command(s) will be used.`,
      );
    }

    // Validate theme preset
    const rawPresetKey = config.get<string>('themePreset');
    if (rawPresetKey && !isValidPresetKey(rawPresetKey)) {
      Logger.warn(
        `Invalid theme preset in configuration: "${rawPresetKey}". ` +
          `Using default "modern" theme. Please update "aiTerminal.themePreset" setting.`,
      );
    }

    // Validate log level
    const logLevel = config.get<string>('logLevel');
    const validLogLevels = ['error', 'warn', 'info', 'debug'];
    if (logLevel && !validLogLevels.includes(logLevel)) {
      Logger.warn(
        `Invalid log level in configuration: "${logLevel}". ` +
          `Using default "info". Valid options: ${validLogLevels.join(', ')}`,
      );
    }
  }

  /**
   * Generates the HTML content for the webview.
   *
   * Builds a complete HTML document with:
   * - Content Security Policy (CSP) with nonce for script execution
   * - Theme configuration (palette, presets, active selection)
   * - Resource URIs (webview.js, xterm.css, icon)
   * - Inline styles for custom theming
   *
   * The generated HTML includes:
   * - Terminal display area with xterm.js integration
   * - Session management controls (add, remove, select)
   * - Theme selector dropdown
   * - Split view toggle
   * - Resize handles
   *
   * @param webview - The webview instance to generate HTML for
   * @returns The complete HTML string for the webview
   *
   * @remarks
   * - Uses CSP nonce to prevent XSS attacks while allowing inline scripts
   * - All resource URIs are converted to webview URIs for security
   * - Theme values are embedded directly to avoid flash of unstyled content
   *
   * @private
   *
   * @example
   * ```typescript
   * const webview = webviewView.webview;
   * webview.html = this.getHtml(webview);
   * ```
   *
   * @see {@link buildWebviewHtml} for HTML template generation
   * @see {@link getNonce} for CSP nonce generation
   */
  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const theme = this.getThemeValues();
    const iconUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'icon-bit.png'),
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'webview.js'),
    );
    const xtermCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'xterm.css'),
    );

    return buildWebviewHtml({
      webview,
      nonce,
      theme,
      iconUri,
      scriptUri,
      xtermCssUri,
    });
  }
}
