import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';

interface VSCodeApi<State = unknown> {
  postMessage(message: unknown): void;
  setState(state: State): void;
  getState(): State | undefined;
}

declare const acquireVsCodeApi: <State = undefined>() => VSCodeApi<State>;

type InboundMessage =
  | { type: 'session-count'; payload: { total: number } }
  | { type: 'session-created'; payload: { id: string; shell: string; pid?: number } }
  | { type: 'session-data'; payload: { sessionId: string; data: string } }
  | { type: 'session-exited'; payload: { sessionId: string; code: number | null; signal: string | null } }
  | { type: 'session-error'; payload: { message: string } };

type OutboundMessage =
  | { type: 'webview-ready' }
  | { type: 'request-new-session'; payload?: { cols: number; rows: number } }
  | { type: 'terminal-input'; payload: { sessionId: string; data: string } }
  | { type: 'terminal-resize'; payload: { sessionId: string; cols: number; rows: number } }
  | { type: 'dispose-session'; payload: { sessionId: string } };

type ViewState = {
  activeSessionId?: string;
  totalSessions: number;
  sessionIds: string[];
};

const vscode = acquireVsCodeApi<ViewState>();

const statusEl = document.querySelector('[data-session-status]') as HTMLSpanElement | null;
const logEl = document.querySelector('[data-session-log]') as HTMLUListElement | null;
const newSessionButton = document.querySelector('[data-action="new-session"]') as HTMLButtonElement | null;
const disposeSessionButton = document.querySelector('[data-action="dispose-session"]') as HTMLButtonElement | null;
const terminalRoot = document.getElementById('terminal-root') as HTMLDivElement | null;

const savedState = vscode.getState() ?? { totalSessions: 0, sessionIds: [] };
let activeSessionId = savedState.activeSessionId;
let totalSessions = savedState.totalSessions ?? 0;
let sessionIds = Array.isArray(savedState.sessionIds) ? [...savedState.sessionIds] : [];
let pendingSessionRequest = false;

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
      setNewSessionButtonBusy(false);
      sessionIds = sessionIds.filter((id) => id !== message.payload.id);
      sessionIds.push(message.payload.id);
      persistState();
      activateSession(message.payload.id, message.payload.shell);
      appendLog(
        `${message.payload.shell} の新しいセッション (${message.payload.id}) を開始しました`
      );
      break;
    case 'session-data':
      if (!activeSessionId) {
        activeSessionId = message.payload.sessionId;
        persistState();
        updateDisposeButtonState();
      }
      if (message.payload.sessionId === activeSessionId) {
        terminal.write(message.payload.data);
      }
      break;
    case 'session-exited':
      sessionIds = sessionIds.filter((id) => id !== message.payload.sessionId);
      persistState();
      appendLog(
        `${message.payload.sessionId} が終了しました (code: ${
          message.payload.code ?? '―'
        }, signal: ${message.payload.signal ?? '―'})`
      );
      if (message.payload.sessionId === activeSessionId) {
        const fallbackId = sessionIds[sessionIds.length - 1];
        if (fallbackId) {
          switchActiveSession(fallbackId, `セッション ${fallbackId} に切り替えました`);
        } else {
          activeSessionId = undefined;
          persistState();
          terminal.reset();
          setStatus('セッションが終了しました');
          updateDisposeButtonState();
        }
      }
      break;
    case 'session-error':
      pendingSessionRequest = false;
      setNewSessionButtonBusy(false);
      setStatus(`エラー: ${message.payload.message}`);
      appendLog(`エラー: ${message.payload.message}`);
      break;
    default:
      break;
  }
});

newSessionButton?.addEventListener('click', () => {
  requestNewSession();
});

disposeSessionButton?.addEventListener('click', () => {
  if (!activeSessionId || pendingSessionRequest) {
    return;
  }
  setStatus('セッションを終了しています…');
  updateDisposeButtonState();
  vscode.postMessage<OutboundMessage>({
    type: 'dispose-session',
    payload: { sessionId: activeSessionId }
  });
});
window.addEventListener(
  'resize',
  debounce(() => {
    fitTerminal();
    notifyResize();
  }, 150)
);

vscode.postMessage<OutboundMessage>({ type: 'webview-ready' });
if (!activeSessionId) {
  requestNewSession();
} else {
  setStatus(`セッション ${activeSessionId} を復元中…`);
  notifyResize();
}
updateDisposeButtonState();

function requestNewSession() {
  if (pendingSessionRequest) {
    return;
  }
  pendingSessionRequest = true;
  setNewSessionButtonBusy(true);
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
  fitTerminal();
  notifyResize();
  terminal.focus();
  setStatus(`${shell ?? 'シェル'} セッション ${sessionId} に接続しました`);
  updateDisposeButtonState();
}

function switchActiveSession(sessionId: string, message: string) {
  activeSessionId = sessionId;
  persistState();
  terminal.reset();
  fitTerminal();
  notifyResize();
  terminal.focus();
  setStatus(message);
  appendLog(message);
  updateDisposeButtonState();
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

function appendLog(text: string) {
  if (!logEl) {
    return;
  }
  const li = document.createElement('li');
  li.textContent = text;
  logEl.prepend(li);
  while (logEl.children.length > 7) {
    logEl.removeChild(logEl.lastElementChild!);
  }
}

function setNewSessionButtonBusy(isBusy: boolean) {
  if (!newSessionButton) {
    return;
  }
  newSessionButton.disabled = isBusy;
  newSessionButton.textContent = isBusy ? '接続中…' : '新しいセッション';
  updateDisposeButtonState();
}

function updateDisposeButtonState() {
  if (!disposeSessionButton) {
    return;
  }
  disposeSessionButton.disabled = !activeSessionId || pendingSessionRequest;
}

function persistState() {
  vscode.setState({ activeSessionId, totalSessions, sessionIds });
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
