import * as path from 'node:path';
import * as vscode from 'vscode';
import {SessionManager} from './terminal/sessionManager';

const VIEW_ID = 'terminal-for-ai-cli-view';
const CONTAINER_COMMAND = 'workbench.view.extension.terminal-for-ai-cli';
type ThemePresetKey =
  | 'modern'
  | 'basic'
  | 'clearDark'
  | 'clearLight'
  | 'grass'
  | 'homebrew'
  | 'manPage'
  | 'ocean'
  | 'pro';

type ThemePreset = {
  label: string;
  description: string;
  palette: {
    background: string;
    foreground: string;
    cursor: string;
    selection: string;
  };
  preview: {background: string; foreground: string};
};

const THEME_PRESETS: Record<ThemePresetKey, ThemePreset> = {
  modern: {
    label: 'Modern',
    description: 'A subdued palette that blends with VS Code themes',
    palette: {
      background: `color-mix(in srgb, var(--vscode-editor-background) 85%, transparent)`,
      foreground: `var(--vscode-foreground)`,
      cursor: `var(--vscode-terminalCursor-foreground, #ffffff)`,
      selection: `color-mix(in srgb, var(--vscode-editor-selectionBackground, rgba(255,255,255,0.15)) 80%, transparent)`,
    },
    preview: {background: '#1f1f1f', foreground: '#f0f0f0'},
  },
  basic: {
    label: 'Basic',
    description: 'Classic black background with white text',
    palette: {
      background: '#050505',
      foreground: '#f8f8f2',
      cursor: '#fefefe',
      selection: 'rgba(255,255,255,0.2)',
    },
    preview: {background: '#050505', foreground: '#f8f8f2'},
  },
  clearDark: {
    label: 'Clear Dark',
    description: 'Dark gray background with soft cyan accents',
    palette: {
      background: '#2b303b',
      foreground: '#c0c5ce',
      cursor: '#8fa1b3',
      selection: 'rgba(143,161,179,0.45)',
    },
    preview: {background: '#2b303b', foreground: '#c0c5ce'},
  },
  clearLight: {
    label: 'Clear Light',
    description: 'Light background with gentle dark text',
    palette: {
      background: '#f4f4f2',
      foreground: '#2b2b2b',
      cursor: '#000000',
      selection: 'rgba(0,0,0,0.2)',
    },
    preview: {background: '#f4f4f2', foreground: '#2b2b2b'},
  },
  grass: {
    label: 'Grass',
    description: 'Green retro terminal aesthetic',
    palette: {
      background: '#253120',
      foreground: '#d4fcbc',
      cursor: '#c8ff91',
      selection: 'rgba(212,252,188,0.35)',
    },
    preview: {background: '#2c3a27', foreground: '#d4fcbc'},
  },
  homebrew: {
    label: 'Homebrew',
    description: 'Neo green, Homebrew-inspired glow',
    palette: {
      background: '#000000',
      foreground: '#39ff14',
      cursor: '#39ff14',
      selection: 'rgba(57,255,20,0.35)',
    },
    preview: {background: '#000000', foreground: '#39ff14'},
  },
  manPage: {
    label: 'Man Page',
    description: 'Muted, paper-like tones reminiscent of man pages',
    palette: {
      background: '#fdf6e3',
      foreground: '#584b24',
      cursor: '#657b83',
      selection: 'rgba(60,60,60,0.25)',
    },
    preview: {background: '#fdf6e3', foreground: '#584b24'},
  },
  ocean: {
    label: 'Ocean',
    description: 'High-contrast blue and white palette',
    palette: {
      background: '#001f3f',
      foreground: '#d0ebff',
      cursor: '#7fdbff',
      selection: 'rgba(127,219,255,0.35)',
    },
    preview: {background: '#001f3f', foreground: '#d0ebff'},
  },
  pro: {
    label: 'Pro',
    description: 'Dark gray inspired by silver hardware accents',
    palette: {
      background: '#262626',
      foreground: '#e5e5e5',
      cursor: '#ffffff',
      selection: 'rgba(229,229,229,0.3)',
    },
    preview: {background: '#262626', foreground: '#e5e5e5'},
  },
};

