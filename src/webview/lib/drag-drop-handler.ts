import {SHARED_CONSTANTS} from '../../shared/constants';
import type {OutboundMessage} from './types';
import {webviewLog} from './utils';

/** RFC 2483。エディタのエクスプローラからのドラッグはこの形式で実パスを運ぶ。 */
const URI_LIST_TYPE = 'text/uri-list';

/**
 * Manages drag-and-drop on the webview: files dragged from the editor's
 * explorer, and images dragged from the OS.
 *
 * Two routes, because they carry different things. A drop from the explorer
 * comes with `text/uri-list`, which names the file's real path — that path is
 * what an AI CLI needs. A drop from the OS only gives `File` objects, whose
 * path a webview cannot read, so the bytes are copied into storage instead and
 * the copy's path is typed. Copying is fine for a screenshot, but pointless for
 * a source file, so only images take that route.
 *
 * Follows the same callback-injection pattern as ResizeController and
 * ThemeController.
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
      const types = event.dataTransfer.types;
      if (!types.includes('Files') && !types.includes(URI_LIST_TYPE)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'copy';
    };

    const handleDrop = async (event: DragEvent) => {
      if (!event.shiftKey || !event.dataTransfer) {
        return;
      }
      const uriList = event.dataTransfer.getData(URI_LIST_TYPE);
      const sessionId = this.getActiveSessionId();
      if (uriList) {
        event.preventDefault();
        event.stopPropagation();
        if (sessionId) {
          this.postMessage({type: 'uri-drop', payload: {uriList, sessionId}});
        }
        return;
      }
      if (!event.dataTransfer.files.length) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();

      const files = Array.from(event.dataTransfer.files);
      const imageFiles = files.filter((file) => file.type.startsWith('image/'));
      if (imageFiles.length === 0) {
        return;
      }

      if (!sessionId) {
        return;
      }

      for (const file of imageFiles) {
        try {
          if (file.size > SHARED_CONSTANTS.MAX_IMAGE_SIZE_BYTES) {
            const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
            const maxMB = (
              SHARED_CONSTANTS.MAX_IMAGE_SIZE_BYTES /
              (1024 * 1024)
            ).toFixed(0);
            webviewLog.warn(
              `Image file "${file.name}" is too large: ${sizeMB}MB (maximum: ${maxMB}MB). Skipping.`
            );
            continue;
          }

          const arrayBuffer = await file.arrayBuffer();
          // Split into chunks to avoid call stack limits on large files
          const uint8Array = new Uint8Array(arrayBuffer);
          const CHUNK = 8192;
          let binary = '';
          for (let i = 0; i < uint8Array.length; i += CHUNK) {
            binary += String.fromCharCode(...uint8Array.subarray(i, i + CHUNK));
          }
          const base64 = btoa(binary);

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
