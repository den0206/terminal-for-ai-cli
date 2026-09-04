import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {SHARED_CONSTANTS} from '../../shared/constants';
import {DragDropHandler} from './drag-drop-handler';
import type {OutboundMessage} from './types';

// DragDropHandler は `document` を購読対象として渡すだけで、購読自体は注入された
// 関数が受ける。テストランナーは node 環境なので、参照だけ通るように置いておく。
(globalThis as {document?: unknown}).document = {};

function createImageFile(name: string, size = 8): File {
  return {
    name,
    type: 'image/png',
    size,
    arrayBuffer: async () => new ArrayBuffer(size),
  } as unknown as File;
}

function createDropEvent(files: File[], uriList = ''): DragEvent {
  return {
    shiftKey: true,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    dataTransfer: {
      types: ['Files'],
      files,
      getData: vi.fn(() => uriList),
    },
  } as unknown as DragEvent;
}

describe('DragDropHandler', () => {
  const posted: OutboundMessage[] = [];
  let drop: (event: DragEvent) => Promise<void>;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    posted.length = 0;
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const listeners = new Map<string, (event: DragEvent) => Promise<void>>();

    new DragDropHandler(
      () => 'session-1',
      (message) => posted.push(message),
      (_target, event, handler) => {
        listeners.set(
          event,
          handler as unknown as (event: DragEvent) => Promise<void>
        );
      }
    ).setup();

    drop = listeners.get('drop')!;
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('saves every image of a small drop', async () => {
    await drop(createDropEvent([createImageFile('a.png')]));

    expect(posted).toHaveLength(1);
    expect(posted[0].type).toBe('image-drop');
  });

  it('caps how many images one drop can save', async () => {
    const files = Array.from(
      {length: SHARED_CONSTANTS.MAX_DROPPED_IMAGES + 5},
      (_, index) => createImageFile(`shot-${index}.png`)
    );

    await drop(createDropEvent(files));

    // 上限が無いと、1 回のドロップで数百 MB をストレージへ書ける
    expect(posted).toHaveLength(SHARED_CONSTANTS.MAX_DROPPED_IMAGES);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Dropped more than'),
    );
  });

  it('keeps the first images of an oversized drop, in order', async () => {
    const files = Array.from({length: 20}, (_, index) =>
      createImageFile(`shot-${index}.png`)
    );

    await drop(createDropEvent(files));

    const names = posted.map((message) =>
      message.type === 'image-drop' ? message.payload.fileName : ''
    );
    expect(names[0]).toBe('shot-0.png');
    expect(names).toHaveLength(SHARED_CONSTANTS.MAX_DROPPED_IMAGES);
  });

  it('skips images above the per-file size limit without spending a slot', async () => {
    const oversized = createImageFile(
      'huge.png',
      SHARED_CONSTANTS.MAX_IMAGE_SIZE_BYTES + 1
    );

    await drop(createDropEvent([oversized, createImageFile('ok.png')]));

    expect(posted).toHaveLength(1);
    expect(
      posted[0].type === 'image-drop' && posted[0].payload.fileName
    ).toBe('ok.png');
  });
});
