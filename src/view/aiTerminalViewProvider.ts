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
 * Manages communication between the extension host and webview,
 * handles session lifecycle, theme management, and image handling.
 */
export class AiTerminalViewProvider
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  private webviewView?: vscode.WebviewView;
  private webviewReady = false;
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
      })
    );
  }

  dispose() {
    vscode.Disposable.from(...this.disposables).dispose();
    this.sessionLabels.clear();
    this.sessionImages.clear();
    this.messageQueue.length = 0;
    this.webviewView = undefined;
    this.webviewReady = false;
  }

  /**
   * Resolves the webview view when it becomes visible.
   * Sets up the webview HTML and message handlers.
   *
   * @param webviewView - The webview view instance
   */
  resolveWebviewView(webviewView: vscode.WebviewView) {
    this.webviewView = webviewView;
    this.webviewReady = false;

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
   */
  reveal() {
    if (this.webviewView) {
      this.webviewView.show?.(true);
    }
  }

  /**
   * Creates a new terminal session.
   * Called from the command palette or programmatically.
   */
  newSession() {
    this.handleSessionRequest();
  }

  private async handleMessage(message: InboundMessage): Promise<void> {
    try {
      switch (message.type) {
        case 'webview-ready':
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

  private postSessionCount() {
    this.postMessage({
      type: 'session-count',
      payload: {total: this.sessionManager.getSessionCount()},
    });
  }

  private postMessage(message: OutboundMessage): void {
    if (!this.webviewView || !this.webviewReady) {
      // Limit queue size to prevent memory issues
      if (this.messageQueue.length >= 100) {
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

  private ensureInitialSession() {
    if (this.sessionManager.getSessionCount() === 0) {
      this.handleSessionRequest();
    }
  }

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

  private getOrCreateLabel(sessionId: string) {
    const existing = this.sessionLabels.get(sessionId);
    if (existing) {
      return existing;
    }
    const label = `Terminal ${this.findNextLabelIndex()}`;
    this.sessionLabels.set(sessionId, label);
    return label;
  }

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
   * Escape shell special characters in a path to prevent command injection
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
