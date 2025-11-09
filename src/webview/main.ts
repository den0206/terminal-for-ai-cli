import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';

interface VSCodeApi<State = unknown> {
  postMessage(message: unknown): void;
  setState(state: State): void;
  getState(): State | undefined;
}

declare const acquireVsCodeApi: <State = undefined>() => VSCodeApi<State>;

type ThemePalette = {
  background: string;
  foreground: string;
  cursor: string;
  selection: string;
};

type ThemePresetInfo = {
  key: string;
  label: string;
  description: string;
  preview: { background: string; foreground: string };
};

type ThemeUpdatePayload = {
  presetKey: string;
  palette: ThemePalette;
  presets: ThemePresetInfo[];
};

type InboundMessage =
  | { type: 'session-count'; payload: { total: number } }
  | {
      type: 'session-created';
      payload: { id: string; shell: string; pid?: number; label?: string; restored?: boolean }
    }
  | { type: 'session-data'; payload: { sessionId: string; data: string } }
  | { type: 'session-exited'; payload: { sessionId: string; code: number | null; signal: string | null } }
  | { type: 'session-error'; payload: { message: string } }
  | { type: 'theme-update'; payload: ThemeUpdatePayload };

type OutboundMessage =
  | { type: 'webview-ready' }
  | { type: 'request-new-session'; payload?: { cols: number; rows: number } }
  | { type: 'terminal-input'; payload: { sessionId: string; data: string } }
  | { type: 'terminal-resize'; payload: { sessionId: string; cols: number; rows: number } }
  | { type: 'dispose-session'; payload: { sessionId: string } }
  | { type: 'theme-select'; payload: { presetKey: string } };

type SessionMeta = { shell: string; label: string };

type ViewState = {
  activeSessionId?: string;
  totalSessions: number;
  sessionIds: string[];
  terminalHeight?: number;
  sessionMeta?: Record<string, SessionMeta>;
};

const vscode = acquireVsCodeApi<ViewState>();

const statusEl = document.querySelector('[data-session-status]') as HTMLSpanElement | null;
const addSessionButton = document.querySelector('[data-session-add]') as HTMLButtonElement | null;
const removeSessionButton = document.querySelector('[data-session-remove]') as HTMLButtonElement | null;
const terminalRoot = document.getElementById('terminal-root') as HTMLDivElement | null;
const terminalShell = document.querySelector('[data-terminal-shell]') as HTMLDivElement | null;
const resizerEl = document.querySelector('[data-terminal-resizer]') as HTMLDivElement | null;
const sessionSelectEl = document.querySelector('[data-session-select]') as HTMLSelectElement | null;
const themeSelectEl = document.querySelector('[data-theme-select]') as HTMLSelectElement | null;
const themeActiveLabel = document.querySelector('[data-theme-active-label]') as HTMLSpanElement | null;
const themePreviewText = document.querySelector('[data-theme-preview-text]') as HTMLSpanElement | null;
const themePreviewSwatch = document.querySelector('[data-theme-swatch]') as HTMLSpanElement | null;

const sessionBuffers: Record<string, string> = {};
const MAX_BUFFER_SIZE = 200_000;

const savedState = vscode.getState() ?? { totalSessions: 0, sessionIds: [] };
let activeSessionId = savedState.activeSessionId;
let totalSessions = savedState.totalSessions ?? 0;
let sessionIds = Array.isArray(savedState.sessionIds) ? [...savedState.sessionIds] : [];
let terminalHeight = typeof savedState.terminalHeight === 'number' ? savedState.terminalHeight : 640;
let pendingSessionRequest = false;
let currentThemeKey: string | undefined;
let availablePresets: ThemePresetInfo[] = [];
let sessionMeta: Record<string, SessionMeta> = savedState.sessionMeta ?? {};
sessionIds.forEach((id, index) => {
  sessionBuffers[id] = sessionBuffers[id] ?? '';
  sessionMeta[id] =
    sessionMeta[id] ?? ({
      shell: 'シェル',
      label: `ターミナル${index + 1}`
    } as SessionMeta);
});

