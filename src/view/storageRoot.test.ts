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
    fs.readDirectory.mockResolvedValue([
      ['window-old', vscode.FileType.Directory],
    ]);
    fs.stat.mockResolvedValue({mtime: NOW - TTL - 1});

    expect(await pruneOrphanedWindowStorage(createContext(), NOW)).toBe(1);
    expect(deletedPaths()).toEqual(['/global/windows/window-old']);
  });

  it('never deletes the directory of the window doing the sweep', async () => {
    fs.readDirectory.mockResolvedValue([
      ['window-a', vscode.FileType.Directory],
    ]);
    // 自分のディレクトリは mtime を見るまでもなく対象外
    fs.stat.mockResolvedValue({mtime: 0});

    expect(await pruneOrphanedWindowStorage(createContext(), NOW)).toBe(0);
    expect(fs.delete).not.toHaveBeenCalled();
  });

  it('keeps a directory another window is still writing to', async () => {
    fs.readDirectory.mockResolvedValue([
      ['window-live', vscode.FileType.Directory],
    ]);
    fs.stat.mockResolvedValue({mtime: NOW - 1_000});

    expect(await pruneOrphanedWindowStorage(createContext(), NOW)).toBe(0);
    expect(fs.delete).not.toHaveBeenCalled();
  });

  it('ignores stray files next to the window directories', async () => {
    fs.readDirectory.mockResolvedValue([['notes.txt', vscode.FileType.File]]);

    expect(await pruneOrphanedWindowStorage(createContext(), NOW)).toBe(0);
    expect(fs.delete).not.toHaveBeenCalled();
  });

  it('keeps sweeping after one directory fails to delete', async () => {
    fs.readDirectory.mockResolvedValue([
      ['window-locked', vscode.FileType.Directory],
      ['window-old', vscode.FileType.Directory],
    ]);
    fs.stat.mockResolvedValue({mtime: NOW - TTL - 1});
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
