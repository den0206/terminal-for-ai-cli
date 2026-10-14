/// <reference types="node" />
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {ImeController} from './ime-controller';

class Textarea extends EventTarget {
  value = '';
  selectionStart = 0;
  selectionEnd = 0;
}

function harness() {
  const textarea = new Textarea();
  const controller = new ImeController(textarea as unknown as HTMLTextAreaElement);
  const fire = (type: string) => textarea.dispatchEvent(new Event(type));
  const key = (keyCode: number, isComposing = false) => ({type: 'keydown', keyCode, isComposing} as KeyboardEvent);
  return {textarea, controller, fire, key};
}

describe('IME composition ownership', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('keeps candidate keys in the IME even when isComposing is false', () => {
    const h = harness();
    h.fire('compositionstart');
    for (const code of [13, 32, 38, 40, 229]) expect(h.controller.ownsKey(h.key(code))).toBe(true);
    h.fire('compositionend');
    expect(h.controller.ownsKey(h.key(13, true))).toBe(true);
    expect(h.controller.ownsKey(h.key(13))).toBe(false);
    h.controller.dispose();
  });

  it('waits for xterm to read the final text before clearing', () => {
    const h = harness();
    const sent: string[] = [];
    h.fire('compositionstart');
    h.textarea.value = '確定';
    h.fire('compositionend');
    // xterm compositionend listener schedules its send after our capture listener.
    setTimeout(() => sent.push(h.textarea.value), 0);
    vi.runAllTimers();
    expect(sent).toEqual(['確定']);
    expect(h.textarea.value).toBe('');
    h.controller.dispose();
  });

  it('does not erase a new composition started before the cleanup timer', () => {
    const h = harness();
    h.fire('compositionstart');
    h.textarea.value = '確定';
    h.fire('compositionend');
    h.fire('compositionstart');
    h.textarea.value = '確定次の変換';
    vi.runAllTimers();
    expect(h.textarea.value).toBe('確定次の変換');
    h.controller.dispose();
  });

  it('does not erase input arriving between the cleanup turns', () => {
    const h = harness();
    h.fire('compositionend');
    vi.runOnlyPendingTimers();
    h.textarea.value = '追加入力';
    h.fire('input');
    vi.runAllTimers();
    expect(h.textarea.value).toBe('追加入力');
    h.controller.dispose();
  });

  it('does not erase the textarea selection prepared by a native context menu', () => {
    const h = harness();
    h.textarea.value = 'コピー対象';
    h.fire('compositionend');
    h.textarea.selectionEnd = 5;
    vi.runAllTimers();
    expect(h.textarea.value).toBe('コピー対象');
    h.controller.dispose();
  });

  it('cancels pending cleanup on disposal', () => {
    const h = harness();
    h.textarea.value = '確定';
    h.fire('compositionend');
    h.controller.dispose();
    vi.runAllTimers();
    expect(h.textarea.value).toBe('確定');
  });

  it('prevents the previous phrase resend in the actual xterm 6 CompositionHelper', () => {
    const source = readFileSync('node_modules/@xterm/xterm/src/browser/input/CompositionHelper.ts', 'utf8')
      .replace(/^import .*;\n/gm, '').replace(/@\w+ /g, '');
    const code = transformSync(source, {loader: 'ts', format: 'cjs'}).code;
    const module = {exports: {} as {CompositionHelper: new (...args: unknown[]) => {
      compositionstart(): void;
      compositionupdate(event: {data: string}): void;
      compositionend(): void;
      keydown(event: {keyCode: number}): boolean;
    }}};
    new Function('module', 'exports', 'setTimeout', 'C0', code)(module, module.exports, setTimeout, {DEL: '\x7f'});
    const run = (guard: boolean) => {
      const h = harness();
      const sent: string[] = [];
      h.textarea.value = '前の文';
      const helper = new module.exports.CompositionHelper(h.textarea,
        {textContent: '', classList: {add() {}, remove() {}}},
        {buffer: {isCursorInViewport: false}}, {},
        {triggerDataEvent(text: string) {sent.push(text);}}, {});
      h.fire('compositionstart');
      helper.compositionstart();
      h.textarea.value = '前の文新';
      helper.compositionupdate({data: '新'});
      // Candidate Enter arrives before the deferred end-position update.
      if (!guard || !h.controller.ownsKey(h.key(13))) helper.keydown({keyCode: 13});
      const duringConversion = [...sent];
      vi.runAllTimers();
      if (guard) {
        h.fire('compositionend');
        helper.compositionend();
        vi.runAllTimers();
      }
      h.controller.dispose();
      return {duringConversion, sent};
    };
    expect(run(false).duringConversion).toEqual(['前の文']);
    expect(run(true)).toEqual({duringConversion: [], sent: ['新']});
  });
});
