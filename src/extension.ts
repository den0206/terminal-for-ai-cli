import * as vscode from 'vscode';
import {basename, relative} from 'node:path';
import {SessionManager} from './terminal/sessionManager';
import {Logger} from './utils/logger';
import {formatSelection} from './utils/selectionText';
import {AiTerminalViewProvider} from './view/aiTerminalViewProvider';

const VIEW_ID = 'terminal-for-ai-cli-view';
const CONTAINER_COMMAND = 'workbench.view.extension.terminal-for-ai-cli';
const SEND_SELECTION_COMMAND = 'terminal-for-ai-cli.sendSelection';

function selectionText(document: vscode.TextDocument, range: vscode.Range): string {
  if (range.isEmpty) return '';
  const selected = document.getText(range);
  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  const path = folder
    ? relative(folder.uri.fsPath, document.uri.fsPath)
    : basename(document.fileName);
  return formatSelection(path, range.start.line + 1, document.languageId, selected);
}

let providerRef: AiTerminalViewProvider | undefined;

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(Logger);
  Logger.info('Terminal For AI CLI extension activated');

  const sessionManager = new SessionManager();
  const provider = new AiTerminalViewProvider(context, sessionManager);
  providerRef = provider;

  // Cleanup orphaned images from previous sessions on startup
  provider.cleanupOrphanedImages().catch((error) => {
    Logger.error('Failed to cleanup orphaned images on startup', error);
  });

  // フォルダを開いていないウィンドウはグローバルストレージ配下に自分専用の
  // ディレクトリを持つ。終了したウィンドウの分はここで回収する。
  provider.cleanupOrphanedWindowStorage().catch((error) => {
    Logger.error('Failed to cleanup orphaned window storage on startup', error);
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
    vscode.commands.registerCommand(SEND_SELECTION_COMMAND, () => {
      const editor = vscode.window.activeTextEditor;
      const selection = editor?.selection;
      const value = editor && selection && selectionText(editor.document, selection);
      if (value) {
        provider.pasteSelection(value);
      } else {
        vscode.window.showErrorMessage(
          vscode.l10n.t('Select code in the editor first.'),
        );
      }
    }),
    vscode.commands.registerCommand(
      'terminal-for-ai-cli.cleanupImages',
      async () => {
        const deleteLabel = vscode.l10n.t('Delete');
        const result = await vscode.window.showWarningMessage(
          vscode.l10n.t('Delete every saved image?'),
          {modal: true},
          deleteLabel
        );

        if (result === deleteLabel) {
          const deletedCount = await provider.cleanupOrphanedImages();
          vscode.window.showInformationMessage(
            deletedCount > 0
              ? vscode.l10n.t('Deleted {0} image(s)', deletedCount)
              : vscode.l10n.t('There were no images to delete')
          );
        }
      }
    )
  );
}

export function deactivate(): Thenable<void> | undefined {
  return providerRef?.clearAllStoredImages();
}
