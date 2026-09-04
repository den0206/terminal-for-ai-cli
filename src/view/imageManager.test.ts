import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type * as vscodeTypes from 'vscode';
import {FileType, env as mockEnv, workspace as mockWorkspace} from 'vscode';
import {SHARED_CONSTANTS} from '../shared/constants';
import {ImageManager} from './imageManager';

type MockFs = {
  readDirectory: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  createDirectory: ReturnType<typeof vi.fn>;
  writeFile: ReturnType<typeof vi.fn>;
  stat: ReturnType<typeof vi.fn>;
};

const fs = mockWorkspace.fs as unknown as MockFs;

function createContext(overrides: {
  storageUri?: {fsPath: string} | undefined;
  globalStorageUri?: {fsPath: string};
}): vscodeTypes.ExtensionContext {
  return {
    storageUri: 'storageUri' in overrides ? overrides.storageUri : {fsPath: '/ws'},
    globalStorageUri: overrides.globalStorageUri ?? {fsPath: '/global'},
  } as unknown as vscodeTypes.ExtensionContext;
}

const PNG = Buffer.from('fake png bytes').toString('base64');

describe('ImageManager', () => {
  let originalPlatform: PropertyDescriptor | undefined;
  const originalSessionId = mockEnv.sessionId;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv.sessionId = originalSessionId;
    fs.createDirectory.mockResolvedValue(undefined);
    fs.writeFile.mockResolvedValue(undefined);
    fs.delete.mockResolvedValue(undefined);
    fs.readDirectory.mockResolvedValue([]);
    fs.stat.mockResolvedValue({size: 0});
    originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  });

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
    mockEnv.sessionId = originalSessionId;
  });

  const setPlatform = (value: string) => {
    Object.defineProperty(process, 'platform', {value, configurable: true});
  };

  describe('storage location', () => {
    it('writes into workspace storage so other windows are not affected', async () => {
      const manager = new ImageManager(createContext({}));

      await manager.handleImageDrop('shot.png', 'image/png', PNG, 'session-1');

      const [target] = fs.writeFile.mock.calls[0];
      expect(target.fsPath).toMatch(/^\/ws\/images\//);
    });

    it('falls back to a per-window directory when no folder is open', async () => {
      const manager = new ImageManager(
        createContext({storageUri: undefined, globalStorageUri: {fsPath: '/global'}})
      );

      await manager.handleImageDrop('shot.png', 'image/png', PNG, 'session-1');

      // グローバルストレージ直下ではなく、ウィンドウ固有のサブディレクトリ。
      // 直下だと、フォルダ未オープンのウィンドウ同士が同じ images/ を共有して
      // しまい、片方の起動時掃除がもう片方の使用中の画像を消す。
      const [target] = fs.writeFile.mock.calls[0];
      expect(target.fsPath).toMatch(
        new RegExp(`^/global/windows/${mockEnv.sessionId}/images/`)
      );
      expect(target.fsPath).not.toMatch(/^\/global\/images\//);
    });

    it('gives two folderless windows separate directories', async () => {
      const context = createContext({
        storageUri: undefined,
        globalStorageUri: {fsPath: '/global'},
      });

      await new ImageManager(context).handleImageDrop(
        'shot.png',
        'image/png',
        PNG,
        'session-1'
      );
      const first = fs.writeFile.mock.calls[0][0].fsPath;

      mockEnv.sessionId = 'another-window';
      await new ImageManager(context).handleImageDrop(
        'shot.png',
        'image/png',
        PNG,
        'session-1'
      );
      const second = fs.writeFile.mock.calls[1][0].fsPath;

      expect(first).not.toBe(second);
      expect(second).toMatch(/^\/global\/windows\/another-window\/images\//);
    });
  });

  describe('handleImageDrop validation', () => {
    it('rejects non-image MIME types', async () => {
      const manager = new ImageManager(createContext({}));
      await expect(
        manager.handleImageDrop('payload.sh', 'text/x-shellscript', PNG, 's1')
      ).rejects.toThrow('Invalid file type');
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('rejects empty base64 data', async () => {
      const manager = new ImageManager(createContext({}));
      await expect(
        manager.handleImageDrop('shot.png', 'image/png', '   ', 's1')
      ).rejects.toThrow('Invalid base64 data');
    });

    it('rejects a write that would push storage past the ceiling', async () => {
      const manager = new ImageManager(createContext({}));
      // ディレクトリが既に上限ぎりぎりまで埋まっている状態
      fs.readDirectory.mockResolvedValue([['old.png', FileType.File]]);
      fs.stat.mockResolvedValue({
        size: SHARED_CONSTANTS.MAX_IMAGE_STORAGE_BYTES,
      });

      await expect(
        manager.handleImageDrop('shot.png', 'image/png', PNG, 's1')
      ).rejects.toThrow('Image storage is full');
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('allows a write that still fits under the ceiling', async () => {
      const manager = new ImageManager(createContext({}));
      fs.readDirectory.mockResolvedValue([['old.png', FileType.File]]);
      fs.stat.mockResolvedValue({
        size: SHARED_CONSTANTS.MAX_IMAGE_STORAGE_BYTES - 1024 * 1024,
      });

      await expect(
        manager.handleImageDrop('shot.png', 'image/png', PNG, 's1')
      ).resolves.toBeDefined();
      expect(fs.writeFile).toHaveBeenCalled();
    });

    it('rejects images above the size limit', async () => {
      const manager = new ImageManager(createContext({}));
      const oversized = Buffer.alloc(
        SHARED_CONSTANTS.MAX_IMAGE_SIZE_BYTES + 1
      ).toString('base64');

      await expect(
        manager.handleImageDrop('big.png', 'image/png', oversized, 's1')
      ).rejects.toThrow('too large');
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('rejects a filename with no usable characters', async () => {
      const manager = new ImageManager(createContext({}));
      await expect(
        manager.handleImageDrop('   ', 'image/png', PNG, 's1')
      ).rejects.toThrow('Invalid filename');
    });
  });

  describe('filename sanitization', () => {
    it('strips path separators and traversal segments', async () => {
      const manager = new ImageManager(createContext({}));

      await manager.handleImageDrop(
        '../../etc/passwd.png',
        'image/png',
        PNG,
        's1'
      );

      const [target] = fs.writeFile.mock.calls[0];
      const name = String(target.fsPath).slice('/ws/images/'.length);
      expect(target.fsPath.startsWith('/ws/images/')).toBe(true);
      // Separators are gone, so what is left is one segment that cannot escape
      // the directory - the timestamp prefix also rules out "." and "..".
      expect(name).not.toMatch(/[/\\]/);
      expect(name).toMatch(/^\d+_[a-zA-Z0-9._-]+$/);
    });

    it('truncates names that exceed the filesystem limit', async () => {
      const manager = new ImageManager(createContext({}));

      await manager.handleImageDrop(
        `${'a'.repeat(400)}.png`,
        'image/png',
        PNG,
        's1'
      );

      const [target] = fs.writeFile.mock.calls[0];
      const name = String(target.fsPath).split('/').pop() ?? '';
      expect(name.length).toBeLessThanOrEqual(
        SHARED_CONSTANTS.MAX_IMAGE_FILENAME_LENGTH
      );
      expect(name.endsWith('.png')).toBe(true);
    });
  });

  describe('escapeShellPath', () => {
    it('single-quotes the path on POSIX', async () => {
      setPlatform('darwin');
      const manager = new ImageManager(createContext({}));

      const result = await manager.handleImageDrop(
        'shot.png',
        'image/png',
        PNG,
        's1'
      );

      expect(result.startsWith("'")).toBe(true);
      expect(result.endsWith("'")).toBe(true);
    });

    it('double-quotes the path on Windows', async () => {
      setPlatform('win32');
      const manager = new ImageManager(
        createContext({storageUri: {fsPath: 'C:\\Users\\Test Name\\ws'}})
      );

      const result = await manager.handleImageDrop(
        'shot.png',
        'image/png',
        PNG,
        's1'
      );

      expect(result.startsWith('"')).toBe(true);
      expect(result.endsWith('"')).toBe(true);
    });

    it('refuses a Windows path containing cmd.exe expansion characters', async () => {
      setPlatform('win32');
      const manager = new ImageManager(
        createContext({storageUri: {fsPath: 'C:\\Users\\%USERNAME%\\ws'}})
      );

      await expect(
        manager.handleImageDrop('shot.png', 'image/png', PNG, 's1')
      ).rejects.toThrow('cannot be quoted safely');
    });
  });

  describe('getStorageBytes', () => {
    it('sums the files in the images directory', async () => {
      fs.readDirectory.mockResolvedValue([
        ['a.png', FileType.File],
        ['b.png', FileType.File],
        ['nested', FileType.Directory],
      ]);
      fs.stat.mockResolvedValue({size: 1024});
      const manager = new ImageManager(createContext({}));

      expect(await manager.getStorageBytes()).toBe(2048);
      expect(fs.stat).toHaveBeenCalledTimes(2);
    });

    it('caches the result so repeated polling costs no I/O', async () => {
      fs.readDirectory.mockResolvedValue([['a.png', FileType.File]]);
      fs.stat.mockResolvedValue({size: 10});
      const manager = new ImageManager(createContext({}));

      await manager.getStorageBytes();
      await manager.getStorageBytes();
      await manager.getStorageBytes();

      expect(fs.readDirectory).toHaveBeenCalledTimes(1);
    });

    it('re-scans after a new image is saved', async () => {
      fs.readDirectory.mockResolvedValue([]);
      const manager = new ImageManager(createContext({}));
      await manager.getStorageBytes();

      await manager.handleImageDrop('shot.png', 'image/png', PNG, 's1');
      fs.readDirectory.mockResolvedValue([['a.png', FileType.File]]);
      fs.stat.mockResolvedValue({size: 99});

      expect(await manager.getStorageBytes()).toBe(99);
      expect(fs.readDirectory).toHaveBeenCalledTimes(2);
    });

    it('reports zero when the directory does not exist', async () => {
      fs.readDirectory.mockRejectedValue(new Error('ENOENT'));
      const manager = new ImageManager(createContext({}));

      expect(await manager.getStorageBytes()).toBe(0);
    });
  });

  describe('cleanup', () => {
    it('deletes the images tracked for a session', async () => {
      const manager = new ImageManager(createContext({}));
      const escaped = await manager.handleImageDrop(
        'shot.png',
        'image/png',
        PNG,
        's1'
      );

      await manager.deleteSessionImages('s1');

      expect(fs.delete).toHaveBeenCalledTimes(1);
      const [deleted] = fs.delete.mock.calls[0];
      expect(escaped).toContain(deleted.fsPath);
    });

    it('keeps fresh images that an active session still uses', async () => {
      const manager = new ImageManager(createContext({}));
      await manager.handleImageDrop('shot.png', 'image/png', PNG, 's1');
      const [saved] = fs.writeFile.mock.calls[0];
      const name = String(saved.fsPath).split('/').pop() ?? '';
      fs.readDirectory.mockResolvedValue([[name, FileType.File]]);

      expect(await manager.cleanupOrphanedImages()).toBe(0);
      expect(fs.delete).not.toHaveBeenCalled();
    });

    it('deletes images left behind by a previous run', async () => {
      const manager = new ImageManager(createContext({}));
      fs.readDirectory.mockResolvedValue([
        [`${Date.now()}_orphan.png`, FileType.File],
      ]);

      expect(await manager.cleanupOrphanedImages()).toBe(1);
    });

    it('deletes tracked images once they pass the TTL', async () => {
      const manager = new ImageManager(createContext({}));
      await manager.handleImageDrop('shot.png', 'image/png', PNG, 's1');
      const [saved] = fs.writeFile.mock.calls[0];
      const name = String(saved.fsPath).split('/').pop() ?? '';
      const stale = name.replace(
        /^\d+/,
        String(Date.now() - SHARED_CONSTANTS.IMAGE_TTL_MS - 1)
      );
      fs.readDirectory.mockResolvedValue([[stale, FileType.File]]);

      expect(await manager.cleanupOrphanedImages()).toBe(1);
    });

    it('ignores directories while cleaning up', async () => {
      const manager = new ImageManager(createContext({}));
      fs.readDirectory.mockResolvedValue([['subdir', FileType.Directory]]);

      expect(await manager.cleanupOrphanedImages()).toBe(0);
      expect(fs.delete).not.toHaveBeenCalled();
    });

    it('clears tracking even when the delete fails', async () => {
      const manager = new ImageManager(createContext({}));
      await manager.handleImageDrop('shot.png', 'image/png', PNG, 's1');
      fs.delete.mockRejectedValue(new Error('EBUSY'));

      await manager.clearAllImages();

      fs.readDirectory.mockResolvedValue([]);
      expect(await manager.getStorageBytes()).toBe(0);
    });
  });
});
