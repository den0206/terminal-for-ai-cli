import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  MAX_SESSIONS,
  MAX_IMAGE_SIZE_BYTES,
  MAX_IMAGE_FILENAME_LENGTH,
} from '../constants';
import {SessionManager} from '../terminal/sessionManager';
import {
  THEME_PRESETS,
  ThemePresetKey,
  ThemePreview,
  isValidPresetKey,
} from '../theming/themePresets';
import {Logger} from '../utils/logger';
import {getNonce} from '../utils/nonce';
import {
  getDefaultShell,
  validateShellPath,
  validateStartupCommands,
} from '../utils/validation';
import {ThemeSnapshot, buildWebviewHtml} from './htmlTemplate';

type ThemeOption = {
  key: ThemePresetKey;
  label: string;
  description: string;
  preview: ThemePreview;
};

// Outbound message types (Extension Host -> Webview)
type SessionDataMessage = {
  type: 'session-data';
  payload: {sessionId: string; data: string};
};

type SessionCreatedMessage = {
  type: 'session-created';
  payload: {
    id: string;
    shell: string;
    pid?: number;
    label?: string;
    restored?: boolean;
  };
};

type SessionExitedMessage = {
  type: 'session-exited';
  payload: {
    sessionId: string;
    code: number | null;
    signal: NodeJS.Signals | null;
  };
};

type SessionErrorMessage = {
  type: 'session-error';
  payload: {message: string};
};

type SessionLimitReachedMessage = {
  type: 'session-limit-reached';
  payload: {max: number};
};

type SessionCountMessage = {
  type: 'session-count';
  payload: {total: number};
};

type ThemeUpdateMessage = {
  type: 'theme-update';
  payload: ThemeSnapshot;
};

type AllSessionsClearedMessage = {
  type: 'all-sessions-cleared';
};

type OutboundMessage =
  | SessionDataMessage
  | SessionCreatedMessage
  | SessionExitedMessage
  | SessionErrorMessage
  | SessionLimitReachedMessage
  | SessionCountMessage
  | ThemeUpdateMessage
  | AllSessionsClearedMessage;

// Message types from webview to extension
type WebviewReadyMessage = {
  type: 'webview-ready';
};

type RequestNewSessionMessage = {
  type: 'request-new-session';
  payload?: {cols?: number; rows?: number};
};

type TerminalInputMessage = {
  type: 'terminal-input';
  payload: {sessionId: string; data: string};
};

type TerminalResizeMessage = {
  type: 'terminal-resize';
  payload: {sessionId: string; cols: number; rows: number};
};

type DisposeSessionMessage = {
  type: 'dispose-session';
  payload: {sessionId: string};
};

type DisposeAllSessionsMessage = {
  type: 'dispose-all-sessions';
};

type ThemeSelectMessage = {
  type: 'theme-select';
  payload: {presetKey: string};
};

type ImageDropMessage = {
  type: 'image-drop';
  payload: {fileName: string; mimeType: string; data: string; sessionId: string};
};

