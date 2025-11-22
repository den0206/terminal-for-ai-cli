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

type ViewMode = 'single' | 'split';
type Pane = 'primary' | 'secondary';

const MAX_SESSIONS = 2;
const MIN_SPLIT_RATIO = 0.2;
const MAX_SPLIT_RATIO = 0.8;
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

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
  | {type: 'session-limit-reached'; payload: {max: number}}
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
  | {type: 'theme-select'; payload: {presetKey: string}}
  | {
      type: 'image-drop';
      payload: {
        fileName: string;
        mimeType: string;
        data: string;
        sessionId: string;
      };
    };

type SessionMeta = {shell: string; label: string};

type ViewState = {
  activeSessionId?: string;
  totalSessions: number;
  sessionIds: string[];
  terminalHeight?: number;
  sessionMeta?: Record<string, SessionMeta>;
  viewMode?: ViewMode;
  splitRatio?: number;
};

const vscode = acquireVsCodeApi<ViewState>();

const statusEl = document.querySelector(
  '[data-session-status]'
) as HTMLSpanElement | null;
const addSessionButton = document.querySelector(
  '[data-session-add]'
) as HTMLButtonElement | null;
const viewToggleButton = document.querySelector(
  '[data-view-toggle]'
) as HTMLButtonElement | null;
const viewToggleIcon = document.querySelector(
  '[data-view-toggle-icon]'
) as HTMLSpanElement | null;
const removeSessionButton = document.querySelector(
  '[data-session-remove]'
) as HTMLButtonElement | null;
const terminalShell = document.querySelector(
  '[data-terminal-shell]'
) as HTMLDivElement | null;
const terminalStack = document.querySelector(
  '[data-terminal-stack]'
) as HTMLDivElement | null;
const paneElements: Record<Pane, HTMLDivElement | null> = {
  primary: document.querySelector(
    '[data-terminal-pane="primary"]'
  ) as HTMLDivElement | null,
  secondary: document.querySelector(
    '[data-terminal-pane="secondary"]'
  ) as HTMLDivElement | null,
};
const paneLabels: Record<Pane, HTMLSpanElement | null> = {
  primary: document.querySelector(
    '[data-pane-label="primary"]'
  ) as HTMLSpanElement | null,
  secondary: document.querySelector(
    '[data-pane-label="secondary"]'
  ) as HTMLSpanElement | null,
};
const paneRoots: Record<Pane, HTMLDivElement | null> = {
  primary: document.querySelector(
    '[data-terminal-root="primary"]'
  ) as HTMLDivElement | null,
  secondary: document.querySelector(
    '[data-terminal-root="secondary"]'
  ) as HTMLDivElement | null,
};
const splitResizer = document.querySelector(
  '[data-split-resizer]'
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
const MAX_BUFFER_COUNT = 10; // Maximum number of session buffers to keep

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
let viewMode: ViewMode = savedState.viewMode === 'split' ? 'split' : 'single';
let splitRatio = clampSplitRatio(
  typeof savedState.splitRatio === 'number' ? savedState.splitRatio : 0.5
);
const paneSessions: Record<Pane, string | undefined> = {
  primary: undefined,
  secondary: undefined,
};
sessionIds.forEach((id, index) => {
  sessionBuffers[id] = sessionBuffers[id] ?? '';
  sessionMeta[id] =
    sessionMeta[id] ??
    ({
      shell: 'Shell',
      label: `Terminal ${index + 1}`,
    } as SessionMeta);
});

function createTerminalInstance() {
  return new Terminal({
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
}

type PaneContext = {terminal: Terminal; fitAddon: FitAddon};

function createPaneContext(pane: Pane): PaneContext {
  const terminal = createTerminalInstance();
  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  const root = paneRoots[pane];
  if (root) {
    terminal.open(root);
  }
  terminal.onData((data) => {
    const sessionId = paneSessions[pane];
    if (sessionId) {
      vscode.postMessage<OutboundMessage>({
        type: 'terminal-input',
        payload: {sessionId, data},
      });
    }
  });
  root?.addEventListener('pointerdown', () => {
    handlePaneFocus(pane);
  });
  root?.addEventListener('focusin', () => {
    handlePaneFocus(pane);
  });
  return {terminal, fitAddon};
}

const paneContexts: Record<Pane, PaneContext> = {
  primary: createPaneContext('primary'),
  secondary: createPaneContext('secondary'),
};

applyTerminalHeight(terminalHeight, false);
refreshTerminalTheme();
syncPaneAssignments(true);
focusActivePane();

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
        activeSessionId = undefined;
        cleanupAllBuffers();
        syncPaneAssignments(true);
        setStatus('No sessions available');
      } else {
        setStatus(`Registered sessions: ${totalSessions}`);
        // Clean up buffers for sessions that no longer exist
        cleanupOldBuffers();
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
      deliverDataToPanes(message.payload.sessionId, message.payload.data);
      break;
    case 'session-exited':
      sessionIds = sessionIds.filter((id) => id !== message.payload.sessionId);
      delete sessionMeta[message.payload.sessionId];
      // Clean up buffer for exited session
      cleanupSessionBuffer(message.payload.sessionId);
      persistState();
      if (message.payload.sessionId === activeSessionId) {
        const fallbackId = sessionIds[sessionIds.length - 1];
        if (fallbackId) {
          switchActiveSession(fallbackId, `Switched to session ${fallbackId}`);
        } else {
          activeSessionId = undefined;
          setStatus('Session has ended');
        }
        persistState();
      }
      syncPaneAssignments(true);
      focusActivePane();
      fitVisibleTerminals();
      notifyResize();
      updateSessionControls();
      break;
    case 'session-error':
      pendingSessionRequest = false;
      updateAddButtonState(false);
      setStatus(`Error: ${message.payload.message}`);
      break;
    case 'session-limit-reached':
      pendingSessionRequest = false;
      updateAddButtonState(false);
      setStatus(`Maximum of ${message.payload.max} terminals are supported.`);
      updateSessionControls();
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
      // Clear all buffers
      cleanupAllBuffers();
      syncPaneAssignments(true);
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

viewToggleButton?.addEventListener('click', () => {
  if (viewToggleButton.disabled) {
    return;
  }
  if (viewMode === 'single' && sessionIds.length < 2) {
    setStatus('Add a second session to enable split view.');
    return;
  }
  setViewMode(viewMode === 'single' ? 'split' : 'single');
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
    fitVisibleTerminals();
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

splitResizer?.addEventListener('pointerdown', (event) => {
  if (!isSplitModeActive()) {
    return;
  }
  const stackRect = terminalStack?.getBoundingClientRect();
  if (!stackRect || stackRect.height <= 0) {
    return;
  }
  event.preventDefault();
  const pointerId = event.pointerId;
  const startY = event.clientY;
  const startRatio = splitRatio;

  const onMove = (moveEvent: PointerEvent) => {
    if (moveEvent.pointerId !== pointerId) {
      return;
    }
    const delta = moveEvent.clientY - startY;
    const deltaRatio = delta / stackRect.height;
    setSplitRatio(startRatio + deltaRatio, false);
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
  if (sessionIds.length >= MAX_SESSIONS) {
    setStatus(`Maximum of ${MAX_SESSIONS} sessions reached.`);
    updateAddButtonState(false);
    return;
  }
  pendingSessionRequest = true;
  updateAddButtonState(true);
  setStatus('Initializing a new session...');
  fitVisibleTerminals();
  vscode.postMessage<OutboundMessage>({
    type: 'request-new-session',
    payload: getPaneDimensions('primary'),
  });
}

function activateSession(sessionId: string, shell?: string) {
  activeSessionId = sessionId;
  persistState();
  syncPaneAssignments();
  focusActivePane();
  fitVisibleTerminals();
  notifyResize();
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
  syncPaneAssignments();
  focusActivePane();
  fitVisibleTerminals();
  notifyResize();
  setStatus(message);
  updateSessionControls();
}

function notifyResize() {
  const primarySession = paneSessions.primary;
  const secondarySession = paneSessions.secondary;
  if (!primarySession && !secondarySession) {
    return;
  }
  if (primarySession) {
    const {cols, rows} = getPaneDimensions('primary');
    vscode.postMessage<OutboundMessage>({
      type: 'terminal-resize',
      payload: {sessionId: primarySession, cols, rows},
    });
  }
  if (secondarySession) {
    const {cols, rows} = getPaneDimensions('secondary');
    vscode.postMessage<OutboundMessage>({
      type: 'terminal-resize',
      payload: {sessionId: secondarySession, cols, rows},
    });
  }
}

function fitVisibleTerminals() {
  (['primary', 'secondary'] as const).forEach((pane) => {
    const context = paneContexts[pane];
    const isVisible =
      pane === 'primary'
        ? Boolean(paneSessions.primary)
        : paneElements[pane]?.getAttribute('data-pane-visible') === 'true';
    if (isVisible) {
      context.fitAddon.fit();
    }
  });
}

function getPaneDimensions(pane: Pane) {
  const context = paneContexts[pane];
  return {
    cols: context.terminal.cols || 80,
    rows: context.terminal.rows || 24,
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
  const atLimit = sessionIds.length >= MAX_SESSIONS;
  addSessionButton.disabled = isBusy || atLimit;
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
  if (viewToggleButton) {
    viewToggleButton.disabled = sessionIds.length < 2 || pendingSessionRequest;
  }
  renderSessionSelect();
  updateViewToggleButton();
}

function setViewMode(mode: ViewMode) {
  if (mode === 'split' && sessionIds.length < 2) {
    setStatus('Two sessions are required for split view.');
    return;
  }
  if (viewMode === mode) {
    return;
  }
  viewMode = mode;
  persistState();
  syncPaneAssignments(true);
  focusActivePane();
  fitVisibleTerminals();
  notifyResize();
  updateViewToggleButton();
}

function isSplitModeActive() {
  return (
    viewMode === 'split' &&
    Boolean(paneSessions.primary && paneSessions.secondary)
  );
}

function setSplitRatio(value: number, persistNow = true) {
  const clamped = clampSplitRatio(value);
  if (Math.abs(clamped - splitRatio) < 0.001) {
    return;
  }
  splitRatio = clamped;
  if (persistNow) {
    persistState();
  }
  applySplitSizing();
  fitVisibleTerminals();
  notifyResize();
}

function clampSplitRatio(value: number) {
  if (!Number.isFinite(value)) {
    return 0.5;
  }
  return Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, value));
}

function updateViewToggleButton() {
  if (!viewToggleButton) {
    return;
  }
  const splitEnabled = viewMode === 'split' && sessionIds.length >= 2;
  viewToggleButton.setAttribute(
    'aria-pressed',
    splitEnabled ? 'true' : 'false'
  );
  if (viewToggleIcon) {
    viewToggleIcon.textContent = splitEnabled ? '▦' : '▢';
  }
  if (viewToggleButton.disabled) {
    viewToggleButton.title = 'Add a second session to enable split view';
  } else {
    viewToggleButton.title = splitEnabled
      ? 'Show a single terminal'
      : 'Show split view';
  }
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

function applySplitSizing() {
  const splitActive = isSplitModeActive();
  if (paneElements.primary) {
    paneElements.primary.style.flex = splitActive
      ? `${splitRatio} 1 0%`
      : '1 1 auto';
  }
  if (paneElements.secondary) {
    const secondaryRatio = Math.max(0.01, 1 - splitRatio);
    paneElements.secondary.style.flex = splitActive
      ? `${secondaryRatio} 1 0%`
      : '0 0 auto';
  }
  if (splitResizer) {
    splitResizer.style.display = splitActive ? 'flex' : 'none';
  }
}

function persistState() {
  vscode.setState({
    activeSessionId,
    totalSessions,
    sessionIds,
    terminalHeight,
    sessionMeta,
    viewMode,
    splitRatio,
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

  // Clean up old buffers if we have too many
  cleanupOldBuffers();
}

function cleanupSessionBuffer(sessionId: string) {
  delete sessionBuffers[sessionId];
}

function cleanupAllBuffers() {
  for (const key of Object.keys(sessionBuffers)) {
    delete sessionBuffers[key];
  }
}

function cleanupOldBuffers() {
  const bufferKeys = Object.keys(sessionBuffers);
  if (bufferKeys.length <= MAX_BUFFER_COUNT) {
    return;
  }

  // Sort by session ID (oldest first, assuming session IDs are sequential)
  // Or we could track last access time, but for simplicity, remove oldest entries
  const keysToRemove = bufferKeys
    .filter((key) => !sessionIds.includes(key))
    .slice(0, bufferKeys.length - MAX_BUFFER_COUNT);

  for (const key of keysToRemove) {
    delete sessionBuffers[key];
  }
}

function writeBufferToTerminal(sessionId: string, target: Terminal) {
  const buffer = sessionBuffers[sessionId];
  if (buffer) {
    target.write(buffer);
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
  fitVisibleTerminals();
  notifyResize();
  if (persist) {
    persistState();
  }
}

function refreshTerminalTheme() {
  const theme = {
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
  (['primary', 'secondary'] as const).forEach((pane) => {
    paneContexts[pane].terminal.options.theme = {...theme};
  });
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

function syncPaneAssignments(force = false) {
  const activeChanged = ensureActiveSession();
  if (activeChanged) {
    persistState();
  }
  const primarySession = getDesiredPaneSession('primary');
  const secondarySession = getDesiredPaneSession('secondary');
  assignPane('primary', primarySession, force);
  assignPane('secondary', secondarySession, force);
  updatePaneActiveStates();
  if (terminalStack) {
    const splitActive = viewMode === 'split' && Boolean(secondarySession);
    terminalStack.setAttribute(
      'data-view-mode',
      splitActive ? 'split' : 'single'
    );
  }
  applySplitSizing();
}

function assignPane(pane: Pane, sessionId: string | undefined, force = false) {
  const current = paneSessions[pane];
  if (!force && current === sessionId) {
    updatePaneVisibility(pane, Boolean(sessionId));
    updatePaneLabel(pane, sessionId);
    return;
  }
  paneSessions[pane] = sessionId;
  const {terminal} = paneContexts[pane];
  terminal.reset();
  if (sessionId) {
    writeBufferToTerminal(sessionId, terminal);
    terminal.scrollToBottom();
    terminal.write('\u001b[?25h');
  }
  updatePaneVisibility(pane, Boolean(sessionId));
  updatePaneLabel(pane, sessionId);
}

function updatePaneVisibility(pane: Pane, visible: boolean) {
  const paneElement = paneElements[pane];
  if (paneElement) {
    paneElement.setAttribute('data-pane-visible', visible ? 'true' : 'false');
  }
}

function ensureActiveSession() {
  if (activeSessionId && sessionIds.includes(activeSessionId)) {
    return false;
  }
  const fallbackId = sessionIds[sessionIds.length - 1];
  if (fallbackId) {
    activeSessionId = fallbackId;
  } else {
    activeSessionId = undefined;
  }
  return true;
}

function focusActivePane() {
  const pane = getPaneForSession(activeSessionId);
  if (!pane) {
    return;
  }
  paneContexts[pane].terminal.focus();
  updatePaneActiveStates();
}

function handlePaneFocus(pane: Pane) {
  const sessionId = paneSessions[pane];
  if (!sessionId || activeSessionId === sessionId) {
    updatePaneActiveStates();
    return;
  }
  activeSessionId = sessionId;
  persistState();
  updateSessionControls();
  updatePaneActiveStates();
  paneContexts[pane].terminal.focus();
  setStatus(`Focused ${getSessionLabel(sessionId)}`);
}

function updatePaneLabel(pane: Pane, sessionId?: string) {
  const label = paneLabels[pane];
  if (!label) {
    return;
  }
  label.textContent = sessionId ? getSessionLabel(sessionId) : 'No session';
}

function updatePaneActiveStates() {
  (['primary', 'secondary'] as const).forEach((pane) => {
    const paneElement = paneElements[pane];
    if (!paneElement) {
      return;
    }
    const isActive = paneSessions[pane] === activeSessionId;
    paneElement.setAttribute('data-active', isActive ? 'true' : 'false');
  });
}

function getPaneForSession(sessionId?: string) {
  if (!sessionId) {
    return undefined;
  }
  return (['primary', 'secondary'] as const).find(
    (pane) => paneSessions[pane] === sessionId
  );
}

function getDesiredPaneSession(pane: Pane) {
  if (viewMode === 'split' && sessionIds.length >= 2) {
    return pane === 'primary' ? sessionIds[0] : sessionIds[1];
  }
  if (pane === 'primary') {
    return activeSessionId ?? sessionIds[sessionIds.length - 1];
  }
  return undefined;
}

function deliverDataToPanes(sessionId: string, chunk: string) {
  (['primary', 'secondary'] as const).forEach((pane) => {
    if (paneSessions[pane] === sessionId) {
      paneContexts[pane].terminal.write(chunk);
    }
  });
}

function toggleClearAllConfirm(visible: boolean) {
  if (!clearAllConfirm) {
    return;
  }
  clearAllConfirm.setAttribute('aria-hidden', visible ? 'false' : 'true');
}

function setupImageDragAndDrop() {
  const handleDragOver = (event: DragEvent) => {
    if (!event.shiftKey) {
      return;
    }

    if (!event.dataTransfer) {
      return;
    }

    const hasFiles = event.dataTransfer.types.includes('Files');
    if (!hasFiles) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
  };

  const handleDrop = async (event: DragEvent) => {
    if (!event.shiftKey) {
      return;
    }

    if (!event.dataTransfer?.files.length) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const files = Array.from(event.dataTransfer.files);
    const imageFiles = files.filter((file) => file.type.startsWith('image/'));

    if (imageFiles.length === 0) {
      return;
    }

    const sessionId = activeSessionId;
    if (!sessionId) {
      return;
    }

    for (const file of imageFiles) {
      try {
        // Check file size before processing
        if (file.size > MAX_IMAGE_SIZE_BYTES) {
          const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
          const maxMB = (MAX_IMAGE_SIZE_BYTES / (1024 * 1024)).toFixed(0);
          console.warn(
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

        vscode.postMessage<OutboundMessage>({
          type: 'image-drop',
          payload: {
            fileName: file.name,
            mimeType: file.type,
            data: base64,
            sessionId,
          },
        });
      } catch (error) {
        // Log error in webview console (Logger is not available in webview context)
        console.error(`Failed to process image file "${file.name}":`, error);
      }
    }
  };

  document.addEventListener('dragover', handleDragOver);
  document.addEventListener('drop', handleDrop);
}

setupImageDragAndDrop();
