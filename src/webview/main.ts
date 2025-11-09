interface VSCodeApi<State = unknown> {
  postMessage(message: unknown): void;
  setState(state: State): void;
  getState(): State | undefined;
}

declare const acquireVsCodeApi: <State = undefined>() => VSCodeApi<State>;

type InboundMessage = { type: 'new-session'; payload?: { timestamp: number } };
type OutboundMessage = { type: 'request-new-session' };

type ViewState = {
  sessions: number;
};

const vscode = acquireVsCodeApi<ViewState>();

const statusEl = document.querySelector('[data-session-status]') as HTMLSpanElement;
const logEl = document.querySelector('[data-session-log]') as HTMLUListElement;
const buttonEl = document.querySelector('[data-action="new-session"]') as HTMLButtonElement;

const initialState = vscode.getState() ?? { sessions: 0 };
renderState(initialState);

buttonEl?.addEventListener('click', () => {
  setStatus('新しいセッションを要求しています…');
  vscode.postMessage<OutboundMessage>({ type: 'request-new-session' });
});

window.addEventListener('message', (event: MessageEvent<InboundMessage>) => {
  const message = event.data;
  if (!message) {
    return;
  }

  if (message.type === 'new-session') {
    const sessions = (vscode.getState()?.sessions ?? 0) + 1;
    const nextState: ViewState = { sessions };
    vscode.setState(nextState);
    renderState(nextState);

    const timestamp = new Date(message.payload?.timestamp ?? Date.now()).toLocaleTimeString();
    appendLog(`Session #${sessions} を初期化 (${timestamp})`);
    setStatus('待機中');
  }
});

function renderState(state: ViewState) {
  setStatus(`登録済みセッション: ${state.sessions} 件`);
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
  while (logEl.children.length > 5) {
    logEl.removeChild(logEl.lastElementChild!);
  }
}