export function activate(context: vscode.ExtensionContext) {
  const sessionManager = new SessionManager();
  const provider = new AiTerminalViewProvider(context, sessionManager);

  context.subscriptions.push(
    sessionManager,
    provider,
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider, {
      webviewOptions: {retainContextWhenHidden: true},
    }),
    vscode.commands.registerCommand('terminal-for-ai-cli.focus', () => {
      vscode.commands.executeCommand(CONTAINER_COMMAND);
      provider.reveal();
    }),
    vscode.commands.registerCommand('terminal-for-ai-cli.newSession', () => {
      provider.newSession();
    })
  );
}

export function deactivate() {
  // handled by disposables registered in activate()
}

class AiTerminalViewProvider
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  private webviewView?: vscode.WebviewView;
  private webviewReady = false;
  private readonly messageQueue: unknown[] = [];
  private readonly disposables: vscode.Disposable[] = [];
  private readonly sessionLabels = new Map<string, string>();

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

  private handleMessage(message: any) {
    switch (message?.type) {
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
        if (
          message.payload?.sessionId &&
          typeof message.payload.data === 'string'
        ) {
          this.sessionManager.write(
            message.payload.sessionId,
            message.payload.data
          );
        }
        break;
      case 'terminal-resize':
        if (message.payload?.sessionId) {
          this.sessionManager.resize(
            message.payload.sessionId,
            Number(message.payload.cols) || 0,
            Number(message.payload.rows) || 0
          );
        }
        break;
      case 'dispose-session':
        if (message.payload?.sessionId) {
          this.sessionManager.disposeSession(message.payload.sessionId);
        }
        break;
      case 'theme-select':
        if (message.payload?.presetKey) {
          this.updateThemePreset(message.payload.presetKey);
        }
        break;
      default:
        break;
    }
  }

  private handleSessionRequest(dimensions?: {cols?: number; rows?: number}) {
    const config = vscode.workspace.getConfiguration('aiTerminal');
    const shell = config.get<string>('defaultShell')?.trim() || undefined;
    const startupCommands = config.get<string[]>('startupCommands') ?? [];

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
      console.error('Failed to create Terminal For AI CLI session', error);
      vscode.window.showErrorMessage(
        'Terminal For AI CLI: Failed to create a session. Please check the developer tools for details.'
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

  private postMessage(message: unknown) {
    if (!this.webviewView || !this.webviewReady) {
      this.messageQueue.push(message);
      return;
    }
    this.webviewView.webview.postMessage(message);
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

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const theme = this.getThemeValues();
    const iconUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'terminal.svg')
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'webview.js')
    );
    const xtermCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'xterm.css')
    );

    return /* html */ `<!DOCTYPE html>
      <html lang="ja">
        <head>
          <meta charset="UTF-8" />
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Terminal For AI CLI</title>
          <link rel="stylesheet" href="${xtermCssUri}" />
          <style>
            :root {
              color-scheme: light dark;
              --terminal-bg: ${theme.palette.background};
              --terminal-fg: ${theme.palette.foreground};
            }
            html,
            body {
              height: 100%;
            }
            body {
              padding: 12px;
              margin: 0;
              box-sizing: border-box;
              font-family: var(--vscode-font-family);
              font-size: var(--vscode-font-size);
              color: var(--terminal-fg);
              background: var(--vscode-sideBar-background);
              display: flex;
              flex-direction: column;
              gap: 0.75rem;
            }
            .header {
              display: flex;
              justify-content: space-between;
              align-items: center;
              gap: 0.5rem;
            }
            .controls {
              display: flex;
              align-items: center;
              gap: 0.5rem;
            }
            .controls select {
              flex: 1;
              background: var(--vscode-dropdown-background);
              color: var(--vscode-dropdown-foreground);
              border: 1px solid var(--vscode-dropdown-border, transparent);
              border-radius: 4px;
              padding: 0.2rem 0.4rem;
            }
            .icon-button {
              width: 28px;
              height: 28px;
              border-radius: 4px;
              border: 1px solid var(--vscode-button-border, transparent);
              background: var(--vscode-button-background);
              color: var(--vscode-button-foreground);
              font-size: 1rem;
              display: inline-flex;
              align-items: center;
              justify-content: center;
              cursor: pointer;
              padding: 0;
            }
            .icon-button:disabled {
              opacity: 0.6;
              cursor: default;
            }
            .terminal-shell {
              flex: 0 0 auto;
              display: flex;
              flex-direction: column;
              min-height: 240px;
              height: var(--terminal-height, 640px);
            }
            #terminal-root {
              flex: 1 1 auto;
              border-radius: 6px;
              border: 1px solid color-mix(in srgb, var(--terminal-fg) 30%, transparent);
              background: var(--terminal-bg);
              padding: 0.25rem;
              overflow: hidden;
            }
            .terminal-resizer {
              flex: 0 0 auto;
              height: 8px;
              cursor: row-resize;
              display: flex;
              align-items: center;
              justify-content: center;
              color: color-mix(in srgb, var(--terminal-fg) 70%, transparent);
            }
            .terminal-resizer::after {
              content: '';
              width: 60px;
              height: 2px;
              border-radius: 999px;
              background: currentColor;
              opacity: 0.6;
            }
            .theme-picker {
              display: flex;
              flex-direction: column;
              gap: 0.25rem;
            }
            .theme-picker__control {
              display: flex;
              align-items: center;
              gap: 0.5rem;
            }
            select[data-theme-select] {
              flex: 0 0 220px;
              background: var(--vscode-dropdown-background);
              color: var(--vscode-dropdown-foreground);
              border: 1px solid var(--vscode-dropdown-border, transparent);
              border-radius: 4px;
              padding: 0.2rem 0.5rem;
              font-size: 0.85rem;
            }
            .theme-preview {
              display: inline-flex;
              align-items: center;
              gap: 0.4rem;
              padding: 0.35rem 0.5rem;
              border-radius: 4px;
              border: 1px solid color-mix(in srgb, var(--terminal-fg) 25%, transparent);
              background: color-mix(in srgb, var(--terminal-bg) 70%, transparent);
              font-size: 0.75rem;
              width: fit-content;
            }
            .theme-preview__swatch {
              width: 32px;
              height: 16px;
              border-radius: 999px;
              box-shadow: inset 0 0 0 1px rgba(0,0,0,0.3);
            }
            section {
              flex: 0 0 auto;
            }
          </style>
        </head>
        <body>
          <header class="header">
            <div style="display:flex;align-items:center;gap:0.5rem;">
              <img src="${iconUri}" alt="Terminal For AI CLI" width="20" height="20" />
              <strong>Terminal For AI CLI</strong>
            </div>
            <span data-session-status>Initializing...</span>
          </header>
          <div class="controls" aria-label="Session controls">
            <select data-session-select></select>
            <button class="icon-button" data-session-add title="New session">+</button>
            <button class="icon-button" data-session-remove title="Close session">🗑</button>
          </div>
          <div class="terminal-shell" data-terminal-shell>
            <div id="terminal-root" aria-label="Terminal"></div>
            <div class="terminal-resizer" data-terminal-resizer aria-label="Adjust height"></div>
          </div>
          <section class="theme-picker" aria-label="Theme selector">
            <label style="font-size:0.85rem;display:flex;flex-direction:column;gap:0.35rem;">
              Theme
              <div class="theme-picker__control">
                <select data-theme-select></select>
                <span data-theme-active-label style="font-size:0.75rem;opacity:0.8;">―</span>
              </div>
            </label>
            <div class="theme-preview" data-theme-preview>
              <span class="theme-preview__swatch" data-theme-swatch></span>
              <span data-theme-preview-text>Preview</span>
            </div>
          </section>
          <script nonce="${nonce}" src="${scriptUri}"></script>
        </body>
      </html>`;
  }

  private getThemeValues() {
    const config = vscode.workspace.getConfiguration('aiTerminal');
    const presetKey =
      (config.get<string>('themePreset') as ThemePresetKey) ?? 'modern';
    const activePreset = THEME_PRESETS[presetKey] ?? THEME_PRESETS.modern;
    const palette = activePreset.palette;
    const presets = Object.entries(THEME_PRESETS).map(([key, value]) => ({
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
    const label = `Terminal ${this.sessionSequence++}`;
    this.sessionLabels.set(sessionId, label);
    this.bumpSequenceFromLabel(label);
    return label;
  }

  private bumpSequenceFromLabel(label: string) {
    const match = label.match(/Terminal\s*(\d+)/);
    if (match) {
      this.sessionSequence = Math.max(
        this.sessionSequence,
        Number(match[1]) + 1
      );
    }
  }
}

function getNonce() {
  const possible =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 16; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

function isValidPresetKey(key: string): key is ThemePresetKey {
  return Object.prototype.hasOwnProperty.call(THEME_PRESETS, key);
}