const terminal = new Terminal({
  allowTransparency: true,
  convertEol: true,
  cursorBlink: true,
  scrollback: 2000,
  fontFamily: getComputedVar('--vscode-editor-font-family', 'var(--monaco-monospace-font)', 'monospace'),
  fontSize: Number.parseInt(getComputedVar('--vscode-editor-font-size', undefined, '13'), 10) || 13,
  theme: {
    background: getComputedVar('--vscode-editor-background', undefined, '#1e1e1e'),
    foreground: getComputedVar('--vscode-editor-foreground', undefined, '#cccccc'),
    cursor: getComputedVar('--vscode-terminalCursor-foreground', undefined, '#ffffff'),
    selection: getComputedVar('--vscode-editor-selectionBackground', undefined, 'rgba(255,255,255,0.15)')
  }
});
const fitAddon = new FitAddon();
terminal.loadAddon(fitAddon);

if (terminalRoot) {
  terminal.open(terminalRoot);
  fitTerminal();
  terminal.focus();
}
applyTerminalHeight(terminalHeight, false);
refreshTerminalTheme();

terminal.onData((data) => {
  if (activeSessionId) {
    vscode.postMessage<OutboundMessage>({
      type: 'terminal-input',
      payload: { sessionId: activeSessionId, data }
    });
  }
});

window.addEventListener('message', (event: MessageEvent<InboundMessage>) => {
  const message = event.data;
  if (!message) {
    return;
  }
  switch (message.type) {
    case 'session-count':
      totalSessions = message.payload.total;
      if (totalSessions === 0) {
        sessionIds = [];
        sessionMeta = {};
        if (activeSessionId) {
          activeSessionId = undefined;
          terminal.reset();
        }
        setStatus('セッションがありません');
      } else {
        setStatus(`登録済みセッション: ${totalSessions} 件`);
      }
      persistState();
      updateDisposeButtonState();
      break;
    case 'session-created':
      pendingSessionRequest = false;
      updateAddButtonState(false);
      sessionIds = sessionIds.filter((id) => id !== message.payload.id);
      sessionIds.push(message.payload.id);
      sessionMeta[message.payload.id] = {
        shell: message.payload.shell,
        label: message.payload.label ?? `ターミナル${sessionIds.length}`
      };
      sessionBuffers[message.payload.id] = '';
      persistState();
      const restored = Boolean(message.payload.restored);
      activateSession(message.payload.id, message.payload.shell);
      // no log panel
      break;
    case 'session-data':
      if (!activeSessionId) {
        activeSessionId = message.payload.sessionId;
        persistState();
        updateSessionControls();
      }
      appendToBuffer(message.payload.sessionId, message.payload.data);
      if (message.payload.sessionId === activeSessionId) {
        terminal.write(message.payload.data);
      }
      break;
    case 'session-exited':
      sessionIds = sessionIds.filter((id) => id !== message.payload.sessionId);
      delete sessionMeta[message.payload.sessionId];
      delete sessionBuffers[message.payload.sessionId];
      persistState();
      if (message.payload.sessionId === activeSessionId) {
        const fallbackId = sessionIds[sessionIds.length - 1];
        if (fallbackId) {
          switchActiveSession(fallbackId, `セッション ${fallbackId} に切り替えました`);
        } else {
          activeSessionId = undefined;
          persistState();
          terminal.reset();
          setStatus('セッションが終了しました');
          updateSessionControls();
        }
      }
      break;
    case 'session-error':
      pendingSessionRequest = false;
      updateAddButtonState(false);
      setStatus(`エラー: ${message.payload.message}`);
      break;
    case 'theme-update':
      applyTheme(message.payload.palette);
      currentThemeKey = message.payload.presetKey;
      availablePresets = message.payload.presets;
      renderThemeDropdown();
      break;
    default:
      break;
  }
});

addSessionButton?.addEventListener('click', () => {
  requestNewSession();
});

removeSessionButton?.addEventListener('click', () => {
  if (!activeSessionId || pendingSessionRequest) {
    return;
  }
  setStatus('セッションを終了しています…');
  updateSessionControls();
  vscode.postMessage<OutboundMessage>({
    type: 'dispose-session',
    payload: { sessionId: activeSessionId }
  });
});

