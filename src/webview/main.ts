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
  | { type: 'terminal-resize'; payload: { sessionId: string; cols: number; rows: number } };

type ViewState = {
  activeSessionId?: string;
  totalSessions: number;
};

const vscode = acquireVsCodeApi<ViewState>();

const statusEl = document.querySelector('[data-session-status]') as HTMLSpanElement | null;
const logEl = document.querySelector('[data-session-log]') as HTMLUListElement | null;
const buttonEl = document.querySelector('[data-action="new-session"]') as HTMLButtonElement | null;
const terminalRoot = document.getElementById('terminal-root') as HTMLDivElement | null;

const savedState = vscode.getState() ?? { totalSessions: 0 };
let activeSessionId = savedState.activeSessionId;
let totalSessions = savedState.totalSessions ?? 0;
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
      persistState();
      setStatus(`登録済みセッション: ${totalSessions} 件`);
      break;
    case 'session-created':
      pendingSessionRequest = false;
      setButtonBusy(false);
      activateSession(message.payload.id, message.payload.shell);
      appendLog(
        `${message.payload.shell} の新しいセッション (${message.payload.id}) を開始しました`
      );
      break;
    case 'session-data':
      if (!activeSessionId) {
        activeSessionId = message.payload.sessionId;
        persistState();
      }
      if (message.payload.sessionId === activeSessionId) {
        terminal.write(message.payload.data);
      }
      break;
    case 'session-exited':
      appendLog(
        `${message.payload.sessionId} が終了しました (code: ${
          message.payload.code ?? '―'
        }, signal: ${message.payload.signal ?? '―'})`
      );
      if (message.payload.sessionId === activeSessionId) {
        activeSessionId = undefined;
        persistState();
        setStatus('セッションが終了しました');
      }
      break;
    case 'session-error':
      pendingSessionRequest = false;
      setButtonBusy(false);
      setStatus(`エラー: ${message.payload.message}`);
      appendLog(`エラー: ${message.payload.message}`);
      break;
    default:
      break;
  }
});

buttonEl?.addEventListener('click', () => {
  requestNewSession();
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

function requestNewSession() {
  if (pendingSessionRequest) {
    return;
  }
  pendingSessionRequest = true;
  setButtonBusy(true);
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

function setButtonBusy(isBusy: boolean) {
  if (!buttonEl) {
    return;
  }
  buttonEl.disabled = isBusy;
  buttonEl.textContent = isBusy ? '接続中…' : '新しいセッション';
}

function persistState() {
  vscode.setState({ activeSessionId, totalSessions });
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
