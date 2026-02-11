import {describe, expect, it, beforeEach, afterEach, vi} from 'vitest';
import * as vscode from 'vscode';
import {
  resolveWorkingDirectory,
  getDefaultCwd,
} from './workingDirectory';

type MockWorkspaceFolder = {uri: {scheme: string; fsPath: string}};
/** モックの workspaceFolders に代入するためのヘルパー（@types/vscode では readonly のため） */
function setWorkspaceFolders(folders: MockWorkspaceFolder[]): void {
  (vscode.workspace as unknown as {workspaceFolders: MockWorkspaceFolder[]}).workspaceFolders = folders;
}

describe('workingDirectory', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    (vscode.window as {activeTextEditor?: unknown}).activeTextEditor = undefined;
    setWorkspaceFolders([]);
    (vscode.workspace.getWorkspaceFolder as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
  });

  afterEach(() => {
    process.env = {...originalEnv};
  });

  describe('resolveWorkingDirectory', () => {
    it('returns active editor workspace folder when scheme is file', () => {
      const wsPath = '/workspace/root';
      (vscode.window as {activeTextEditor?: unknown}).activeTextEditor = {
        document: {
          uri: {scheme: 'file', fsPath: '/workspace/root/file.txt'},
        },
      };
      (vscode.workspace.getWorkspaceFolder as ReturnType<typeof vi.fn>).mockReturnValue({
        uri: {scheme: 'file', fsPath: wsPath},
      });

      expect(resolveWorkingDirectory()).toBe(wsPath);
    });

    it('returns active editor file directory when workspace folder is not file scheme', () => {
      (vscode.window as {activeTextEditor?: unknown}).activeTextEditor = {
        document: {
          uri: {scheme: 'file', fsPath: '/some/dir/editor.txt'},
        },
      };
      (vscode.workspace.getWorkspaceFolder as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

      expect(resolveWorkingDirectory()).toBe('/some/dir');
    });

    it('returns first workspace folder when no active editor', () => {
      const wsPath = '/first/workspace';
      setWorkspaceFolders([
        {uri: {scheme: 'file', fsPath: wsPath}},
        {uri: {scheme: 'file', fsPath: '/second/workspace'}},
      ]);

      expect(resolveWorkingDirectory()).toBe(wsPath);
    });

    it('prefers file-scheme workspace folder when multiple exist', () => {
      setWorkspaceFolders([
        {uri: {scheme: 'vscode-remote', fsPath: '/remote'}},
        {uri: {scheme: 'file', fsPath: '/local/ws'}},
      ]);

      expect(resolveWorkingDirectory()).toBe('/local/ws');
    });

    it('falls back to env when no workspace and no editor', () => {
      process.env.CURSOR_PROJECT_PATH = '/from/env';

      expect(resolveWorkingDirectory()).toBe('/from/env');
    });

    it('uses first defined env candidate', () => {
      process.env.PWD = '/pwd';
      process.env.INIT_CWD = '/init';
      process.env.CURSOR_PROJECT_PATH = '/cursor';

      expect(resolveWorkingDirectory()).toBe('/cursor');
    });

    it('ignores empty or whitespace-only env values', () => {
      process.env.CURSOR_PROJECT_PATH = '   ';
      process.env.PWD = '/valid/pwd';

      expect(resolveWorkingDirectory()).toBe('/valid/pwd');
    });
  });

  describe('getDefaultCwd', () => {
    it('returns workspace folder when available', () => {
      const wsPath = '/default/workspace';
      setWorkspaceFolders([{uri: {scheme: 'file', fsPath: wsPath}}]);

      expect(getDefaultCwd()).toBe(wsPath);
    });

    it('returns env-based path when no workspace', () => {
      process.env.CURSOR_WORKSPACE_DIR = '/env/workspace';

      expect(getDefaultCwd()).toBe('/env/workspace');
    });

    it('returns a string when nothing else is set (cwd or homedir fallback)', () => {
      const result = getDefaultCwd();
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('prefers workspace over env', () => {
      setWorkspaceFolders([{uri: {scheme: 'file', fsPath: '/ws'}}]);
      process.env.CURSOR_PROJECT_PATH = '/env';

      expect(getDefaultCwd()).toBe('/ws');
    });
  });
});