sessionSelectEl?.addEventListener('change', () => {
  const nextSessionId = sessionSelectEl.value;
  if (!nextSessionId || nextSessionId === activeSessionId) {
    return;
  }
  switchActiveSession(nextSessionId, `${getSessionLabel(nextSessionId)} に切り替えました`);
});
window.addEventListener(
  'resize',
  debounce(() => {
    fitTerminal();
    notifyResize();
  }, 150)
);

resizerEl?.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  const pointerId = event.pointerId;
  const startY = event.clientY;
  const startHeight = terminalHeight;

  const onMove = (moveEvent: PointerEvent) => {
    if (moveEvent.pointerId !== pointerId) {
      return;
    }
    const delta = moveEvent.clientY - startY;
    applyTerminalHeight(startHeight + delta, false);
  };

  const cleanup = (moveEvent: PointerEvent) => {
    if (moveEvent.pointerId !== pointerId) {
      return;
    }
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', cleanup);
    window.removeEventListener('pointercancel', cleanup);
    persistState();
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', cleanup);
  window.addEventListener('pointercancel', cleanup);
});

themeSelectEl?.addEventListener('change', () => {
  const presetKey = themeSelectEl.value;
  if (!presetKey || presetKey === currentThemeKey) {
    return;
  }
  vscode.postMessage<OutboundMessage>({ type: 'theme-select', payload: { presetKey } });
});

vscode.postMessage<OutboundMessage>({ type: 'webview-ready' });
if (activeSessionId) {
  setStatus(`セッション ${activeSessionId} を復元中…`);
  notifyResize();
} else {
  setStatus('セッションを初期化しています…');
}
updateSessionControls();

function requestNewSession() {
  if (pendingSessionRequest) {
    return;
  }
  pendingSessionRequest = true;
  updateAddButtonState(true);
  setStatus('新しいセッションを初期化しています…');
  fitTerminal();
  vscode.postMessage<OutboundMessage>({
    type: 'request-new-session',
    payload: getTerminalDimensions()
  });
}

function activateSession(sessionId: string, shell?: string) {
  activeSessionId = sessionId;
  persistState();
  terminal.reset();
  writeBufferToTerminal(sessionId);
  terminal.scrollToBottom();
  fitTerminal();
  notifyResize();
  terminal.focus();
  setStatus(`${getSessionLabel(sessionId)} (${shell ?? sessionMeta[sessionId]?.shell ?? 'シェル'}) に接続しました`);
  updateSessionControls();
}

function switchActiveSession(sessionId: string, message: string) {
  activeSessionId = sessionId;
  persistState();
  terminal.reset();
  writeBufferToTerminal(sessionId);
  terminal.scrollToBottom();
  fitTerminal();
  notifyResize();
  terminal.focus();
  setStatus(message);
  updateSessionControls();
}

function notifyResize() {
  if (!activeSessionId) {
    return;
  }
  const { cols, rows } = getTerminalDimensions();
  vscode.postMessage<OutboundMessage>({
    type: 'terminal-resize',
    payload: { sessionId: activeSessionId, cols, rows }
  });
}

function fitTerminal() {
  if (!terminalRoot) {
    return;
  }
  fitAddon.fit();
}

function getTerminalDimensions() {
  return {
    cols: terminal.cols || 80,
    rows: terminal.rows || 24
  };
}

function setStatus(text: string) {
  if (statusEl) {
    statusEl.textContent = text;
  }
}

function updateAddButtonState(isBusy: boolean) {
  if (!addSessionButton) {
    return;
  }
  addSessionButton.disabled = isBusy;
}

function updateSessionControls() {
  if (removeSessionButton) {
    removeSessionButton.disabled = !activeSessionId || pendingSessionRequest;
  }
  if (sessionSelectEl) {
    sessionSelectEl.disabled = sessionIds.length === 0;
  }
  updateAddButtonState(pendingSessionRequest);
  renderSessionSelect();
}

function renderSessionSelect() {
  if (!sessionSelectEl) {
    return;
  }
  sessionSelectEl.innerHTML = '';
  sessionIds.forEach((id, index) => {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = getSessionLabel(id, index);
    sessionSelectEl.appendChild(option);
  });
  if (activeSessionId) {
    sessionSelectEl.value = activeSessionId;
  }
  sessionSelectEl.disabled = sessionIds.length === 0;
}

