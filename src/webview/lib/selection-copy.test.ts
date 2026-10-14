import {describe, expect, it, vi} from 'vitest';
import {installSelectionCopy} from './selection-copy';

class ElementStub extends EventTarget {
  hidden = true;
  style: Record<string, string> = {};
  offsetWidth = 80;
  offsetHeight = 28;
  focus = vi.fn();
  remove = vi.fn();
  contains(target: unknown) { return target === this; }
}

function harness(isMac = false) {
  const menu = new ElementStub();
  const doc = Object.assign(new EventTarget(), {
    createElement: () => menu,
    body: {append: vi.fn()},
    defaultView: Object.assign(new EventTarget(), {innerWidth: 400, innerHeight: 300}),
  });
  const root = Object.assign(new ElementStub(), {ownerDocument: doc});
  let selection = '日本語\nselected text';
  const terminal = {getSelection: () => selection, focus: vi.fn()};
  const copy = vi.fn();
  const dispose = installSelectionCopy(root as unknown as HTMLElement, terminal, copy, isMac);
  function fire(target: EventTarget, type: string, fields: Record<string, unknown> = {}) {
    const event = new Event(type, {cancelable: true});
    for (const [key, value] of Object.entries(fields)) Object.defineProperty(event, key, {value});
    target.dispatchEvent(event);
    return event;
  }
  return {root, doc, menu, terminal, copy, dispose, fire, setSelection: (text: string) => {selection = text;}};
}

describe('terminal selection copy', () => {
  it('blocks the right click before mouse reporting can clear selection', () => {
    const h = harness();
    const reportMouse = vi.fn(() => h.setSelection(''));
    h.root.addEventListener('mousedown', reportMouse);
    h.fire(h.root, 'mousedown', {button: 2});
    expect(reportMouse).not.toHaveBeenCalled();
    expect(h.fire(h.root, 'mouseup', {button: 2}).defaultPrevented).toBe(true);
  });

  it('copies the snapshot even if output changes the selection while the menu is open', () => {
    const h = harness();
    h.fire(h.root, 'mousedown', {button: 2});
    h.fire(h.root, 'contextmenu', {clientX: 399, clientY: 299});
    h.setSelection('');
    h.fire(h.menu, 'click');
    expect(h.copy).toHaveBeenCalledWith('日本語\nselected text');
    expect(h.menu.hidden).toBe(true);
    expect(h.terminal.focus).toHaveBeenCalled();
  });

  it('leaves the native menu and CLI mouse input alone without a selection', () => {
    const h = harness();
    h.setSelection('');
    expect(h.fire(h.root, 'mousedown', {button: 2}).defaultPrevented).toBe(false);
    expect(h.fire(h.root, 'contextmenu').defaultPrevented).toBe(false);
    expect(h.menu.hidden).toBe(true);
  });

  it('protects macOS Ctrl+click too', () => {
    const h = harness(true);
    expect(h.fire(h.root, 'mousedown', {button: 0, ctrlKey: true}).defaultPrevented).toBe(true);
  });

  it('copies Ctrl+C selection but preserves interrupt without selection', () => {
    const h = harness();
    const fields = {key: 'c', ctrlKey: true, target: h.root};
    expect(h.fire(h.doc, 'keydown', fields).defaultPrevented).toBe(true);
    expect(h.copy).toHaveBeenCalledWith('日本語\nselected text');
    h.setSelection('');
    expect(h.fire(h.doc, 'keydown', fields).defaultPrevented).toBe(false);
  });

  it('does not intercept IME keystrokes or copy from another input', () => {
    const h = harness();
    expect(h.fire(h.doc, 'keydown', {key: 'c', ctrlKey: true, target: h.root, isComposing: true}).defaultPrevented).toBe(false);
    expect(h.fire(h.doc, 'keydown', {key: 'c', ctrlKey: true, target: {}}).defaultPrevented).toBe(false);
    expect(h.copy).not.toHaveBeenCalled();
  });

  it('dismisses on Escape and removes listeners on disposal', () => {
    const h = harness();
    h.fire(h.root, 'contextmenu', {clientX: 0, clientY: 0});
    expect(h.fire(h.doc, 'keydown', {key: 'Escape'}).defaultPrevented).toBe(true);
    expect(h.menu.hidden).toBe(true);
    h.dispose();
    expect(h.menu.remove).toHaveBeenCalled();
    expect(h.fire(h.root, 'mousedown', {button: 2}).defaultPrevented).toBe(false);
  });
});
