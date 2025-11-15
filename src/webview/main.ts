import {FitAddon} from '@xterm/addon-fit';
import {Terminal} from '@xterm/xterm';

interface VSCodeApi<State = unknown> {
  postMessage<T = unknown>(message: T): void;
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
  preview: {background: string; foreground: string};
};

type ThemeUpdatePayload = {
  presetKey: string;
  palette: ThemePalette;
  presets: ThemePresetInfo[];
};

type InboundMessage =
  | {type: 'session-count'; payload: {total: number}}
  | {
      type: 'session-created';
      payload: {
        id: string;
        shell: string;
        pid?: number;
        label?: string;
        restored?: boolean;
      };
    }
  | {type: 'session-data'; payload: {sessionId: string; data: string}}
  | {
      type: 'session-exited';
      payload: {sessionId: string; code: number | null; signal: string | null};
    }
  | {type: 'session-error'; payload: {message: string}}
  | {type: 'theme-update'; payload: ThemeUpdatePayload}
  | {type: 'all-sessions-cleared'};

type OutboundMessage =
  | {type: 'webview-ready'}
  | {type: 'request-new-session'; payload?: {cols: number; rows: number}}
  | {type: 'terminal-input'; payload: {sessionId: string; data: string}}
  | {
      type: 'terminal-resize';
      payload: {sessionId: string; cols: number; rows: number};
    }
  | {type: 'dispose-session'; payload: {sessionId: string}}
  | {type: 'dispose-all-sessions'}
  | {type: 'theme-select'; payload: {presetKey: string}};

type SessionMeta = {shell: string; label: string};

type ViewState = {
  activeSessionId?: string;
  totalSessions: number;
  sessionIds: string[];
  terminalHeight?: number;
  sessionMeta?: Record<string, SessionMeta>;
};

const vscode = acquireVsCodeApi<ViewState>();

const statusEl = document.querySelector(
  '[data-session-status]'
) as HTMLSpanElement | null;
const addSessionButton = document.querySelector(
  '[data-session-add]'
) as HTMLButtonElement | null;
const removeSessionButton = document.querySelector(
  '[data-session-remove]'
) as HTMLButtonElement | null;
const terminalRoot = document.getElementById(
  'terminal-root'
) as HTMLDivElement | null;
const terminalShell = document.querySelector(
  '[data-terminal-shell]'
) as HTMLDivElement | null;
const resizerEl = document.querySelector(
  '[data-terminal-resizer]'
) as HTMLDivElement | null;
const sessionSelectEl = document.querySelector(
  '[data-session-select]'
) as HTMLSelectElement | null;
const themeSelectEl = document.querySelector(
  '[data-theme-select]'
) as HTMLSelectElement | null;
const themeActiveLabel = document.querySelector(
  '[data-theme-active-label]'
) as HTMLSpanElement | null;
const themePreviewText = document.querySelector(
  '[data-theme-preview-text]'
) as HTMLSpanElement | null;
const themePreviewSwatch = document.querySelector(
  '[data-theme-swatch]'
) as HTMLSpanElement | null;
const clearAllButton = document.querySelector(
  '[data-session-clear-all]'
) as HTMLButtonElement | null;
const clearAllConfirm = document.querySelector(
  '[data-clear-all-confirm]'
) as HTMLDivElement | null;
const clearAllConfirmAccept = document.querySelector(
  '[data-clear-all-confirm-accept]'
) as HTMLButtonElement | null;
const clearAllConfirmCancel = document.querySelector(
  '[data-clear-all-confirm-cancel]'
) as HTMLButtonElement | null;

const sessionBuffers: Record<string, string> = {};
const MAX_BUFFER_SIZE = 200_000;

const savedState = vscode.getState() ?? {totalSessions: 0, sessionIds: []};
let activeSessionId = savedState.activeSessionId;
let totalSessions = savedState.totalSessions ?? 0;
let sessionIds = Array.isArray(savedState.sessionIds)
  ? [...savedState.sessionIds]
  : [];
let terminalHeight =
  typeof savedState.terminalHeight === 'number'
    ? savedState.terminalHeight
    : 640;
let pendingSessionRequest = false;
let clearingAll = false;
let confirmingClearAll = false;
let currentThemeKey: string | undefined;
let availablePresets: ThemePresetInfo[] = [];
let sessionMeta: Record<string, SessionMeta> = savedState.sessionMeta ?? {};
sessionIds.forEach((id, index) => {
  sessionBuffers[id] = sessionBuffers[id] ?? '';
  sessionMeta[id] =
    sessionMeta[id] ??
    ({
      shell: 'Shell',
      label: `Terminal ${index + 1}`,
    } as SessionMeta);
});

