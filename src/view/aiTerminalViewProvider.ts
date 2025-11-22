import * as path from 'node:path';
import * as vscode from 'vscode';
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

const MAX_SESSIONS = 2;
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_IMAGE_FILENAME_LENGTH = 255;

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
  payload: {fileName: string; data: string; sessionId: string};
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

export class AiTerminalViewProvider
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  private webviewView?: vscode.WebviewView;
  private webviewReady = false;
  private readonly messageQueue: OutboundMessage[] = [];
  private readonly disposables: vscode.Disposable[] = [];
  private readonly sessionLabels = new Map<string, string>();
  private readonly sessionImages = new Map<string, Set<string>>();

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
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this.webviewView = webviewView;
    this.webviewReady = false;

    const webview = webviewView.webview;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };

    webview.html = this.getHtml(webview);

    webview.onDidReceiveMessage((message) => {
      this.handleMessage(message);
    });
  }

  reveal() {
    if (this.webviewView) {
      this.webviewView.show?.(true);
    }
  }

  newSession() {
    this.handleSessionRequest();
  }

  private async handleMessage(message: InboundMessage): Promise<void> {
    try {
      switch (message.type) {
        case 'webview-ready':
          this.webviewReady = true;
          this.postSessionCount();
          this.flushQueuedMessages();
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
      vscode.window.showErrorMessage(
        'Terminal For AI CLI: Failed to create a session. Please check the Output channel for details.'
      );
      this.postMessage({
        type: 'session-error',
        payload: {
          message: error instanceof Error ? error.message : String(error),
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
    if (
      !this.webviewView ||
      !this.webviewReady ||
      this.messageQueue.length === 0
    ) {
      return;
    }
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (message) {
        this.webviewView.webview.postMessage(message);
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
    const presetKey: ThemePresetKey =
      rawPresetKey && isValidPresetKey(rawPresetKey) ? rawPresetKey : 'modern';
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
    base64Data: string,
    sessionId: string
  ) {
    try {
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
      const quotedPath = imagePath.includes(' ') ? `"${imagePath}"` : imagePath;

      this.sessionManager.write(sessionId, `${quotedPath}`);
    } catch (error) {
      Logger.error('Failed to save image', error);
      vscode.window.showErrorMessage(
        `Failed to save image: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
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
