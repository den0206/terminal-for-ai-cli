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
 * Bridges the extension host and the webview UI: session lifecycle, message
 * routing, theme selection and dropped-image storage.
 *
 * Messages are queued while the webview is not ready and flushed once it
 * reports `webview-ready`.
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

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly sessionManager: SessionManager,
  ) {
    this.imageManager = new ImageManager(context);
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
      }),
    );
  }

  /** Disposes listeners, labels, tracked images and queued messages. Idempotent. */
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

  /** Brings the view into focus (command: terminal-for-ai-cli.focus). */
  reveal() {
    this.webviewView?.show?.(true);
  }

  /** Creates a new terminal session (command: terminal-for-ai-cli.newSession). */
  newSession() {
    this.handleSessionRequest();
  }

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
   * Validates configuration, enforces the session limit and creates a session.
   * An invalid shell path falls back to the platform default with a warning.
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
    const invalidCount =
      (configuredCommands?.length ?? 0) - startupCommands.length;
    if (invalidCount > 0) {
      Logger.warn(
        `Filtered out ${invalidCount} invalid startup command(s). ${startupCommands.length} valid command(s) will be executed.`,
      );
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

  private postSessionCount() {
    this.postMessage({
      type: 'session-count',
      payload: {total: this.sessionManager.getSessionCount()},
    });
  }

  /**
   * Posts a message to the webview, or queues it while the webview is not ready.
   * The oldest message is dropped once the queue is full.
   */
  private postMessage(message: OutboundMessage): void {
    if (!this.webviewView || !this.webviewReady) {
      if (this.messageQueue.length >= SHARED_CONSTANTS.MESSAGE_QUEUE_MAX_SIZE) {
        Logger.warn('Message queue is full, dropping oldest message');
        this.messageQueue.shift();
      }
      this.messageQueue.push(message);
      return;
    }
    try {
      this.webviewView.webview.postMessage(message);
    } catch (error) {
      Logger.error('Failed to post message to webview', error);
    }
  }

  private postThemeUpdate() {
    this.postMessage({type: 'theme-update', payload: this.getThemeValues()});
  }

  /** Persists the selected preset to global settings. Invalid keys are ignored. */
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

  /** Drops queued messages for a disposed session so they are not flushed later. */
  private removeSessionFromQueue(sessionId: string) {
    for (let i = this.messageQueue.length - 1; i >= 0; i--) {
      const message = this.messageQueue[i];
      const shouldRemove =
        (message.type === 'session-data' || message.type === 'session-exited')
          ? message.payload.sessionId === sessionId
          : message.type === 'session-created' && message.payload.id === sessionId;
      if (shouldRemove) {
        this.messageQueue.splice(i, 1);
      }
    }
  }

  /** Flushes queued messages once the webview is ready, skipping failures. */
  private flushQueuedMessages() {
    if (!this.webviewView) {
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

  /** Creates a session on first webview-ready if none exist. */
  private ensureInitialSession() {
    if (this.initialSessionEnsured) {
      return;
    }
    this.initialSessionEnsured = true;
    if (this.sessionManager.getSessionCount() === 0) {
      this.handleSessionRequest();
    }
  }

  private async handleClearAllSessions() {
    for (const session of this.sessionManager.getActiveSessions()) {
      this.sessionManager.disposeSession(session.id);
    }
    this.sessionLabels.clear();
    await this.imageManager.clearAllImages();
    this.postMessage({type: 'all-sessions-cleared'});
    this.postSessionCount();
  }

  /**
   * Deletes images left behind by previous sessions.
   * Called on activation and from the cleanupImages command.
   * @returns The number of deleted files
   */
  async cleanupOrphanedImages(): Promise<number> {
    return this.imageManager.cleanupOrphanedImages();
  }

  /** Deletes all saved images. Called on extension deactivation. */
  async clearAllStoredImages(): Promise<void> {
    return this.imageManager.clearAllImages();
  }

  private getThemeValues(): ThemeSnapshot {
    return getThemeSnapshot(vscode.workspace.getConfiguration('aiTerminal'));
  }

  /** Replays active sessions to the webview so it can restore its state. */
  private postExistingSessions() {
    for (const session of this.sessionManager.getActiveSessions()) {
      this.postMessage({
        type: 'session-created',
        payload: {...session, label: this.getOrCreateLabel(session.id)},
      });
    }
  }

  private getOrCreateLabel(sessionId: string) {
    const existing = this.sessionLabels.get(sessionId);
    if (existing) {
      return existing;
    }
    const label = `Terminal ${this.findNextLabelIndex()}`;
    this.sessionLabels.set(sessionId, label);
    return label;
  }

  /** Lowest unused index from 1, so numbers freed by closed sessions are reused. */
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

  /** Stores the dropped image and types its escaped path into the session. */
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

  /** Builds the webview document: CSP nonce, theme values and resource URIs. */
  private getHtml(webview: vscode.Webview): string {
    const uri = (...segments: string[]) =>
      webview.asWebviewUri(
        vscode.Uri.joinPath(this.context.extensionUri, ...segments),
      );

    return buildWebviewHtml({
      webview,
      nonce: getNonce(),
      theme: this.getThemeValues(),
      iconUri: uri('media', 'icon-bit.png'),
      scriptUri: uri('media', 'webview.js'),
      xtermCssUri: uri('media', 'xterm.css'),
    });
  }
}