function persistState() {
  vscode.setState({ activeSessionId, totalSessions, sessionIds, terminalHeight, sessionMeta });
}

function getSessionLabel(sessionId: string, fallbackIndex?: number) {
  return (
    sessionMeta[sessionId]?.label ??
    (typeof fallbackIndex === 'number' ? `ターミナル${fallbackIndex + 1}` : sessionId)
  );
}

function appendToBuffer(sessionId: string, chunk: string) {
  if (!sessionBuffers[sessionId]) {
    sessionBuffers[sessionId] = '';
  }
  let next = sessionBuffers[sessionId] + chunk;
  if (next.length > MAX_BUFFER_SIZE) {
    next = next.slice(next.length - MAX_BUFFER_SIZE);
  }
  sessionBuffers[sessionId] = next;
}

function writeBufferToTerminal(sessionId: string) {
  const buffer = sessionBuffers[sessionId];
  if (buffer) {
    terminal.write(buffer);
  }
}

function debounce<T extends (...args: never[]) => void>(fn: T, delay: number) {
  let handle: number | undefined;
  return (...args: Parameters<T>) => {
    if (handle) {
      clearTimeout(handle);
    }
    handle = window.setTimeout(() => {
      fn(...args);
    }, delay);
  };
}

function getComputedVar(
  name: string,
  fallbackVar?: string,
  fallbackValue?: string
): string {
  const styles = getComputedStyle(document.documentElement);
  const value = styles.getPropertyValue(name)?.trim();
  if (value) {
    return value;
  }
  if (fallbackVar) {
    const nested = styles.getPropertyValue(fallbackVar)?.trim();
    if (nested) {
      return nested;
    }
  }
  return fallbackValue ?? '';
}

function applyTerminalHeight(value: number, persist = true) {
  const clamped = Math.min(Math.max(value, 220), 1000);
  terminalHeight = clamped;
  if (terminalShell) {
    terminalShell.style.setProperty('--terminal-height', `${clamped}px`);
  }
  fitTerminal();
  notifyResize();
  if (persist) {
    persistState();
  }
}

function refreshTerminalTheme() {
  terminal.options.theme = {
    background: getComputedVar('--terminal-bg', '--vscode-editor-background', '#1e1e1e'),
    foreground: getComputedVar('--terminal-fg', '--vscode-editor-foreground', '#cccccc'),
    cursor: getComputedVar('--terminal-cursor', '--vscode-terminalCursor-foreground', '#ffffff'),
    selection: getComputedVar(
      '--terminal-selection',
      '--vscode-editor-selectionBackground',
      'rgba(255,255,255,0.15)'
    )
  };
}

function applyTheme(palette: ThemePalette) {
  const root = document.documentElement;
  root.style.setProperty('--terminal-bg', palette.background);
  root.style.setProperty('--terminal-fg', palette.foreground);
  root.style.setProperty('--terminal-cursor', palette.cursor);
  root.style.setProperty('--terminal-selection', palette.selection);
  refreshTerminalTheme();
}

function renderThemeDropdown() {
  if (!themeSelectEl) {
    return;
  }
  themeSelectEl.innerHTML = '';
  availablePresets.forEach((preset) => {
    const option = document.createElement('option');
    option.value = preset.key;
    option.textContent = preset.label;
    themeSelectEl.appendChild(option);
  });
  if (currentThemeKey) {
    themeSelectEl.value = currentThemeKey;
  }
  const active = availablePresets.find((preset) => preset.key === currentThemeKey);
  if (themeActiveLabel) {
    themeActiveLabel.textContent = active ? active.description : '―';
  }
  updateThemePreview(active ?? null);
}

function updateThemePreview(preset: ThemePresetInfo | null) {
  if (!themePreviewText || !themePreviewSwatch) {
    return;
  }
  if (preset) {
    themePreviewText.textContent = preset.label;
    themePreviewSwatch.style.background = preset.preview.background;
    themePreviewSwatch.style.color = preset.preview.foreground;
  } else {
    themePreviewText.textContent = 'プレビュー';
    themePreviewSwatch.style.background = '';
  }
}
