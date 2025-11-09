"use strict";
(() => {
  // src/webview/main.ts
  var vscode = acquireVsCodeApi();
  var statusEl = document.querySelector("[data-session-status]");
  var logEl = document.querySelector("[data-session-log]");
  var buttonEl = document.querySelector('[data-action="new-session"]');
  var initialState = vscode.getState() ?? { sessions: 0 };
  renderState(initialState);
  buttonEl?.addEventListener("click", () => {
    setStatus("\u65B0\u3057\u3044\u30BB\u30C3\u30B7\u30E7\u30F3\u3092\u8981\u6C42\u3057\u3066\u3044\u307E\u3059\u2026");
    vscode.postMessage({ type: "request-new-session" });
  });
  window.addEventListener("message", (event) => {
    const message = event.data;
    if (!message) {
      return;
    }
    if (message.type === "new-session") {
      const sessions = (vscode.getState()?.sessions ?? 0) + 1;
      const nextState = { sessions };
      vscode.setState(nextState);
      renderState(nextState);
      const timestamp = new Date(message.payload?.timestamp ?? Date.now()).toLocaleTimeString();
      appendLog(`Session #${sessions} \u3092\u521D\u671F\u5316 (${timestamp})`);
      setStatus("\u5F85\u6A5F\u4E2D");
    }
  });
  function renderState(state) {
    setStatus(`\u767B\u9332\u6E08\u307F\u30BB\u30C3\u30B7\u30E7\u30F3: ${state.sessions} \u4EF6`);
  }
  function setStatus(text) {
    if (statusEl) {
      statusEl.textContent = text;
    }
  }
  function appendLog(text) {
    if (!logEl) {
      return;
    }
    const li = document.createElement("li");
    li.textContent = text;
    logEl.prepend(li);
    while (logEl.children.length > 5) {
      logEl.removeChild(logEl.lastElementChild);
    }
  }
})();
//# sourceMappingURL=webview.js.map
