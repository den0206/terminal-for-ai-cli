import * as path from 'node:path';
import * as vscode from 'vscode';
import {SHARED_CONSTANTS} from '../shared/constants';
import {Logger} from '../utils/logger';
import {escapeShellPath} from '../utils/shellPath';
import {resolveStorageRoot} from './storageRoot';

/**
 * Manages image storage and cleanup for terminal sessions.
 *
 * Handles drag-and-drop image saving to global storage, per-session
 * image tracking, and cleanup of orphaned images.
 */
export class ImageManager {
  private readonly sessionImages = new Map<string, Set<string>>();
  /** Cached total size of the images directory; invalidated on every write/delete. */
  private cachedBytes?: number;

  constructor(private readonly context: vscode.ExtensionContext) {}

  /**
   * Root for saved images. Per window - see {@link resolveStorageRoot}.
   */
  private get storageRoot(): vscode.Uri {
    return resolveStorageRoot(this.context);
  }

  private get imagesDir(): vscode.Uri {
    return vscode.Uri.joinPath(this.storageRoot, 'images');
  }

  /**
   * Total size in bytes of the saved images.
   *
   * The directory is only scanned when the cache is cold: every path that
   * changes the directory clears it, so a periodic reader costs no I/O while
   * nothing is being saved or deleted.
   */
  async getStorageBytes(): Promise<number> {
    if (this.cachedBytes !== undefined) {
      return this.cachedBytes;
    }
    let total = 0;
    try {
      const entries = await vscode.workspace.fs.readDirectory(this.imagesDir);
      for (const [name, type] of entries) {
        if (type !== vscode.FileType.File) {
          continue;
        }
        const stat = await vscode.workspace.fs.stat(
          vscode.Uri.joinPath(this.imagesDir, name)
        );
        total += stat.size;
      }
    } catch {
      // Images directory does not exist yet
    }
    this.cachedBytes = total;
    return total;
  }

  /**
   * Handles image drop events.
   *
   * Validates the image file (MIME type, size, filename), saves it to global storage,
   * and returns the escaped file path for shell execution.
   *
   * @param fileName - The original filename of the dropped image
   * @param mimeType - The MIME type of the image (must start with 'image/')
   * @param base64Data - Base64-encoded image data
   * @param sessionId - The ID of the session to associate the image with
   * @returns The shell-escaped file path of the saved image
   * @throws {Error} If the image is invalid, too large (>10MB), or save fails
   */
  async handleImageDrop(
    fileName: string,
    mimeType: string,
    base64Data: string,
    sessionId: string
  ): Promise<string> {
    // Validate MIME type
    if (!mimeType || !mimeType.startsWith('image/')) {
      throw new Error('Invalid file type: Only image files are supported');
    }

    // Validate base64 data
    if (
      !base64Data ||
      typeof base64Data !== 'string' ||
      base64Data.trim().length === 0
    ) {
      throw new Error('Invalid base64 data provided');
    }

    // Decode and validate size
    let buffer: Buffer;
    try {
      buffer = Buffer.from(base64Data, 'base64');
    } catch {
      throw new Error('Failed to decode base64 data');
    }

    // Check file size limit
    if (buffer.length > SHARED_CONSTANTS.MAX_IMAGE_SIZE_BYTES) {
      const sizeMB = (buffer.length / (1024 * 1024)).toFixed(2);
      const maxMB = (
        SHARED_CONSTANTS.MAX_IMAGE_SIZE_BYTES /
        (1024 * 1024)
      ).toFixed(0);
      throw new Error(
        `Image file too large: ${sizeMB}MB (maximum: ${maxMB}MB)`
      );
    }

    // Check the ceiling for the directory as a whole. Per-file limits alone
    // bound one drop, not a session that keeps dropping: saved images are only
    // reclaimed when the session ends.
    const storedBytes = await this.getStorageBytes();
    if (
      storedBytes + buffer.length >
      SHARED_CONSTANTS.MAX_IMAGE_STORAGE_BYTES
    ) {
      const maxMB = (
        SHARED_CONSTANTS.MAX_IMAGE_STORAGE_BYTES /
        (1024 * 1024)
      ).toFixed(0);
      throw new Error(
        `Image storage is full: ${maxMB}MB already saved. ` +
          'Run "Terminal For AI CLI: Delete saved images" to free space.'
      );
    }

    // Validate filename
    if (
      !fileName ||
      typeof fileName !== 'string' ||
      fileName.trim().length === 0
    ) {
      throw new Error('Invalid filename provided');
    }

    // Sanitize and validate filename length
    const sanitizedFileName = fileName
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .trim();
    if (sanitizedFileName.length === 0) {
      throw new Error('Filename contains no valid characters');
    }

    const timestamp = Date.now();
    let uniqueFileName = `${timestamp}_${sanitizedFileName}`;

    // Ensure total filename length doesn't exceed filesystem limits
    if (uniqueFileName.length > SHARED_CONSTANTS.MAX_IMAGE_FILENAME_LENGTH) {
      const extension = path.extname(sanitizedFileName);
      const nameWithoutExt = path.basename(sanitizedFileName, extension);
      const maxNameLength =
        SHARED_CONSTANTS.MAX_IMAGE_FILENAME_LENGTH -
        timestamp.toString().length -
        extension.length -
        2; // -2 for underscores
      const truncatedName = nameWithoutExt.substring(
        0,
        Math.max(1, maxNameLength)
      );
      uniqueFileName = `${timestamp}_${truncatedName}${extension}`;
      Logger.warn(
        `Filename truncated due to length limit: ${fileName} -> ${uniqueFileName}`
      );
    }

    const imagesDir = this.imagesDir;
    await vscode.workspace.fs.createDirectory(imagesDir);

    const imageUri = vscode.Uri.joinPath(imagesDir, uniqueFileName);

    await vscode.workspace.fs.writeFile(imageUri, buffer);
    this.cachedBytes = undefined;

    // Track which session used this image
    if (!this.sessionImages.has(sessionId)) {
      this.sessionImages.set(sessionId, new Set());
    }
    const sessionImageSet = this.sessionImages.get(sessionId);
    if (sessionImageSet) {
      sessionImageSet.add(imageUri.fsPath);
    }

    return escapeShellPath(imageUri.fsPath);
  }