type InboundMessage =
  | WebviewReadyMessage
  | RequestNewSessionMessage
  | TerminalInputMessage
  | TerminalResizeMessage
  | DisposeSessionMessage
  | DisposeAllSessionsMessage
  | ThemeSelectMessage
  | ImageDropMessage;

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
  private readonly sessionLabels = new Map<string, string>();
  private readonly sessionImages = new Map<string, Set<string>>();

  /**
   * Creates a new webview provider instance.
   *
   * @param context - The extension context
   * @param sessionManager - The session manager instance
   */
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly sessionManager: SessionManager
  ) {
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
        this.deleteSessionImages(id).catch((error) => {
          Logger.error(`Failed to delete images for session ${id}`, error);
        });
        this.postSessionCount();
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration('aiTerminal.webviewBackground') ||
          event.affectsConfiguration('aiTerminal.webviewForeground')
        ) {
          this.postThemeUpdate();
        }
        // Validate configuration changes
        if (event.affectsConfiguration('aiTerminal')) {
          this.validateConfiguration();
        }
      })
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
    vscode.Disposable.from(...this.disposables).dispose();
    this.sessionLabels.clear();
    this.sessionImages.clear();
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

    const messageDisposable = webview.onDidReceiveMessage((message) => {
      this.handleMessage(message);
    });
    this.disposables.push(messageDisposable);
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
   * - Checks session limit (MAX_SESSIONS) before creating
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
            message.payload.data
          );
          break;
        case 'terminal-resize':
          this.sessionManager.resize(
            message.payload.sessionId,
            message.payload.cols,
            message.payload.rows
          );
          break;
        case 'dispose-session':
          await this.deleteSessionImages(message.payload.sessionId);
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
          await this.handleImageDrop(
            message.payload.fileName,
            message.payload.mimeType,
            message.payload.data,
            message.payload.sessionId
          );
          break;
        default: {
          // TypeScript exhaustive check - this should never happen
          const _exhaustive: never = message;
          Logger.warn(
            `Unknown message type received: ${
              (_exhaustive as InboundMessage).type
            }`
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
    if (this.sessionManager.getSessionCount() >= MAX_SESSIONS) {
      vscode.window.showWarningMessage(
        `Terminal For AI CLI supports up to ${MAX_SESSIONS} sessions.`
      );
      this.postMessage({
        type: 'session-limit-reached',
        payload: {max: MAX_SESSIONS},
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
          `Invalid shell path configured: "${configuredShell}". Using default shell instead.`
        );
        vscode.window.showWarningMessage(
          `Invalid shell path configured: "${configuredShell}". Using default shell instead.`
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
          `Filtered out ${invalidCount} invalid startup command(s). ${validCount} valid command(s) will be executed.`
        );
      }
    }

    try {
      const info = this.sessionManager.createSession({
        shell,
        cols: dimensions?.cols,
        rows: dimensions?.rows,
        startupCommands,
        cwd: this.resolveWorkingDirectory(),
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
        if (errorMessage.includes('enoent') || errorMessage.includes('not found')) {
          userMessage = `Shell not found. Please check your "aiTerminal.defaultShell" setting or ensure your default shell is available.`;
        } else if (errorMessage.includes('eacces') || errorMessage.includes('permission')) {
          userMessage = `Permission denied. Please check that the shell is executable.`;
        } else if (errorMessage.includes('spawn')) {
          userMessage = `Failed to start shell process. Please check your shell configuration.`;
        } else {
          userMessage = `Failed to create session: ${error.message}`;
        }
      }

      vscode.window.showErrorMessage(
        `Terminal For AI CLI: ${userMessage} Check the Output channel for details.`
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
    const monitoringEnabled = config.get<boolean>('enablePerformanceMonitoring', true);

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
        `Consider checking webview connection status.`
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
      vscode.ConfigurationTarget.Global
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
      Logger.debug(`Initial session check: ${sessionCount} session(s) already exist`);
    }
  }

  /**
   * Resolves the working directory for new sessions.
   *
   * Priority order:
   * 1. Active editor's workspace folder
   * 2. Active editor's file directory
   * 3. First workspace folder
   * 4. Cursor-specific environment variables
   * 5. Standard environment variables (PWD, INIT_CWD)
   * 6. process.cwd()
   *
   * @returns The resolved working directory path, or undefined if resolution fails
   * @private
   */
  private resolveWorkingDirectory(): string | undefined {
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(
        activeEditor.document.uri
      );
      if (workspaceFolder?.uri.scheme === 'file') {
        return workspaceFolder.uri.fsPath;
      }

      if (activeEditor.document.uri.scheme === 'file') {
        return path.dirname(activeEditor.document.uri.fsPath);
      }
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders?.length) {
      const preferred = workspaceFolders.find(
        (folder) => folder.uri.scheme === 'file'
      );
      return (preferred ?? workspaceFolders[0]).uri.fsPath;
    }

    const envCandidates = [
      process.env.CURSOR_PROJECT_PATH,
      process.env.CURSOR_WORKSPACE_DIR,
      process.env.CURSOR_CWD,
      process.env.PWD,
      process.env.INIT_CWD,
    ];
    for (const candidate of envCandidates) {
      if (candidate && candidate.trim().length > 0) {
        return candidate;
      }
    }

    try {
      return process.cwd();
    } catch {
      return undefined;
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
      await this.clearAllImages();
      return;
    }

    for (const session of sessions) {
      this.sessionManager.disposeSession(session.id);
    }
    this.sessionLabels.clear();
    this.postMessage({type: 'all-sessions-cleared'});
    this.postSessionCount();
    await this.clearAllImages();
  }

  /**
   * Deletes all images associated with a session.
   *
   * @param sessionId - The session ID whose images should be deleted
   * @remarks Continues deleting other images even if one fails.
   * @private
   */
  private async deleteSessionImages(sessionId: string) {
    const imagePaths = this.sessionImages.get(sessionId);
    if (!imagePaths || imagePaths.size === 0) {
      return;
    }

    for (const imagePath of imagePaths) {
      try {
        const imageUri = vscode.Uri.file(imagePath);
        await vscode.workspace.fs.delete(imageUri, {useTrash: false});
      } catch (error) {
        Logger.warn(`Failed to delete image ${imagePath}`, error);
        // Continue deleting other images even if one fails
      }
    }

    this.sessionImages.delete(sessionId);
  }

  /**
   * Clears all saved images from global storage.
   *
   * Deletes the entire images directory and clears session image tracking.
   * Errors are logged but not shown to the user as this is a background operation.
   *
   * @private
   */
  private async clearAllImages() {
    try {
      const storageUri = this.context.globalStorageUri;
      const imagesDir = vscode.Uri.joinPath(storageUri, 'images');

      try {
        await vscode.workspace.fs.delete(imagesDir, {
          recursive: true,
          useTrash: false,
        });
      } catch (error) {
        // Ignore errors if the directory doesn't exist
        if (error instanceof vscode.FileSystemError) {
          // Directory might not exist, which is fine
          return;
        }
        throw error;
      }
    } catch (error) {
      Logger.warn('Failed to clear images', error);
      // Don't show error to user as this is a background cleanup operation
    }

    // Clear all session image tracking
    this.sessionImages.clear();
  }

  /**
   * Cleanup orphaned images from previous sessions that weren't properly cleaned up.
   * This is called on extension activation and can be called manually.
   * @returns The number of deleted files
   */
  async cleanupOrphanedImages(): Promise<number> {
    try {
      const storageUri = this.context.globalStorageUri;
      const imagesDir = vscode.Uri.joinPath(storageUri, 'images');

      let files: [string, vscode.FileType][];
      try {
        files = await vscode.workspace.fs.readDirectory(imagesDir);
      } catch {
        // Directory doesn't exist, nothing to clean up
        return 0;
      }

      let deletedCount = 0;
      for (const [fileName, fileType] of files) {
        if (fileType === vscode.FileType.File) {
          try {
            const fileUri = vscode.Uri.joinPath(imagesDir, fileName);
            await vscode.workspace.fs.delete(fileUri, {useTrash: false});
            deletedCount++;
          } catch (error) {
            Logger.warn(`Failed to delete orphaned image ${fileName}`, error);
          }
        }
      }

      if (deletedCount > 0) {
        Logger.info(`Cleaned up ${deletedCount} orphaned image(s)`);
      }

      return deletedCount;
    } catch (error) {
      Logger.error('Failed to cleanup orphaned images', error);
      return 0;
    }
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
    const rawPresetKey = config.get<string>('themePreset');

    let presetKey: ThemePresetKey = 'modern';
    if (rawPresetKey && isValidPresetKey(rawPresetKey)) {
      presetKey = rawPresetKey;
    } else if (rawPresetKey) {
      // Log warning when user has configured an invalid theme preset
      Logger.warn(
        `Invalid theme preset configured: "${rawPresetKey}". Using default "modern" theme instead. ` +
        `Valid options: ${Object.keys(THEME_PRESETS).join(', ')}`
      );
    }

    const activePreset = THEME_PRESETS[presetKey] ?? THEME_PRESETS.modern;
    const palette = activePreset.palette;
    const presets: ThemeOption[] = Object.entries(THEME_PRESETS)
      .filter(
        (
          entry
        ): entry is [
          ThemePresetKey,
          (typeof THEME_PRESETS)[ThemePresetKey]
        ] => {
          const [key] = entry;
          return isValidPresetKey(key);
        }
      )
      .map(([key, value]) => ({
        key,
        label: value.label,
        description: value.description,
        preview: value.preview,
      }));
    return {presetKey, palette, presets};
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
   * Validates the image file (MIME type, size, filename), saves it to global storage,
   * and writes the escaped file path to the terminal session to prevent command injection.
   *
   * @param fileName - The original filename of the dropped image
   * @param mimeType - The MIME type of the image (must start with 'image/')
   * @param base64Data - Base64-encoded image data
   * @param sessionId - The ID of the session to write the image path to
   * @throws {Error} If the image is invalid, too large (>10MB), or save fails
   * @remarks File names are sanitized and truncated if necessary. The path is properly
   *          escaped for shell execution to prevent command injection attacks.
   * @private
   */
  private async handleImageDrop(
    fileName: string,
    mimeType: string,
    base64Data: string,
    sessionId: string
  ) {
    try {
      // Validate MIME type
      if (!mimeType || !mimeType.startsWith('image/')) {
        throw new Error('Invalid file type: Only image files are supported');
      }

      // Validate base64 data
      if (
        !base64Data ||
        typeof base64Data !== 'string' ||
        base64Data.trim().length === 0
      ) {
        throw new Error('Invalid base64 data provided');
      }

      // Decode and validate size
      let buffer: Buffer;
      try {
        buffer = Buffer.from(base64Data, 'base64');
      } catch {
        throw new Error('Failed to decode base64 data');
      }

      // Check file size limit
      if (buffer.length > MAX_IMAGE_SIZE_BYTES) {
        const sizeMB = (buffer.length / (1024 * 1024)).toFixed(2);
        const maxMB = (MAX_IMAGE_SIZE_BYTES / (1024 * 1024)).toFixed(0);
        throw new Error(
          `Image file too large: ${sizeMB}MB (maximum: ${maxMB}MB)`
        );
      }

      // Validate filename
      if (
        !fileName ||
        typeof fileName !== 'string' ||
        fileName.trim().length === 0
      ) {
        throw new Error('Invalid filename provided');
      }

      // Sanitize and validate filename length
      const sanitizedFileName = fileName
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .trim();
      if (sanitizedFileName.length === 0) {
        throw new Error('Filename contains no valid characters');
      }

      const timestamp = Date.now();
      let uniqueFileName = `${timestamp}_${sanitizedFileName}`;

      // Ensure total filename length doesn't exceed filesystem limits
      if (uniqueFileName.length > MAX_IMAGE_FILENAME_LENGTH) {
        const extension = path.extname(sanitizedFileName);
        const nameWithoutExt = path.basename(sanitizedFileName, extension);
        const maxNameLength =
          MAX_IMAGE_FILENAME_LENGTH -
          timestamp.toString().length -
          extension.length -
          2; // -2 for underscores
        const truncatedName = nameWithoutExt.substring(
          0,
          Math.max(1, maxNameLength)
        );
        uniqueFileName = `${timestamp}_${truncatedName}${extension}`;
        Logger.warn(
          `Filename truncated due to length limit: ${fileName} -> ${uniqueFileName}`
        );
      }

      const storageUri = this.context.globalStorageUri;
      await vscode.workspace.fs.createDirectory(storageUri);

      const imagesDir = vscode.Uri.joinPath(storageUri, 'images');
      await vscode.workspace.fs.createDirectory(imagesDir);

      const imageUri = vscode.Uri.joinPath(imagesDir, uniqueFileName);

      await vscode.workspace.fs.writeFile(imageUri, buffer);

      // Track which session used this image
      if (!this.sessionImages.has(sessionId)) {
        this.sessionImages.set(sessionId, new Set());
      }
      const sessionImageSet = this.sessionImages.get(sessionId);
      if (sessionImageSet) {
        sessionImageSet.add(imageUri.fsPath);
      }

      const imagePath = imageUri.fsPath;
      // Properly escape shell special characters to prevent injection
      const escapedPath = this.escapeShellPath(imagePath);

      this.sessionManager.write(sessionId, escapedPath);
    } catch (error) {
      Logger.error('Failed to save image', error);

      // Provide user-friendly error messages
      let userMessage = 'Failed to save image.';
      if (error instanceof Error) {
        const errorMessage = error.message.toLowerCase();
        if (errorMessage.includes('too large')) {
          userMessage = error.message; // Already user-friendly
        } else if (errorMessage.includes('invalid file type')) {
          userMessage = 'Only image files are supported.';
        } else if (errorMessage.includes('invalid base64')) {
          userMessage = 'Invalid image data. Please try dropping the image again.';
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
   * Escapes shell special characters in a path to prevent command injection.
   *
   * - Windows: Wraps path in double quotes and escapes internal double quotes
   * - Unix-like: Wraps path in single quotes (which prevent all interpretation)
   *
   * @param filePath - The file path to escape
   * @returns The escaped file path safe for shell execution
   * @private
   */
  private escapeShellPath(filePath: string): string {
    if (process.platform === 'win32') {
      // Windows: wrap in double quotes and escape internal double quotes
      return `"${filePath.replace(/"/g, '""')}"`;
    }
    // Unix: wrap in single quotes (single quotes prevent all interpretation)
    // Escape any existing single quotes by ending the quote, adding escaped quote, and starting new quote
    return `'${filePath.replace(/'/g, "'\\''")}'`;
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
        `Please update the "aiTerminal.defaultShell" setting with a valid absolute path.`
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
        `${validatedCommands.length} valid command(s) will be used.`
      );
    }

    // Validate theme preset
    const rawPresetKey = config.get<string>('themePreset');
    if (rawPresetKey && !isValidPresetKey(rawPresetKey)) {
      Logger.warn(
        `Invalid theme preset in configuration: "${rawPresetKey}". ` +
        `Using default "modern" theme. Please update "aiTerminal.themePreset" setting.`
      );
    }

    // Validate log level
    const logLevel = config.get<string>('logLevel');
    const validLogLevels = ['error', 'warn', 'info', 'debug'];
    if (logLevel && !validLogLevels.includes(logLevel)) {
      Logger.warn(
        `Invalid log level in configuration: "${logLevel}". ` +
        `Using default "info". Valid options: ${validLogLevels.join(', ')}`
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
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'icon-bit.png')
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'webview.js')
    );
    const xtermCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'xterm.css')
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
