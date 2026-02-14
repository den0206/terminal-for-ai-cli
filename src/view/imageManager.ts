import * as path from 'node:path';
import * as vscode from 'vscode';
import {SHARED_CONSTANTS} from '../shared/constants';
import {Logger} from '../utils/logger';

/**
 * Manages image storage and cleanup for terminal sessions.
 *
 * Handles drag-and-drop image saving to global storage, per-session
 * image tracking, and cleanup of orphaned images.
 */
export class ImageManager {
  private readonly sessionImages = new Map<string, Set<string>>();

  constructor(private readonly context: vscode.ExtensionContext) {}

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

    const storageUri = this.context.globalStorageUri;
    await vscode.workspace.fs.createDirectory(storageUri);

    const imagesDir = vscode.Uri.joinPath(storageUri, 'images');
    await vscode.workspace.fs.createDirectory(imagesDir);

    const imageUri = vscode.Uri.joinPath(imagesDir, uniqueFileName);

    await vscode.workspace.fs.writeFile(imageUri, buffer);

    // Track which session used this image
    if (!this.sessionImages.has(sessionId)) {
      this.sessionImages.set(sessionId, new Set());
    }
    const sessionImageSet = this.sessionImages.get(sessionId);
    if (sessionImageSet) {
      sessionImageSet.add(imageUri.fsPath);
    }

    return this.escapeShellPath(imageUri.fsPath);
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
  }

  /**
   * Clears all saved images from global storage.
   */
  async clearAllImages(): Promise<void> {
    try {
      const storageUri = this.context.globalStorageUri;
      const imagesDir = vscode.Uri.joinPath(storageUri, 'images');

      try {
        await vscode.workspace.fs.delete(imagesDir, {
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
    }

    this.sessionImages.clear();
  }

  /**
   * Cleanup orphaned images from previous sessions that weren't properly cleaned up.
   * @returns The number of deleted files
   */
  async cleanupOrphanedImages(): Promise<number> {
    try {
      const storageUri = this.context.globalStorageUri;
      const imagesDir = vscode.Uri.joinPath(storageUri, 'images');

      let files: [string, vscode.FileType][];
      try {
        files = await vscode.workspace.fs.readDirectory(imagesDir);
      } catch {
        return 0;
      }

      let deletedCount = 0;
      for (const [fileName, fileType] of files) {
        if (fileType === vscode.FileType.File) {
          try {
            const fileUri = vscode.Uri.joinPath(imagesDir, fileName);
            await vscode.workspace.fs.delete(fileUri, {useTrash: false});
            deletedCount++;
          } catch (error) {
            Logger.warn(`Failed to delete orphaned image ${fileName}`, error);
          }
        }
      }

      if (deletedCount > 0) {
        Logger.info(`Cleaned up ${deletedCount} orphaned image(s)`);
      }

      return deletedCount;
    } catch (error) {
      Logger.error('Failed to cleanup orphaned images', error);
      return 0;
    }
  }

  /**
   * Clears session image tracking data.
   */
  clearTracking(): void {
    this.sessionImages.clear();
  }

  /**
   * Escapes shell special characters in a path to prevent command injection.
   */
  private escapeShellPath(filePath: string): string {
    if (process.platform === 'win32') {
      return `"${filePath.replace(/"/g, '""')}"`;
    }
    return `'${filePath.replace(/'/g, "'\\''")}'`;
  }
}