const terminal = new Terminal({
  allowTransparency: true,
  convertEol: true,
  cursorBlink: true,
  scrollback: 2000,
  fontFamily: getComputedVar(
    '--vscode-editor-font-family',
    'var(--monaco-monospace-font)',
    'monospace'
  ),
  fontSize:
    Number.parseInt(
      getComputedVar('--vscode-editor-font-size', undefined, '13'),
      10
    ) || 13,
  theme: {
    background: getComputedVar(
      '--vscode-editor-background',
      undefined,
      '#1e1e1e'
    ),
    foreground: getComputedVar(
      '--vscode-editor-foreground',
      undefined,
      '#cccccc'
    ),
    cursor: getComputedVar(
      '--vscode-terminalCursor-foreground',
      undefined,
      '#ffffff'
    ),
    selectionBackground: getComputedVar(
      '--vscode-editor-selectionBackground',
      undefined,
      'rgba(255,255,255,0.15)'
    ),
  },
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
      payload: {sessionId: activeSessionId, data},
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
        setStatus('No sessions available');
      } else {
        setStatus(`Registered sessions: ${totalSessions}`);
      }
      persistState();
      updateSessionControls();
      break;
    case 'session-created':
      pendingSessionRequest = false;
      updateAddButtonState(false);
      sessionIds = sessionIds.filter((id) => id !== message.payload.id);
      sessionIds.push(message.payload.id);
      sessionMeta[message.payload.id] = {
        shell: message.payload.shell,
        label: message.payload.label ?? `Terminal ${sessionIds.length}`,
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
          switchActiveSession(fallbackId, `Switched to session ${fallbackId}`);
        } else {
          activeSessionId = undefined;
          persistState();
          terminal.reset();
          setStatus('Session has ended');
          updateSessionControls();
        }
      }
      break;
    case 'session-error':
      pendingSessionRequest = false;
      updateAddButtonState(false);
      setStatus(`Error: ${message.payload.message}`);
      break;
    case 'theme-update':
      applyTheme(message.payload.palette);
      currentThemeKey = message.payload.presetKey;
      availablePresets = message.payload.presets;
      renderThemeDropdown();
      break;
    case 'all-sessions-cleared':
      clearingAll = false;
      pendingSessionRequest = false;
      confirmingClearAll = false;
      toggleClearAllConfirm(false);
      activeSessionId = undefined;
      sessionIds = [];
      sessionMeta = {};
      totalSessions = 0;
      for (const key of Object.keys(sessionBuffers)) {
        delete sessionBuffers[key];
      }
      terminal.reset();
      persistState();
      setStatus('All sessions cleared');
      updateSessionControls();
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
  setStatus('Ending session...');
  updateSessionControls();
  vscode.postMessage<OutboundMessage>({
    type: 'dispose-session',
    payload: {sessionId: activeSessionId},
  });
});

clearAllButton?.addEventListener('click', () => {
  if (pendingSessionRequest || clearingAll || sessionIds.length === 0) {
    return;
  }
  if (!confirmingClearAll) {
    confirmingClearAll = true;
    toggleClearAllConfirm(true);
    return;
  }
});

clearAllConfirmAccept?.addEventListener('click', () => {
  if (pendingSessionRequest || clearingAll || sessionIds.length === 0) {
    return;
  }
  confirmingClearAll = false;
  toggleClearAllConfirm(false);
  clearingAll = true;
  setStatus('Clearing all sessions...');
  updateSessionControls();
  vscode.postMessage<OutboundMessage>({type: 'dispose-all-sessions'});
});

clearAllConfirmCancel?.addEventListener('click', () => {
  confirmingClearAll = false;
  toggleClearAllConfirm(false);
});

sessionSelectEl?.addEventListener('change', () => {
  const nextSessionId = sessionSelectEl.value;
  if (!nextSessionId || nextSessionId === activeSessionId) {
    return;
  }
  switchActiveSession(
    nextSessionId,
    `Switched to ${getSessionLabel(nextSessionId)}`
  );
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
  vscode.postMessage<OutboundMessage>({
    type: 'theme-select',
    payload: {presetKey},
  });
});

vscode.postMessage<OutboundMessage>({type: 'webview-ready'});
if (activeSessionId) {
  setStatus(`Restoring session ${activeSessionId}...`);
  notifyResize();
} else {
  setStatus('Initializing session...');
}
updateSessionControls();

function requestNewSession() {
  if (pendingSessionRequest) {
    return;
  }
  pendingSessionRequest = true;
  updateAddButtonState(true);
  setStatus('Initializing a new session...');
  fitTerminal();
  vscode.postMessage<OutboundMessage>({
    type: 'request-new-session',
    payload: getTerminalDimensions(),
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
  setStatus(
    `Connected to ${getSessionLabel(sessionId)} (${
      shell ?? sessionMeta[sessionId]?.shell ?? 'Shell'
    })`
  );
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
  const {cols, rows} = getTerminalDimensions();
  vscode.postMessage<OutboundMessage>({
    type: 'terminal-resize',
    payload: {sessionId: activeSessionId, cols, rows},
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
    rows: terminal.rows || 24,
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
  if (clearAllButton) {
    clearAllButton.disabled =
      clearingAll || pendingSessionRequest || sessionIds.length === 0;
    if (clearAllButton.disabled && confirmingClearAll) {
      confirmingClearAll = false;
      toggleClearAllConfirm(false);
    }
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
  vscode.setState({
    activeSessionId,
    totalSessions,
    sessionIds,
    terminalHeight,
    sessionMeta,
  });
}

function getSessionLabel(sessionId: string, fallbackIndex?: number) {
  return (
    sessionMeta[sessionId]?.label ??
    (typeof fallbackIndex === 'number'
      ? `Terminal ${fallbackIndex + 1}`
      : sessionId)
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
    background: getComputedVar(
      '--terminal-bg',
      '--vscode-editor-background',
      '#1e1e1e'
    ),
    foreground: getComputedVar(
      '--terminal-fg',
      '--vscode-editor-foreground',
      '#cccccc'
    ),
    cursor: getComputedVar(
      '--terminal-cursor',
      '--vscode-terminalCursor-foreground',
      '#ffffff'
    ),
    selectionBackground: getComputedVar(
      '--terminal-selection',
      '--vscode-editor-selectionBackground',
      'rgba(255,255,255,0.15)'
    ),
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
  const active = availablePresets.find(
    (preset) => preset.key === currentThemeKey
  );
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
    themePreviewText.textContent = 'Preview';
    themePreviewSwatch.style.background = '';
  }
}

function toggleClearAllConfirm(visible: boolean) {
  if (!clearAllConfirm) {
    return;
  }
  clearAllConfirm.setAttribute('aria-hidden', visible ? 'false' : 'true');
}
