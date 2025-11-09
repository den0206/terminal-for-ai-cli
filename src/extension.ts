import * as vscode from 'vscode';
import { SessionManager } from './terminal/sessionManager';

const VIEW_ID = 'ai-terminal-view';
const CONTAINER_COMMAND = 'workbench.view.extension.ai-terminal';

export function activate(context: vscode.ExtensionContext) {
  const sessionManager = new SessionManager();
  const provider = new AiTerminalViewProvider(context, sessionManager);

  context.subscriptions.push(
    sessionManager,
    provider,
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    vscode.commands.registerCommand('ai-terminal.focus', () => {
      vscode.commands.executeCommand(CONTAINER_COMMAND);
      provider.reveal();
    }),
    vscode.commands.registerCommand('ai-terminal.newSession', () => {
      provider.newSession();
    })
  );
}

export function deactivate() {
  // handled by disposables registered in activate()
}

class AiTerminalViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private webviewView?: vscode.WebviewView;
  private webviewReady = false;
  private readonly messageQueue: unknown[] = [];
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly sessionManager: SessionManager
  ) {
    this.disposables.push(
      this.sessionManager.onDidWriteData(({ id, data }) => {
        this.postMessage({ type: 'session-data', payload: { sessionId: id, data } });
      }),
      this.sessionManager.onDidExit(({ id, code, signal }) => {
        this.postMessage({ type: 'session-exited', payload: { sessionId: id, code, signal } });
        this.postSessionCount();
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
      localResourceRoots: [this.context.extensionUri]
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
        break;
      case 'request-new-session':
        this.handleSessionRequest(message.payload);
        break;
      case 'terminal-input':
        if (message.payload?.sessionId && typeof message.payload.data === 'string') {
          this.sessionManager.write(message.payload.sessionId, message.payload.data);
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
      default:
        break;
    }
  }

  private handleSessionRequest(dimensions?: { cols?: number; rows?: number }) {
    const config = vscode.workspace.getConfiguration('aiTerminal');
    const shell = config.get<string>('defaultShell')?.trim() || undefined;
    const startupCommands = config.get<string[]>('startupCommands') ?? [];

    try {
      const info = this.sessionManager.createSession({
        shell,
        cols: dimensions?.cols,
        rows: dimensions?.rows,
        startupCommands
      });

      this.postMessage({ type: 'session-created', payload: info });
      this.postSessionCount();
    } catch (error) {
      console.error('Failed to create AI Terminal session', error);
      vscode.window.showErrorMessage('AI Terminal: セッションを作成できませんでした。詳細は開発者ツールを確認してください。');
      this.postMessage({
        type: 'session-error',
        payload: { message: error instanceof Error ? error.message : String(error) }
      });
    }
  }

  private postSessionCount() {
    this.postMessage({ type: 'session-count', payload: { total: this.sessionManager.getSessionCount() } });
  }

  private postMessage(message: unknown) {
    if (!this.webviewView || !this.webviewReady) {
      this.messageQueue.push(message);
      return;
    }
    this.webviewView.webview.postMessage(message);
  }

  private flushQueuedMessages() {
    if (!this.webviewView || !this.webviewReady || this.messageQueue.length === 0) {
      return;
    }
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (message) {
        this.webviewView.webview.postMessage(message);
      }
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
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
          <title>AI Terminal</title>
          <link rel="stylesheet" href="${xtermCssUri}" />
          <style>
            :root {
              color-scheme: light dark;
            }
            body {
              padding: 12px;
              margin: 0;
              font-family: var(--vscode-font-family);
              font-size: var(--vscode-font-size);
              color: var(--vscode-foreground);
              background: var(--vscode-sideBar-background);
              display: flex;
              flex-direction: column;
              gap: 0.75rem;
            }
            #terminal-root {
              border-radius: 6px;
              border: 1px solid color-mix(in srgb, var(--vscode-descriptionForeground) 50%, transparent);
              background: color-mix(in srgb, var(--vscode-editor-background) 80%, transparent);
              min-height: 220px;
              padding: 0.25rem;
            }
            button {
              align-self: center;
              padding: 0.4rem 1rem;
              border-radius: 4px;
              border: 1px solid var(--vscode-button-border, transparent);
              background: var(--vscode-button-background);
              color: var(--vscode-button-foreground);
              cursor: pointer;
            }
            .header {
              display: flex;
              justify-content: space-between;
              align-items: center;
              gap: 0.5rem;
            }
          </style>
        </head>
        <body>
          <header class="header">
            <div style="display:flex;align-items:center;gap:0.5rem;">
              <img src="${iconUri}" alt="AI Terminal" width="20" height="20" />
              <strong>AI Terminal</strong>
            </div>
            <span data-session-status>初期化中…</span>
          </header>
          <div id="terminal-root" aria-label="ターミナル"></div>
          <section>
            <h3 style="font-size:0.85rem;margin:0 0 0.25rem;">イベントログ</h3>
            <ul data-session-log style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:0.25rem;font-size:0.85rem;">
              <li>拡張機能が読み込まれました</li>
            </ul>
          </section>
          <button data-action="new-session">新しいセッション</button>
          <script nonce="${nonce}" src="${scriptUri}"></script>
        </body>
      </html>`;
  }
}

function getNonce() {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 16; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
