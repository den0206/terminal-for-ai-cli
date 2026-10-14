import type {Terminal} from '@xterm/xterm';

/** Snapshot before xterm reports a right click as user input and clears selection. */
export function installSelectionCopy(
  root: HTMLElement,
  terminal: Pick<Terminal, 'getSelection' | 'focus'>,
  copy: (text: string) => void,
  isMac: boolean,
): () => void {
  const doc = root.ownerDocument;
  const menu = doc.createElement('button');
  menu.type = 'button';
  menu.className = 'terminal-copy-menu';
  menu.textContent = 'Copy';
  menu.hidden = true;
  doc.body.append(menu);
  let snapshot = '';
  let rightGesture = false;
  const hide = () => { menu.hidden = true; snapshot = ''; };
  const consume = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const down = (event: MouseEvent) => {
    rightGesture = event.button === 2 || (isMac && event.button === 0 && event.ctrlKey);
    snapshot = rightGesture ? terminal.getSelection() : '';
    if (snapshot) consume(event);
  };
  const up = (event: MouseEvent) => {
    if (rightGesture && snapshot) consume(event);
    rightGesture = false;
  };
  const context = (event: MouseEvent) => {
    const text = snapshot || terminal.getSelection();
    if (!text) return;
    consume(event);
    snapshot = text;
    menu.hidden = false;
    const view = doc.defaultView;
    menu.style.left = `${Math.max(0, Math.min(event.clientX, (view?.innerWidth ?? event.clientX) - menu.offsetWidth))}px`;
    menu.style.top = `${Math.max(0, Math.min(event.clientY, (view?.innerHeight ?? event.clientY) - menu.offsetHeight))}px`;
    menu.focus();
  };
  const click = () => {
    const text = snapshot;
    hide();
    if (text) copy(text);
    terminal.focus();
  };
  const outside = (event: MouseEvent) => {
    if (!menu.hidden && event.target !== menu) hide();
  };
  const key = (event: KeyboardEvent) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape' && !menu.hidden) {
      consume(event);
      hide();
      terminal.focus();
      return;
    }
    const modifier = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
    if (event.key.toLowerCase() !== 'c' || !modifier || event.altKey) return;
    const target = event.target;
    if (!root.contains(target as Node) && target !== menu) return;
    const text = menu.hidden ? terminal.getSelection() : snapshot;
    if (!text) return; // Preserve Ctrl+C as interrupt when there is no selection.
    consume(event);
    copy(text);
    hide();
  };
  root.addEventListener('mousedown', down, {capture: true});
  root.addEventListener('mouseup', up, {capture: true});
  root.addEventListener('contextmenu', context, {capture: true});
  menu.addEventListener('click', click);
  doc.addEventListener('mousedown', outside, {capture: true});
  doc.addEventListener('keydown', key, {capture: true});
  const blur = () => { hide(); rightGesture = false; };
  doc.defaultView?.addEventListener('blur', blur);
  return () => {
    root.removeEventListener('mousedown', down, {capture: true});
    root.removeEventListener('mouseup', up, {capture: true});
    root.removeEventListener('contextmenu', context, {capture: true});
    doc.removeEventListener('mousedown', outside, {capture: true});
    doc.removeEventListener('keydown', key, {capture: true});
    doc.defaultView?.removeEventListener('blur', blur);
    menu.remove();
  };
}
