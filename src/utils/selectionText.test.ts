import {expect, it} from 'vitest';
import {formatSelection} from './selectionText';

it('includes source location and keeps nested code fences inside one block', () => {
  expect(formatSelection('src/app.ts', 12, 'typescript', '```ts\nx\n```')).toBe(
    'src/app.ts:12\n````typescript\n```ts\nx\n```\n````',
  );
});

it('drops control characters that could end a bracketed paste early', () => {
  expect(formatSelection('a.ts', 1, 'ts', 'x\x1b[201~\ty\r\n')).toBe(
    'a.ts:1\n```ts\nx[201~\ty\r\n\n```',
  );
});
