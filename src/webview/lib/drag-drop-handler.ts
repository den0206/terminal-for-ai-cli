import {Constants} from './constants';
import type {OutboundMessage} from './types';
import {webviewLog} from './utils';

/**
 * Manages image drag-and-drop operations on the webview.
 *
 * Extracted from AppController to reduce class size and isolate
 * drag-and-drop concerns. Follows the same callback-injection pattern
 * as ResizeController and ThemeController.
 */
export class DragDropHandler {
  constructor(
    private readonly getActiveSessionId: () => string | undefined,
    private readonly postMessage: (msg: OutboundMessage) => void,
    private readonly addEventListener: (
      target: EventTarget,
      event: string,
      handler: EventListener
    ) => void
  ) {}

  setup(): void {
    const handleDragOver = (event: DragEvent) => {
      if (!event.shiftKey || !event.dataTransfer) {
        return;
      }
      if (!event.dataTransfer.types.includes('Files')) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'copy';
    };

    const handleDrop = async (event: DragEvent) => {
      if (!event.shiftKey || !event.dataTransfer?.files.length) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();

      const files = Array.from(event.dataTransfer.files);
      const imageFiles = files.filter((file) => file.type.startsWith('image/'));
      if (imageFiles.length === 0) {
        return;
      }

      const sessionId = this.getActiveSessionId();
      if (!sessionId) {
        return;
      }

      for (const file of imageFiles) {
        try {
          if (file.size > Constants.MAX_IMAGE_SIZE_BYTES) {
            const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
            const maxMB = (
              Constants.MAX_IMAGE_SIZE_BYTES /
              (1024 * 1024)
            ).toFixed(0);
            webviewLog.warn(
              `Image file "${file.name}" is too large: ${sizeMB}MB (maximum: ${maxMB}MB). Skipping.`
            );
            continue;
          }

          const arrayBuffer = await file.arrayBuffer();
          const uint8Array = new Uint8Array(arrayBuffer);
          const base64 = btoa(
            uint8Array.reduce(
              (data, byte) => data + String.fromCharCode(byte),
              ''
            )
          );

          this.postMessage({
            type: 'image-drop',
            payload: {
              fileName: file.name,
              mimeType: file.type,
              data: base64,
              sessionId,
            },
          });
        } catch (error) {
          webviewLog.error(
            `Failed to process image file "${file.name}":`,
            error
          );
        }
      }
    };

    this.addEventListener(
      document,
      'dragover',
      handleDragOver as unknown as EventListener
    );
    this.addEventListener(
      document,
      'drop',
      handleDrop as unknown as EventListener
    );
  }
}
