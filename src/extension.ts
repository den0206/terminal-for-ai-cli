import * as vscode from 'vscode';
import {SessionManager} from './terminal/sessionManager';
import {Logger} from './utils/logger';
import {AiTerminalViewProvider} from './view/aiTerminalViewProvider';

/**
 * View ID for the Terminal For AI CLI webview
 * @internal
 */
const VIEW_ID = 'terminal-for-ai-cli-view';

/**
 * Command ID to open the Terminal For AI CLI container in the activity bar
 * @internal
 */
const CONTAINER_COMMAND = 'workbench.view.extension.terminal-for-ai-cli';

/**
 * Activates the Terminal For AI CLI extension.
 *
 * This is the main entry point for the extension. It performs the following initialization:
 * 1. Initializes the centralized logging system
 * 2. Creates the session manager for terminal process management
 * 3. Creates the webview provider for UI rendering
 * 4. Registers VS Code commands (focus, new session, cleanup images)
 * 5. Sets up automatic cleanup of orphaned images on startup
 *
 * All resources are registered as disposables to ensure proper cleanup on deactivation.
 *
 * @param context - The extension context provided by VS Code, used for managing subscriptions and storage
 *
 * @example
 * ```typescript
 * // This function is automatically called by VS Code when the extension is activated
 * activate(context);
 * ```
 *
 * @remarks
 * The extension is activated when:
 * - The user opens the Terminal For AI CLI view
 * - Any registered command is executed
 * - On VS Code startup (if configured in package.json)
 */
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

/**
 * Deactivates the Terminal For AI CLI extension.
 *
 * This function is called when the extension is deactivated (e.g., VS Code is closing
 * or the extension is being disabled). Cleanup is handled automatically by disposables
 * registered in the activate() function.
 *
 * @remarks
 * All disposables (SessionManager, AiTerminalViewProvider, commands, etc.) are
 * automatically disposed when the extension context is disposed, so no manual
 * cleanup is needed here.
 *
 * @example
 * ```typescript
 * // This function is automatically called by VS Code when the extension is deactivated
 * deactivate();
 * ```
 */
export function deactivate() {
  // Cleanup is handled automatically by disposables registered in activate()
  // No manual cleanup needed here
}
