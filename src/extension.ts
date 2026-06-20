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

  // Cleanup orphaned images from previous sessions on startup
  provider.cleanupOrphanedImages().catch((error) => {
    Logger.error('Failed to cleanup orphaned images on startup', error);
  });

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
    }),
    vscode.commands.registerCommand(
      'terminal-for-ai-cli.cleanupImages',
      async () => {
        const result = await vscode.window.showWarningMessage(
          'すべての保存済み画像を削除しますか？',
          {modal: true},
          '削除'
        );

        if (result === '削除') {
          const deletedCount = await provider.cleanupOrphanedImages();
          if (deletedCount > 0) {
            vscode.window.showInformationMessage(
              `${deletedCount}個の画像を削除しました`
            );
          } else {
            vscode.window.showInformationMessage(
              '削除する画像がありませんでした'
            );
          }
        }
      }
    )
  );
}

export function deactivate() {}
