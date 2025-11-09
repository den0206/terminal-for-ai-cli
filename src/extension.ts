import * as vscode from 'vscode';

const VIEW_ID = 'ai-terminal-view';
const CONTAINER_COMMAND = 'workbench.view.extension.ai-terminal';

export function activate(context: vscode.ExtensionContext) {
  const provider = new AiTerminalViewProvider(context);

  context.subscriptions.push(
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
  // Nothing to cleanup explicitly for now
}

class AiTerminalViewProvider implements vscode.WebviewViewProvider {
  private webviewView?: vscode.WebviewView;

  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this.webviewView = webviewView;

    const webview = webviewView.webview;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri]
    };

    webview.html = this.getHtml(webview);

    webview.onDidReceiveMessage((message) => {
      if (message?.type === 'request-new-session') {
        this.handleSessionRequest();
      }
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

  private handleSessionRequest() {
    this.webviewView?.webview.postMessage({
      type: 'new-session',
      payload: { timestamp: Date.now() }
    });
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const toolkitUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'terminal.svg')
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'webview.js')
    );

    return /* html */ `<!DOCTYPE html>
      <html lang="ja">
        <head>
          <meta charset="UTF-8" />
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>AI Terminal</title>
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
            .placeholder {
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              text-align: center;
              border: 1px dashed var(--vscode-descriptionForeground);
              border-radius: 6px;
              padding: 1.5rem;
              min-height: 220px;
              background: color-mix(in srgb, var(--vscode-editor-background) 80%, transparent);
            }
            .placeholder img {
              width: 48px;
              height: 48px;
              opacity: 0.6;
              margin-bottom: 0.75rem;
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
          </style>
        </head>
        <body>
          <header>
            <div style="display:flex;align-items:center;gap:0.5rem;">
              <img src="${toolkitUri}" alt="AI Terminal" width="20" height="20" />
              <strong>AI Terminal</strong>
            </div>
            <span data-session-status>初期化中…</span>
          </header>
          <div class="placeholder" id="terminal-root">
            <p>ここに xterm.js を描画します。現在は UI の土台を準備しています。</p>
          </div>
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
