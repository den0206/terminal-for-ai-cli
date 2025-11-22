import * as vscode from 'vscode';
import {SessionManager} from './terminal/sessionManager';
import {Logger} from './utils/logger';
import {AiTerminalViewProvider} from './view/aiTerminalViewProvider';

const VIEW_ID = 'terminal-for-ai-cli-view';
const CONTAINER_COMMAND = 'workbench.view.extension.terminal-for-ai-cli';

export function activate(context: vscode.ExtensionContext) {
  // Initialize logger first
  Logger.initialize(context);
  Logger.info('Terminal For AI CLI extension activated');

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
