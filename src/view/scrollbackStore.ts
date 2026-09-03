import {createHash} from 'node:crypto';
import * as vscode from 'vscode';
import {SHARED_CONSTANTS} from '../shared/constants';
import type {ScrollbackSnapshot, TerminalSlot} from '../shared/types';
import {TERMINAL_SLOTS} from '../shared/types';
import {Logger} from '../utils/logger';

const {MAX_SNAPSHOT_CHARS, TTL_MS} = SHARED_CONSTANTS.SCROLLBACK_RESTORE;

/**
 * Validates a snapshot read back from disk.
 *
 * The file is ours, but it survives editor upgrades and hand edits, and its
 * contents are written straight into a terminal — so nothing is trusted here.
 */
export function parseSnapshot(value: unknown): ScrollbackSnapshot | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const candidate = value as Partial<ScrollbackSnapshot>;
  if (
    typeof candidate.data !== 'string' ||
    candidate.data.length === 0 ||
    candidate.data.length > MAX_SNAPSHOT_CHARS ||
    !Number.isFinite(candidate.cols) ||
    !Number.isFinite(candidate.rows) ||
    !Number.isFinite(candidate.savedAt)
  ) {
    return undefined;
  }
  return {
    data: candidate.data,
    cols: Number(candidate.cols),
    rows: Number(candidate.rows),
    savedAt: Number(candidate.savedAt),
    ...(typeof candidate.label === 'string' ? {label: candidate.label} : {}),
  };
}

export function isExpired(savedAt: number, now: number, ttlMs = TTL_MS): boolean {
  // A clock that moved backwards should not resurrect an ancient snapshot.
  return now - savedAt >= ttlMs || savedAt > now + ttlMs;
}

/**
 * Keeps the last scrollback of each terminal slot on disk so it can be read
 * again after the editor restarts.
 *
 * Storage is per window (per workspace), like saved images: every window runs
 * its own extension host, so a shared file would let one window overwrite the
 * history another window is about to restore.
 */
export class ScrollbackStore {
  /**
   * ダイジェストだけを覚えておき、同じ内容の書き直しを飛ばす。スナップショットは
   * 出力が止まるたびに届くので、待っているだけの端末を毎回 MB 単位で書き直さない。
   * 文字列そのものを持つと拡張ホストにスロット分だけ常駐してしまうので持たない。
   */
  private readonly lastWritten = new Map<TerminalSlot, string>();

  constructor(private readonly context: vscode.ExtensionContext) {}

  private get storageRoot(): vscode.Uri {
    return this.context.storageUri ?? this.context.globalStorageUri;
  }

  private get directory(): vscode.Uri {
    return vscode.Uri.joinPath(this.storageRoot, 'scrollback');
  }

  private fileFor(slot: TerminalSlot): vscode.Uri {
    return vscode.Uri.joinPath(this.directory, `${slot}.json`);
  }

  async save(slot: TerminalSlot, snapshot: ScrollbackSnapshot): Promise<void> {
    if (snapshot.data.length > MAX_SNAPSHOT_CHARS) {
      Logger.debug(
        `Scrollback snapshot for slot ${slot} exceeds the cap; not saved`
      );
      return;
    }
    const digest = createHash('sha1').update(snapshot.data).digest('hex');
    if (this.lastWritten.get(slot) === digest) {
      return;
    }
    try {
      await vscode.workspace.fs.createDirectory(this.directory);
      await vscode.workspace.fs.writeFile(
        this.fileFor(slot),
        Buffer.from(JSON.stringify(snapshot), 'utf8')
      );
      this.lastWritten.set(slot, digest);
    } catch (error) {
      Logger.warn(`Failed to save the scrollback for slot ${slot}`, error);
    }
  }

  /** 保存済みスナップショットの合計バイト数。ツールバーのリソース表示に足す。 */
  async getStorageBytes(): Promise<number> {
    let total = 0;
    for (const slot of TERMINAL_SLOTS) {
      try {
        total += (await vscode.workspace.fs.stat(this.fileFor(slot))).size;
      } catch {
        // 保存されていないスロット。
      }
    }
    return total;
  }

  /** Returns the stored snapshot, or undefined when it is missing, broken or stale. */
  async load(slot: TerminalSlot, now = Date.now()): Promise<ScrollbackSnapshot | undefined> {
    let raw: Uint8Array;
    try {
      raw = await vscode.workspace.fs.readFile(this.fileFor(slot));
    } catch {
      return undefined;
    }
    let parsed: ScrollbackSnapshot | undefined;
    try {
      parsed = parseSnapshot(JSON.parse(Buffer.from(raw).toString('utf8')));
    } catch {
      parsed = undefined;
    }
    if (!parsed) {
      Logger.warn(`Discarding an unreadable scrollback snapshot for slot ${slot}`);
      await this.clear(slot);
      return undefined;
    }
    if (isExpired(parsed.savedAt, now)) {
      await this.clear(slot);
      return undefined;
    }
    return parsed;
  }

  /** Deletes one slot, or every slot when none is given. */
  async clear(slot?: TerminalSlot): Promise<void> {
    const slots = slot ? [slot] : TERMINAL_SLOTS;
    for (const target of slots) {
      this.lastWritten.delete(target);
      try {
        await vscode.workspace.fs.delete(this.fileFor(target));
      } catch {
        // Nothing stored for this slot.
      }
    }
  }

  /** Drops stale snapshots. Called at startup, like the image sweep. */
  async pruneExpired(now = Date.now()): Promise<void> {
    for (const slot of TERMINAL_SLOTS) {
      await this.load(slot, now);
    }
  }
}
