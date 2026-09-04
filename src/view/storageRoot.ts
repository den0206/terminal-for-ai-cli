import * as vscode from 'vscode';
import {SHARED_CONSTANTS} from '../shared/constants';
import {Logger} from '../utils/logger';

/** Parent of the per-window fallback directories. */
const WINDOWS_DIR = 'windows';

/**
 * How long an unused fallback directory is kept.
 *
 * Same 24h as saved images and stored scrollback: everything under a window
 * directory already expires on that rule, so sweeping the directory itself on
 * the same clock cannot delete anything that was still meant to be readable.
 */
const WINDOW_TTL_MS = SHARED_CONSTANTS.IMAGE_TTL_MS;

/**
 * Root directory this window writes its images and scrollback into.
 *
 * Workspace storage is preferred because every window runs its own extension
 * host: a directory shared between windows means one window's startup sweep
 * (or its `deactivate`) deletes files another window is still using.
 *
 * `storageUri` is undefined when no folder is open, and the obvious fallback -
 * plain global storage - is exactly the shared directory being avoided here:
 * two folderless windows would sweep each other's images and overwrite each
 * other's scrollback snapshots. So the fallback is namespaced per window.
 */
export function resolveStorageRoot(
  context: vscode.ExtensionContext
): vscode.Uri {
  return (
    context.storageUri ??
    vscode.Uri.joinPath(
      context.globalStorageUri,
      WINDOWS_DIR,
      windowStorageId()
    )
  );
}

/**
 * Identifier of this window's fallback directory.
 *
 * `env.sessionId` is unique per running window and changes on every restart,
 * which is what keeps two folderless windows apart. The flip side is that each
 * restart leaves the previous directory behind - `pruneOrphanedWindowStorage`
 * is what collects those.
 */
function windowStorageId(): string {
  return vscode.env.sessionId;
}

/**
 * Deletes fallback directories left behind by windows that are no longer
 * running. Called at startup, like the image and scrollback sweeps.
 *
 * Only directories untouched for {@link WINDOW_TTL_MS} are removed, so a
 * folderless window that is still writing keeps its own directory even while
 * another window sweeps.
 *
 * @returns The number of deleted directories
 */
export async function pruneOrphanedWindowStorage(
  context: vscode.ExtensionContext,
  now = Date.now()
): Promise<number> {
  const root = vscode.Uri.joinPath(context.globalStorageUri, WINDOWS_DIR);

  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(root);
  } catch {
    // No folderless window has ever written here.
    return 0;
  }

  const current = windowStorageId();
  let deleted = 0;
  for (const [name, type] of entries) {
    if (type !== vscode.FileType.Directory || name === current) {
      continue;
    }
    const directory = vscode.Uri.joinPath(root, name);
    try {
      const stat = await vscode.workspace.fs.stat(directory);
      if (now - stat.mtime < WINDOW_TTL_MS) {
        continue;
      }
      await vscode.workspace.fs.delete(directory, {
        recursive: true,
        useTrash: false,
      });
      deleted++;
    } catch (error) {
      Logger.warn(`Failed to sweep the window storage ${name}`, error);
    }
  }

  if (deleted > 0) {
    Logger.info(`Cleaned up ${deleted} orphaned window storage director(ies)`);
  }
  return deleted;
}
