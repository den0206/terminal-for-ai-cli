import * as vscode from 'vscode';
import type {RendererType, ThemeSnapshot} from '../shared/types';

export type {ThemeSnapshot};

type HtmlTemplateParams = {
  webview: vscode.Webview;
  nonce: string;
  theme: ThemeSnapshot;
  iconUri: vscode.Uri;
  scriptUri: vscode.Uri;
  xtermCssUri: vscode.Uri;
  rendererType: RendererType;
};

/** Escapes a string for use inside a double-quoted HTML attribute. */
function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildWebviewHtml({
  webview,
  nonce,
  theme,
  iconUri,
  scriptUri,
  xtermCssUri,
  rendererType,
}: HtmlTemplateParams) {
  return /* html */ `<!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Terminal For AI CLI</title>
        <link rel="stylesheet" href="${xtermCssUri}" />
        <style>
          :root {
            color-scheme: light dark;
            /* ビュー全体の枠線・文字色は Terminal 1 のテーマを基準にする。
               各ペインは data-terminal-pane 要素側で個別に上書きされる。 */
            --terminal-bg: ${theme.slots[1].palette.background};
            --terminal-fg: ${theme.slots[1].palette.foreground};
          }
          html,
          body {
            height: 100%;
          }
          body {
            padding: 8px;
            margin: 0;
            box-sizing: border-box;
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--terminal-fg);
            background: var(--vscode-sideBar-background);
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
          }
          .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 0.5rem;
          }
          .controls {
            display: flex;
            align-items: center;
            gap: 0.5rem;
          }
          .controls select {
            flex: 1;
            background: var(--vscode-dropdown-background);
            color: var(--vscode-dropdown-foreground);
            border: 1px solid var(--vscode-dropdown-border, transparent);
            border-radius: 4px;
            padding: 0.2rem 0.4rem;
          }
          .controls .usage {
            flex: 0 0 auto;
            font-size: 0.7rem;
            opacity: 0.75;
            white-space: nowrap;
            font-variant-numeric: tabular-nums;
          }
          .icon-button {
            width: 28px;
            height: 28px;
            border-radius: 4px;
            border: 1px solid var(--vscode-button-border, transparent);
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            font-size: 1rem;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            padding: 0;
          }
          .icon-button:disabled {
            opacity: 0.6;
            cursor: default;
          }
          .search-bar {
            display: none;
            flex: 0 0 auto;
            align-items: center;
            gap: 0.3rem;
            padding: 0.3rem 0.4rem;
            border: 1px solid color-mix(in srgb, var(--terminal-fg) 25%, transparent);
            border-radius: 6px;
            background: color-mix(in srgb, var(--terminal-bg) 60%, transparent);
          }
          .search-bar[aria-hidden='false'] {
            display: flex;
          }
          .search-bar__scope {
            flex: 0 0 auto;
            padding: 0.05rem 0.4rem;
            border-radius: 999px;
            border: 1px solid color-mix(in srgb, var(--terminal-fg) 30%, transparent);
            font-size: 0.7rem;
            opacity: 0.85;
            white-space: nowrap;
          }
          .search-bar input {
            flex: 1 1 auto;
            min-width: 3rem;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border, transparent);
            border-radius: 4px;
            padding: 0.15rem 0.35rem;
            font-size: 0.8rem;
          }
          .search-bar__summary {
            flex: 0 0 auto;
            font-size: 0.7rem;
            opacity: 0.75;
            white-space: nowrap;
            font-variant-numeric: tabular-nums;
          }
          .search-bar__toggle {
            flex: 0 0 auto;
            min-width: 24px;
            height: 22px;
            padding: 0 0.25rem;
            border-radius: 4px;
            border: 1px solid color-mix(in srgb, var(--terminal-fg) 30%, transparent);
            background: transparent;
            color: var(--terminal-fg);
            font-size: 0.7rem;
            cursor: pointer;
          }
          .search-bar__toggle[aria-pressed='true'] {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border-color: var(--vscode-button-border, transparent);
          }
          .search-bar .icon-button {
            width: 22px;
            height: 22px;
            font-size: 0.8rem;
          }
          .terminal-shell {
            flex: 1 1 auto;
            display: flex;
            flex-direction: column;
            min-height: var(--terminal-height, 320px);
            gap: 0.5rem;
            overflow: hidden;
          }
          .terminal-stack {
            flex: 1 1 auto;
            display: flex;
            flex-direction: column;
            gap: 0.35rem;
            min-height: 0;
          }
          .terminal-pane {
            flex: 1 1 0%;
            display: none;
            flex-direction: column;
            border-radius: 6px;
            border: 1px solid color-mix(in srgb, var(--terminal-fg) 30%, transparent);
            background: var(--terminal-bg);
            overflow: hidden;
            min-height: 0;
          }
          .terminal-pane[data-active='true'] {
            border-color: var(--vscode-focusBorder, color-mix(in srgb, var(--terminal-fg) 45%, transparent));
            box-shadow: 0 0 0 1px color-mix(in srgb, var(--vscode-focusBorder, var(--terminal-fg)) 30%, transparent);
          }
          .terminal-pane[data-pane-visible='true'] {
            display: flex;
          }
          .terminal-pane__label {
            font-size: 0.75rem;
            opacity: 0.8;
            padding: 0.35rem 0.6rem;
            border-bottom: 1px solid color-mix(in srgb, var(--terminal-fg) 20%, transparent);
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 0.35rem;
          }
          .terminal-pane__label span {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .terminal-root {
            flex: 1 1 auto;
            padding: 0.25rem;
            overflow: hidden;
            min-height: 0;
            height: 100%;
          }
          .split-resizer {
            display: none;
            flex: 0 0 8px;
            cursor: row-resize;
            align-items: center;
            justify-content: center;
            color: color-mix(in srgb, var(--terminal-fg) 70%, transparent);
          }
          .split-resizer::after {
            content: '';
            width: 60px;
            height: 2px;
            border-radius: 999px;
            background: currentColor;
            opacity: 0.7;
          }
          .terminal-resizer {
            flex: 0 0 auto;
            height: 8px;
            cursor: row-resize;
            display: flex;
            align-items: center;
            justify-content: center;
            color: color-mix(in srgb, var(--terminal-fg) 70%, transparent);
          }
          .terminal-resizer::after {
            content: '';
            width: 60px;
            height: 2px;
            border-radius: 999px;
            background: currentColor;
            opacity: 0.6;
          }
          .footer {
            flex: 0 0 auto;
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 0.4rem;
            border-top: 1px solid color-mix(in srgb, var(--terminal-fg) 20%, transparent);
            padding-top: 0.5rem;
          }
          .theme-picker__scope {
            padding: 0.05rem 0.4rem;
            border-radius: 999px;
            border: 1px solid color-mix(in srgb, var(--terminal-fg) 30%, transparent);
            font-size: 0.7rem;
            opacity: 0.85;
            white-space: nowrap;
          }
          select[data-theme-select] {
            /* The other items in the footer never shrink, so without a floor
               the select collapses to nothing in a narrow sidebar. */
            flex: 1 1 auto;
            min-width: 5rem;
            background: var(--vscode-dropdown-background);
            color: var(--vscode-dropdown-foreground);
            border: 1px solid var(--vscode-dropdown-border, transparent);
            border-radius: 4px;
            padding: 0.2rem 0.4rem;
            font-size: 0.8rem;
          }
          .theme-preview {
            display: inline-flex;
            align-items: center;
            gap: 0.35rem;
            flex: 0 0 auto;
          }
          .theme-preview__swatch {
            width: 22px;
            height: 14px;
            border-radius: 999px;
            box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.3);
          }
          section {
            flex: 0 0 auto;
          }
          .danger-button {
            flex: 0 0 auto;
            background: transparent;
            color: var(--vscode-errorForeground, #f48771);
            border: 1px solid var(--vscode-errorForeground, #f48771);
            border-radius: 4px;
            padding: 0.2rem 0.5rem;
            font-size: 0.75rem;
            white-space: nowrap;
            cursor: pointer;
            transition: background 0.15s ease, opacity 0.15s ease;
          }
          .danger-button:hover:enabled {
            background: color-mix(in srgb, var(--vscode-errorForeground, #f48771) 15%, transparent);
          }
          .danger-button:disabled {
            opacity: 0.5;
            cursor: default;
          }
          .clear-all__confirm {
            display: none;
            margin-top: 0.4rem;
            flex-direction: column;
            gap: 0.35rem;
            border: 1px solid color-mix(in srgb, var(--terminal-fg) 25%, transparent);
            border-radius: 6px;
            padding: 0.5rem;
            background: color-mix(in srgb, var(--terminal-bg) 50%, transparent);
          }
          .clear-all__confirm[aria-hidden='false'] {
            display: flex;
          }
          .clear-all__confirm-actions {
            display: flex;
            gap: 0.5rem;
          }
          .clear-all__confirm button {
            padding: 0.35rem 0.7rem;
            border-radius: 4px;
            border: 1px solid var(--vscode-button-border, transparent);
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            cursor: pointer;
          }
          .clear-all__confirm button:disabled {
            opacity: 0.6;
            cursor: default;
          }
        </style>
      </head>
      <body data-renderer-type="${escapeAttribute(rendererType)}">
        <header class="header">
          <div style="display:flex;align-items:center;gap:0.5rem;">
            <img src="${iconUri}" alt="Terminal For AI CLI" width="20" height="20" />
            <strong>Terminal For AI CLI</strong>
          </div>
          <span data-session-status>Initializing...</span>
        </header>
        <div class="controls" aria-label="Session controls">
          <select data-session-select></select>
          <span
            class="usage"
            data-usage
            title="${escapeAttribute(
              vscode.l10n.t(
                'Total size of saved images / resident memory of the whole extension host process (RSS), which is shared with every other extension. Turn it off with aiTerminal.showResourceStats.'
              )
            )}"
          ></span>
          <button class="icon-button" data-session-add title="New session">+</button>
          <button
            class="icon-button"
            data-view-toggle
            title="Toggle split view"
            aria-pressed="false"
            type="button"
          >
            <span data-view-toggle-icon>▢</span>
          </button>
          <button class="icon-button" data-session-remove title="Close session">🗑</button>
        </div>
        <div class="terminal-shell" data-terminal-shell>
          <div class="search-bar" data-search-bar aria-hidden="true">
            <span class="search-bar__scope" data-search-scope>Terminal 1</span>
            <input
              type="text"
              data-search-input
              placeholder="Find in terminal"
              aria-label="Find in terminal"
              spellcheck="false"
            />
            <span class="search-bar__summary" data-search-summary></span>
            <button
              class="search-bar__toggle"
              data-search-case
              type="button"
              title="Match case"
              aria-pressed="false"
            >
              Aa
            </button>
            <button
              class="search-bar__toggle"
              data-search-regex
              type="button"
              title="Use regular expression"
              aria-pressed="false"
            >
              .*
            </button>
            <button class="icon-button" data-search-prev type="button" title="Previous match">↑</button>
            <button class="icon-button" data-search-next type="button" title="Next match">↓</button>
            <button class="icon-button" data-search-close type="button" title="Close (Esc)">✕</button>
          </div>
          <div class="terminal-stack" data-terminal-stack>
            <div
              class="terminal-pane"
              data-terminal-pane="primary"
              data-pane-visible="false"
            >
              <div class="terminal-pane__label">
                <span data-pane-label="primary">Terminal</span>
              </div>
              <div
                class="terminal-root"
                data-terminal-root="primary"
                aria-label="Primary terminal"
              ></div>
            </div>
            <div
              class="split-resizer"
              data-split-resizer
              aria-label="Resize split panes"
              role="separator"
              aria-orientation="vertical"
            ></div>
            <div
              class="terminal-pane"
              data-terminal-pane="secondary"
              data-pane-visible="false"
            >
              <div class="terminal-pane__label">
                <span data-pane-label="secondary">Terminal</span>
              </div>
              <div
                class="terminal-root"
                data-terminal-root="secondary"
                aria-label="Secondary terminal"
              ></div>
            </div>
          </div>
          <div class="terminal-resizer" data-terminal-resizer aria-label="Adjust height"></div>
        </div>
        <footer class="footer">
          <span
            class="theme-preview"
            title="Applies to the focused terminal. Each terminal keeps its own theme."
          >
            <span class="theme-preview__swatch" data-theme-swatch></span>
            <span class="theme-picker__scope" data-theme-scope>Terminal 1</span>
          </span>
          <select data-theme-select aria-label="Terminal theme"></select>
          <button
            class="danger-button"
            data-session-clear-all
            type="button"
            title="Closes every running shell in this view."
          >
            Clear all
          </button>
        </footer>
        <div class="clear-all__confirm" data-clear-all-confirm aria-hidden="true">
          <span style="font-size:0.85rem;">
            Are you sure you want to close every session?
          </span>
          <div class="clear-all__confirm-actions">
            <button data-clear-all-confirm-accept type="button">Yes, close all</button>
            <button data-clear-all-confirm-cancel type="button">Cancel</button>
          </div>
        </div>
        <script nonce="${nonce}" src="${scriptUri}"></script>
      </body>
    </html>`;
}