  /**
   * Deletes all images associated with a session.
   *
   * @param sessionId - The session ID whose images should be deleted
   */
  async deleteSessionImages(sessionId: string): Promise<void> {
    const imagePaths = this.sessionImages.get(sessionId);
    if (!imagePaths || imagePaths.size === 0) {
      return;
    }

    for (const imagePath of imagePaths) {
      try {
        const imageUri = vscode.Uri.file(imagePath);
        await vscode.workspace.fs.delete(imageUri, {useTrash: false});
      } catch (error) {
        Logger.warn(`Failed to delete image ${imagePath}`, error);
      }
    }

    this.sessionImages.delete(sessionId);
    this.cachedBytes = undefined;
  }

  /**
   * Clears all saved images from this window's storage.
   */
  async clearAllImages(): Promise<void> {
    try {
      try {
        await vscode.workspace.fs.delete(this.imagesDir, {
          recursive: true,
          useTrash: false,
        });
      } catch (error) {
        if (error instanceof vscode.FileSystemError) {
          return;
        }
        throw error;
      }
    } catch (error) {
      Logger.warn('Failed to clear images', error);
    } finally {
      this.sessionImages.clear();
      this.cachedBytes = undefined;
    }
  }

  /**
   * Cleanup orphaned images from previous sessions that weren't properly cleaned up.
   * Also removes files that exceed IMAGE_TTL_MS age, even if tracked as active,
   * as a safeguard against stale in-memory tracking.
   * @returns The number of deleted files
   */
  async cleanupOrphanedImages(): Promise<number> {
    try {
      const imagesDir = this.imagesDir;

      let files: [string, vscode.FileType][];
      try {
        files = await vscode.workspace.fs.readDirectory(imagesDir);
      } catch {
        return 0;
      }

      // Collect all paths currently in use by active sessions
      const activePaths = new Set<string>();
      for (const paths of this.sessionImages.values()) {
        for (const p of paths) {
          activePaths.add(p);
        }
      }

      let deletedCount = 0;
      for (const [fileName, fileType] of files) {
        if (fileType !== vscode.FileType.File) {
          continue;
        }
        const fileUri = vscode.Uri.joinPath(imagesDir, fileName);
        const fsPath = fileUri.fsPath;
        const stale = this.isFileStale(fileName);

        if (!stale && activePaths.has(fsPath)) {
          continue;
        }

        // Stale file tracked as active — remove from in-memory tracking first
        if (stale && activePaths.has(fsPath)) {
          for (const paths of this.sessionImages.values()) {
            paths.delete(fsPath);
          }
          Logger.info(`Removing stale tracked image: ${fileName}`);
        }

        try {
          await vscode.workspace.fs.delete(fileUri, {useTrash: false});
          deletedCount++;
        } catch (error) {
          Logger.warn(`Failed to delete orphaned image ${fileName}`, error);
        }
      }

      if (deletedCount > 0) {
        this.cachedBytes = undefined;
        Logger.info(`Cleaned up ${deletedCount} orphaned image(s)`);
      }

      return deletedCount;
    } catch (error) {
      Logger.error('Failed to cleanup orphaned images', error);
      return 0;
    }
  }

  /**
   * Returns true if the file's embedded timestamp is older than IMAGE_TTL_MS.
   * Filenames are formatted as `${timestamp}_${sanitizedName}`.
   */
  private isFileStale(fileName: string): boolean {
    const timestamp = parseInt(fileName.split('_')[0], 10);
    if (!Number.isFinite(timestamp)) {
      return false;
    }
    return Date.now() - timestamp > SHARED_CONSTANTS.IMAGE_TTL_MS;
  }

  /**
   * Clears session image tracking data.
   */
  clearTracking(): void {
    this.sessionImages.clear();
    this.cachedBytes = undefined;
  }
}
