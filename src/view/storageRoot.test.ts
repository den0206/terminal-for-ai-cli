import {beforeEach, describe, expect, it, vi} from 'vitest';
import * as vscode from 'vscode';
import {SHARED_CONSTANTS} from '../shared/constants';
import {pruneOrphanedWindowStorage, resolveStorageRoot} from './storageRoot';

vi.mock('../utils/logger', () => ({
  Logger: {info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn()},
}));

const fs = vscode.workspace.fs as unknown as Record<
  string,
  ReturnType<typeof vi.fn>
>;

const TTL = SHARED_CONSTANTS.IMAGE_TTL_MS;
const NOW = 1_700_000_000_000;

function createContext(storageUri?: {fsPath: string}) {
  return {
    storageUri,
    globalStorageUri: {fsPath: '/global', scheme: 'file', path: '/global'},
  } as unknown as vscode.ExtensionContext;
}

function deletedPaths(): string[] {
  return fs.delete.mock.calls.map(([uri]) => (uri as {fsPath: string}).fsPath);
}

describe('resolveStorageRoot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vscode.env.sessionId = 'window-a';
  });

  it('uses workspace storage when a folder is open', () => {
    expect(resolveStorageRoot(createContext({fsPath: '/ws'})).fsPath).toBe(
      '/ws'
    );
  });

  it('namespaces the fallback by window so folderless windows stay apart', () => {
    expect(resolveStorageRoot(createContext()).fsPath).toBe(
      '/global/windows/window-a'
    );

    vscode.env.sessionId = 'window-b';
    expect(resolveStorageRoot(createContext()).fsPath).toBe(
      '/global/windows/window-b'
    );
  });
});

describe('pruneOrphanedWindowStorage', () => {
  type Node = {mtime: number; children?: Record<string, Node>};

  /** パスをキーにした最小のファイルシステム。`/global/windows` が起点。 */
  function mountWindows(children: Record<string, Node>) {
    const root: Node = {mtime: NOW, children};
    const find = (fsPath: string): Node | undefined => {
      const rest = fsPath.replace('/global/windows', '').split('/').filter(Boolean);
      let node: Node | undefined = root;
      for (const name of rest) {
        node = node?.children?.[name];
      }
      return node;
    };
    fs.stat.mockImplementation(async (uri: unknown) => {
      const node = find((uri as {fsPath: string}).fsPath);
      if (!node) {
        throw new Error('ENOENT');
      }
      return {mtime: node.mtime};
    });
    fs.readDirectory.mockImplementation(async (uri: unknown) => {
      const node = find((uri as {fsPath: string}).fsPath);
      if (!node?.children) {
        throw new Error('ENOTDIR');
      }
      return Object.entries(node.children).map(([name, child]) => [
        name,
        child.children ? vscode.FileType.Directory : vscode.FileType.File,
      ]);
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vscode.env.sessionId = 'window-a';
    fs.delete.mockResolvedValue(undefined);
  });

  it('returns 0 when no folderless window has ever written', async () => {
    fs.readDirectory.mockRejectedValue(new Error('ENOENT'));

    expect(await pruneOrphanedWindowStorage(createContext(), NOW)).toBe(0);
    expect(fs.delete).not.toHaveBeenCalled();
  });

  it('deletes directories left by windows that are no longer running', async () => {
    mountWindows({
      'window-old': {
        mtime: NOW - TTL - 1,
        children: {
          images: {
            mtime: NOW - TTL - 1,
            children: {'1.png': {mtime: NOW - TTL - 1}},
          },
        },
      },
    });

    expect(await pruneOrphanedWindowStorage(createContext(), NOW)).toBe(1);
    expect(deletedPaths()).toEqual(['/global/windows/window-old']);
  });

  it('never deletes the directory of the window doing the sweep', async () => {
    mountWindows({'window-a': {mtime: 0, children: {}}});

    expect(await pruneOrphanedWindowStorage(createContext(), NOW)).toBe(0);
    expect(fs.delete).not.toHaveBeenCalled();
  });

  it('keeps a directory another window is still writing to', async () => {
    // ディレクトリの mtime は直下のエントリが増減したときにしか動かない。
    // images/ へ書き続けているウィンドウは、自分のディレクトリを古いまま
    // 残すので、中のファイルを見ないと生きているのに掃除される。
    mountWindows({
      'window-live': {
        mtime: NOW - TTL - 1,
        children: {
          images: {
            mtime: NOW - TTL - 1,
            children: {'fresh.png': {mtime: NOW - 1_000}},
          },
        },
      },
    });

    expect(await pruneOrphanedWindowStorage(createContext(), NOW)).toBe(0);
    expect(fs.delete).not.toHaveBeenCalled();
  });

  it('keeps a window directory that was just created and is still empty', async () => {
    mountWindows({'window-new': {mtime: NOW - 1_000, children: {}}});

    expect(await pruneOrphanedWindowStorage(createContext(), NOW)).toBe(0);
    expect(fs.delete).not.toHaveBeenCalled();
  });

  it('ignores stray files next to the window directories', async () => {
    mountWindows({'notes.txt': {mtime: 0}});

    expect(await pruneOrphanedWindowStorage(createContext(), NOW)).toBe(0);
    expect(fs.delete).not.toHaveBeenCalled();
  });

  it('keeps sweeping after one directory fails to delete', async () => {
    const stale = {mtime: NOW - TTL - 1, children: {}};
    mountWindows({'window-locked': {...stale}, 'window-old': {...stale}});
    fs.delete
      .mockRejectedValueOnce(new Error('EPERM'))
      .mockResolvedValueOnce(undefined);

    expect(await pruneOrphanedWindowStorage(createContext(), NOW)).toBe(1);
    expect(deletedPaths()).toEqual([
      '/global/windows/window-locked',
      '/global/windows/window-old',
    ]);
  });
});
