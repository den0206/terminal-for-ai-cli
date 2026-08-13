import * as vscode from 'vscode';

/**
 * VS Code の LogOutputChannel。
 * タイムスタンプ・ログレベル（「Developer: Set Log Level…」で変更可能）は
 * エディタ側が管理するため、独自実装は持たない。
 */
export const Logger = vscode.window.createOutputChannel('Terminal For AI CLI', {
  log: true,
});
