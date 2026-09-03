import {beforeEach, describe, expect, it, vi} from 'vitest';
import * as vscode from 'vscode';
import {SHARED_CONSTANTS} from '../shared/constants';
import type {ScrollbackSnapshot} from '../shared/types';
import {ScrollbackStore, isExpired, parseSnapshot} from './scrollbackStore';

const {TTL_MS, MAX_SNAPSHOT_CHARS} = SHARED_CONSTANTS.SCROLLBACK_RESTORE;

const validSnapshot: ScrollbackSnapshot = {
  data: 'ok\r\n',
  cols: 80,
  rows: 24,
  savedAt: 1_700_000_000_000,
  label: 'Terminal 1',
};

function createContext() {
  return {
    storageUri: {fsPath: '/storage', scheme: 'file', path: '/storage'},
    globalStorageUri: {fsPath: '/global', scheme: 'file', path: '/global'},
  } as unknown as vscode.ExtensionContext;
}

const fs = vscode.workspace.fs as unknown as Record<
  string,
  ReturnType<typeof vi.fn>
>;

function fileContents(value: unknown): Uint8Array {
  return Buffer.from(JSON.stringify(value), 'utf8');
}

describe('parseSnapshot', () => {
  it('accepts a well-formed snapshot', () => {
    expect(parseSnapshot(validSnapshot)).toEqual(validSnapshot);
  });

  it('drops the label when it is not a string', () => {
    expect(parseSnapshot({...validSnapshot, label: 42})).toEqual({
      data: validSnapshot.data,
      cols: validSnapshot.cols,
      rows: validSnapshot.rows,
      savedAt: validSnapshot.savedAt,
    });
  });

  it.each([
    ['not an object', 'nope'],
    ['null', null],
    ['a missing body', {...validSnapshot, data: undefined}],
    ['an empty body', {...validSnapshot, data: ''}],
    ['a non-numeric size', {...validSnapshot, cols: 'wide'}],
    ['a missing timestamp', {...validSnapshot, savedAt: undefined}],
  ])('rejects %s', (_label, value) => {
    expect(parseSnapshot(value)).toBeUndefined();
  });

  it('rejects a body larger than the cap', () => {
    expect(
      parseSnapshot({...validSnapshot, data: 'a'.repeat(MAX_SNAPSHOT_CHARS + 1)})
    ).toBeUndefined();
  });
});

describe('isExpired', () => {
  const now = 1_700_000_000_000;

  it('keeps a fresh snapshot', () => {
    expect(isExpired(now - 1000, now)).toBe(false);
  });

  it('drops one older than the TTL', () => {
    expect(isExpired(now - TTL_MS - 1, now)).toBe(true);
  });

  it('drops one stamped far in the future, which means the clock moved', () => {
    expect(isExpired(now + TTL_MS + 1, now)).toBe(true);
  });
});

describe('ScrollbackStore', () => {
  let store: ScrollbackStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new ScrollbackStore(createContext());
  });

  it('writes the snapshot under the workspace storage', async () => {
    await store.save(1, validSnapshot);

    expect(fs.createDirectory).toHaveBeenCalled();
    const [uri, bytes] = fs.writeFile.mock.calls[0];
    expect((uri as {fsPath: string}).fsPath).toBe('/storage/scrollback/1.json');
    expect(JSON.parse(Buffer.from(bytes as Uint8Array).toString('utf8'))).toEqual(
      validSnapshot
    );
  });

  it('does not write a snapshot over the cap', async () => {
    await store.save(1, {
      ...validSnapshot,
      data: 'a'.repeat(MAX_SNAPSHOT_CHARS + 1),
    });

    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it('survives a failing write', async () => {
    fs.writeFile.mockRejectedValueOnce(new Error('disk full'));

    await expect(store.save(1, validSnapshot)).resolves.toBeUndefined();
  });

  it('reads a stored snapshot back', async () => {
    fs.readFile.mockResolvedValueOnce(fileContents(validSnapshot));

    await expect(store.load(1, validSnapshot.savedAt + 1000)).resolves.toEqual(
      validSnapshot
    );
  });

  it('returns nothing when no snapshot was stored', async () => {
    fs.readFile.mockRejectedValueOnce(new Error('ENOENT'));

    await expect(store.load(1)).resolves.toBeUndefined();
  });

  it('deletes a snapshot that cannot be parsed', async () => {
    fs.readFile.mockResolvedValueOnce(Buffer.from('{ not json', 'utf8'));

    await expect(store.load(1)).resolves.toBeUndefined();
    expect(fs.delete).toHaveBeenCalled();
  });

  it('deletes a snapshot that is past its TTL', async () => {
    fs.readFile.mockResolvedValueOnce(fileContents(validSnapshot));

    await expect(
      store.load(1, validSnapshot.savedAt + TTL_MS + 1)
    ).resolves.toBeUndefined();
    expect(fs.delete).toHaveBeenCalled();
  });

  it('clears every slot when no slot is given', async () => {
    await store.clear();

    expect(fs.delete).toHaveBeenCalledTimes(2);
    expect(
      fs.delete.mock.calls.map(([uri]) => (uri as {fsPath: string}).fsPath)
    ).toEqual(['/storage/scrollback/1.json', '/storage/scrollback/2.json']);
  });

  it('falls back to global storage when no folder is open', async () => {
    const store2 = new ScrollbackStore({
      storageUri: undefined,
      globalStorageUri: {fsPath: '/global', scheme: 'file', path: '/global'},
    } as unknown as vscode.ExtensionContext);

    await store2.save(2, validSnapshot);

    expect((fs.writeFile.mock.calls[0][0] as {fsPath: string}).fsPath).toBe(
      '/global/scrollback/2.json'
    );
  });

  it('sweeps stale snapshots at startup', async () => {
    fs.readFile.mockResolvedValue(fileContents(validSnapshot));

    await store.pruneExpired(validSnapshot.savedAt + TTL_MS + 1);

    expect(fs.delete).toHaveBeenCalledTimes(2);
  });
});
