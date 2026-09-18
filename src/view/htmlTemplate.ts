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
            --qn-border-subtle: color-mix(in srgb, var(--vscode-foreground) 14%, transparent);
            --qn-border: color-mix(in srgb, var(--vscode-foreground) 22%, transparent);
            --qn-border-strong: color-mix(in srgb, var(--vscode-foreground) 30%, transparent);
            --qn-muted: color-mix(in srgb, var(--vscode-foreground) 55%, transparent);
            --qn-faint: color-mix(in srgb, var(--vscode-foreground) 40%, transparent);
            --qn-surface: color-mix(in srgb, var(--vscode-editor-background) 55%, var(--vscode-sideBar-background));
            --qn-surface-alt: color-mix(in srgb, var(--vscode-editor-background) 80%, var(--vscode-sideBar-background));
            --qn-hover: color-mix(in srgb, var(--vscode-foreground) 9%, transparent);
            --qn-accent-primary: #7fd4a1;
            --qn-accent-secondary: #7fb0ff;
            --qn-danger: var(--vscode-errorForeground, #f48771);
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
            color: var(--vscode-foreground);
            background: var(--vscode-sideBar-background);
            display: flex;
            flex-direction: column;
            gap: 8px;
          }
          .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 8px;
            min-width: 0;
          }
          .brand {
            display: flex;
            align-items: center;
            gap: 8px;
            min-width: 0;
          }
          .brand__mark {
            width: 22px;
            height: 22px;
            flex: 0 0 auto;
            border-radius: 5px;
            box-shadow: inset 0 0 0 1px var(--qn-border);
            background:
              linear-gradient(
                180deg,
                color-mix(in srgb, var(--vscode-editor-background) 70%, transparent),
                color-mix(in srgb, var(--vscode-sideBar-background) 90%, transparent)
              );
            display: inline-flex;
            align-items: center;
            justify-content: center;
            color: var(--qn-accent-primary);
            font-family: var(--vscode-editor-font-family, ui-monospace, Menlo, monospace);
            font-size: 11px;
            font-weight: 700;
            letter-spacing: -0.5px;
          }
          .brand__title {
            font-weight: 600;
            font-size: 13px;
            letter-spacing: 0.1px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .status-pill {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            padding: 2px 8px 2px 7px;
            border-radius: 999px;
            border: 1px solid var(--qn-border-subtle);
            background: color-mix(in srgb, var(--vscode-editor-background) 40%, transparent);
            font-size: 11px;
            color: var(--qn-muted);
            max-width: 60%;
            min-width: 0;
          }
          .status-pill__dot {
            width: 5px;
            height: 5px;
            border-radius: 999px;
            background: var(--qn-faint);
            flex: 0 0 auto;
          }
          .status-pill__text {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .session-pill {
            display: flex;
            align-items: center;
            gap: 4px;
            height: 30px;
            padding: 2px;
            border: 1px solid var(--qn-border);
            border-radius: 8px;
            background: var(--qn-surface);
          }
          .session-pill__switcher {
            display: flex;
            align-items: center;
            gap: 6px;
            flex: 1 1 auto;
            min-width: 0;
            height: 24px;
            padding: 0 4px 0 8px;
            border-radius: 6px;
            position: relative;
          }
          .session-pill__prefix {
            flex: 0 0 auto;
            color: var(--qn-accent-primary);
          }
          .session-pill__caret {
            flex: 0 0 auto;
            color: var(--qn-muted);
            pointer-events: none;
          }
          select[data-session-select] {
            flex: 1 1 auto;
            min-width: 0;
            height: 22px;
            padding: 0;
            border: 0;
            background: transparent;
            color: var(--vscode-foreground);
            font-family: inherit;
            font-size: 12.5px;
            appearance: none;
            -webkit-appearance: none;
            -moz-appearance: none;
            cursor: pointer;
            outline: none;
          }
          select[data-session-select]:disabled {
            color: var(--qn-muted);
            cursor: default;
          }
          .session-pill__actions {
            display: flex;
            align-items: center;
            gap: 2px;
            padding: 0 2px 0 4px;
            margin-left: 2px;
            border-left: 1px solid var(--qn-border-subtle);
          }
          .icon-button {
            width: 26px;
            height: 26px;
            border-radius: 5px;
            border: 1px solid transparent;
            background: transparent;
            color: var(--vscode-foreground);
            display: inline-flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            padding: 0;
          }
          .icon-button:hover:enabled {
            background: var(--qn-hover);
          }
          .icon-button:focus-visible {
            outline: 1px solid var(--vscode-focusBorder);
            outline-offset: 1px;
          }
          .icon-button:disabled {
            opacity: 0.4;
            cursor: default;
          }
          .icon-button[aria-pressed='true'] {
            background: color-mix(in srgb, var(--vscode-focusBorder, #007acc) 24%, transparent);
            color: color-mix(in srgb, var(--vscode-focusBorder, #007acc) 90%, var(--vscode-foreground));
          }
          .icon-button--danger {
            color: var(--qn-danger);
          }
          .icon-button--danger:hover:enabled {
            background: color-mix(in srgb, var(--qn-danger) 15%, transparent);
          }
          .link-popover {
            display: none;
            position: fixed;
            z-index: 20;
            flex-direction: column;
            gap: 6px;
            max-width: min(320px, calc(100vw - 16px));
            padding: 8px;
            border-radius: 8px;
            border: 1px solid var(--qn-border-strong);
            background: var(--vscode-editorWidget-background, var(--terminal-bg));
            color: var(--vscode-editorWidget-foreground, var(--vscode-foreground));
            box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);
          }
          .link-popover[aria-hidden='false'] {
            display: flex;
          }
          .link-popover__url {
            font-size: 0.72rem;
            opacity: 0.85;
            word-break: break-all;
          }
          .link-popover__actions {
            display: flex;
            gap: 6px;
          }
          .link-popover__actions button {
            flex: 1 1 auto;
            padding: 4px 8px;
            border-radius: 4px;
            border: 1px solid var(--vscode-button-border, transparent);
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            font-size: 12px;
            white-space: nowrap;
            cursor: pointer;
          }
          .search-bar {
            display: none;
            flex: 0 0 auto;
            align-items: center;
            gap: 4px;
            padding: 4px 6px;
            border: 1px solid var(--qn-border);
            border-radius: 6px;
            background: var(--qn-surface-alt);
          }
          .search-bar[aria-hidden='false'] {
            display: flex;
          }
          .search-bar__scope {
            flex: 0 0 auto;
            padding: 1px 6px;
            border-radius: 999px;
            border: 1px solid var(--qn-border);
            font-size: 10px;
            color: var(--qn-muted);
            white-space: nowrap;
          }
          .search-bar input {
            flex: 1 1 auto;
            min-width: 3rem;
            height: 20px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border, var(--qn-border));
            border-radius: 4px;
            padding: 2px 6px;
            font-size: 12px;
          }
          .search-bar__summary {
            flex: 0 0 auto;
            font-size: 10.5px;
            color: var(--qn-muted);
            white-space: nowrap;
            font-variant-numeric: tabular-nums;
          }
          .search-bar__toggle {
            flex: 0 0 auto;
            min-width: 22px;
            height: 20px;
            padding: 0 4px;
            border-radius: 4px;
            border: 1px solid var(--qn-border);
            background: transparent;
            color: var(--vscode-foreground);
            font-size: 10.5px;
            cursor: pointer;
          }
          .search-bar__toggle[aria-pressed='true'] {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border-color: transparent;
          }
          .search-bar .search-bar__icon-btn {
            width: 22px;
            height: 20px;
            border: 0;
            border-radius: 4px;
            background: transparent;
            color: var(--vscode-foreground);
            display: inline-flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            padding: 0;
          }
          .search-bar .search-bar__icon-btn:hover:enabled {
            background: var(--qn-hover);
          }
          .terminal-shell {
            flex: 1 1 auto;
            display: flex;
            flex-direction: column;
            min-height: var(--terminal-height, 320px);
            gap: 6px;
            overflow: hidden;
          }
          .terminal-stack {
            flex: 1 1 auto;
            display: flex;
            flex-direction: column;
            gap: 4px;
            min-height: 0;
          }
          [data-terminal-pane='primary'] {
            --pane-accent: var(--qn-accent-primary);
          }
          [data-terminal-pane='secondary'] {
            --pane-accent: var(--qn-accent-secondary);
          }
          .terminal-pane {
            flex: 1 1 0%;
            display: none;
            flex-direction: column;
            border-radius: 8px;
            border: 1px solid var(--qn-border);
            background: var(--terminal-bg);
            overflow: hidden;
            min-height: 0;
          }
          .terminal-pane[data-active='true'] {
            box-shadow: inset 3px 0 0 -1px var(--pane-accent);
          }
          .terminal-pane[data-pane-visible='true'] {
            display: flex;
          }
          .terminal-pane__label {
            padding: 8px 10px;
            border-bottom: 1px solid var(--qn-border-subtle);
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            color: var(--terminal-fg);
          }
          .terminal-pane__label-name {
            display: flex;
            align-items: center;
            gap: 6px;
            min-width: 0;
            font-size: 12px;
            font-weight: 500;
            /* 非フォーカス時は少しトーンを落とす */
            opacity: 0.85;
          }
          .terminal-pane[data-active='true'] .terminal-pane__label-name {
            opacity: 1;
          }
          .terminal-pane__dot {
            width: 6px;
            height: 6px;
            border-radius: 999px;
            background: var(--pane-accent);
            flex: 0 0 auto;
          }
          .terminal-pane__label span[data-pane-label] {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .terminal-pane__attach {
            flex: 0 0 auto;
            width: 24px;
            height: 24px;
            border: 0;
            border-radius: 4px;
            padding: 0;
            background: transparent;
            color: inherit;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            line-height: 1;
          }
          .terminal-pane__attach:hover:enabled {
            background: color-mix(in srgb, var(--terminal-fg) 15%, transparent);
          }
          .terminal-pane__attach:focus-visible {
            outline: 1px solid var(--vscode-focusBorder);
            outline-offset: 1px;
          }
          .terminal-pane__attach:disabled {
            opacity: 0.4;
            cursor: default;
          }
          .terminal-root {
            flex: 1 1 auto;
            padding: 6px 10px;
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
          }
          .split-resizer::after {
            content: '';
            width: 60px;
            height: 2px;
            border-radius: 999px;
            background: var(--qn-border-strong);
          }
          .terminal-resizer {
            flex: 0 0 auto;
            height: 10px;
            cursor: row-resize;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .terminal-resizer::after {
            content: '';
            width: 3px;
            height: 3px;
            border-radius: 999px;
            background: var(--qn-border-strong);
            box-shadow:
              6px 0 0 0 var(--qn-border-strong),
              12px 0 0 0 var(--qn-border-strong),
              -6px 0 0 0 var(--qn-border-strong),
              -12px 0 0 0 var(--qn-border-strong);
          }
          .footer {
            flex: 0 0 auto;
            display: flex;
            align-items: center;
            gap: 6px;
            border-top: 1px solid var(--qn-border-subtle);
            padding-top: 8px;
          }
          .theme-preview {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            flex: 0 0 auto;
          }
          .theme-preview__swatch {
            width: 20px;
            height: 12px;
            border-radius: 999px;
            box-shadow: inset 0 0 0 1px var(--qn-border-strong);
          }
          .theme-picker__scope {
            font-size: 11px;
            color: var(--qn-muted);
            white-space: nowrap;
          }
          select[data-theme-select] {
            flex: 1 1 auto;
            min-width: 5rem;
            height: 24px;
            background: transparent;
            color: var(--vscode-foreground);
            border: 1px solid var(--qn-border);
            border-radius: 4px;
            padding: 0 6px;
            font-size: 12px;
          }
          .footer__usage {
            flex: 0 0 auto;
            font-size: 10.5px;
            color: var(--qn-muted);
            font-variant-numeric: tabular-nums;
            white-space: nowrap;
          }
          .clear-all__confirm {
            display: none;
            flex-direction: column;
            gap: 8px;
            border: 1px solid color-mix(in srgb, var(--qn-danger) 35%, transparent);
            border-radius: 8px;
            padding: 10px 12px;
            background: color-mix(in srgb, var(--qn-danger) 6%, transparent);
            box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
          }
          .clear-all__confirm[aria-hidden='false'] {
            display: flex;
          }
          .clear-all__confirm-message {
            font-size: 12.5px;
            font-weight: 600;
            color: var(--vscode-foreground);
          }
          .clear-all__confirm-actions {
            display: flex;
            gap: 8px;
            justify-content: flex-end;
          }
          .clear-all__confirm button {
            height: 26px;
            padding: 0 12px;
            border-radius: 4px;
            border: 1px solid var(--qn-border-strong);
            background: transparent;
            color: var(--vscode-foreground);
            font-size: 12px;
            cursor: pointer;
          }
          .clear-all__confirm button[data-clear-all-confirm-accept] {
            background: var(--qn-danger);
            color: color-mix(in srgb, var(--vscode-editor-background) 80%, black);
            border-color: var(--qn-danger);
            font-weight: 600;
          }
          .clear-all__confirm button:disabled {
            opacity: 0.6;
            cursor: default;
          }
        </style>
      </head>
      <body data-renderer-type="${escapeAttribute(rendererType)}">
        <header class="header">
          <div class="brand">
            <span class="brand__mark" aria-hidden="true">&gt;_</span>
            <strong class="brand__title">Terminal For AI CLI</strong>
          </div>
          <span class="status-pill" role="status">
            <span class="status-pill__dot" aria-hidden="true"></span>
            <span class="status-pill__text" data-session-status>Initializing...</span>
          </span>
        </header>
        <div class="session-pill" aria-label="Session controls">
          <div class="session-pill__switcher">
            <svg class="session-pill__prefix" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3,4 6,8 3,12"/><line x1="8" y1="12" x2="13" y2="12"/></svg>
            <select data-session-select aria-label="Active session"></select>
            <svg class="session-pill__caret" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="4,6 8,10 12,6"/></svg>
          </div>
          <div class="session-pill__actions">
            <button class="icon-button" data-session-add type="button" title="New session" aria-label="New session"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><line x1="8" y1="3" x2="8" y2="13"/><line x1="3" y1="8" x2="13" y2="8"/></svg></button>
            <button
              class="icon-button"
              data-view-toggle
              title="Toggle split view"
              aria-pressed="false"
              aria-label="Toggle split view"
              type="button"
            >
              <span class="view-toggle-icon" data-view-toggle-icon aria-hidden="true">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4">
                  <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
                </svg>
              </span>
            </button>
            <button class="icon-button" data-session-remove type="button" title="Close session" aria-label="Close session"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3,4 5,4 13,4"/><path d="M5 4 v9 a1 1 0 0 0 1 1 h4 a1 1 0 0 0 1 -1 v-9"/><line x1="7" y1="6.5" x2="7" y2="11.5"/><line x1="9" y1="6.5" x2="9" y2="11.5"/></svg></button>
          </div>
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
            <button class="search-bar__icon-btn" data-search-prev type="button" title="Previous match" aria-label="Previous match"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="4,10 8,6 12,10"/></svg></button>
            <button class="search-bar__icon-btn" data-search-next type="button" title="Next match" aria-label="Next match"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="4,6 8,10 12,6"/></svg></button>
            <button class="search-bar__icon-btn" data-search-close type="button" title="Close (Esc)" aria-label="Close find"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg></button>
          </div>
          <div class="terminal-stack" data-terminal-stack>
            <div
              class="terminal-pane"
              data-terminal-pane="primary"
              data-pane-visible="false"
            >
              <div class="terminal-pane__label">
                <div class="terminal-pane__label-name">
                  <span class="terminal-pane__dot" aria-hidden="true"></span>
                  <span data-pane-label="primary">Terminal</span>
                </div>
                <button
                  class="terminal-pane__attach"
                  data-file-select="primary"
                  type="button"
                  title="${escapeAttribute(vscode.l10n.t('Attach image or video'))}"
                  aria-label="${escapeAttribute(vscode.l10n.t('Attach image or video'))}"
                  disabled
                ><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.5 4.5 L6 9 a2 2 0 0 0 2.8 2.8 L13 7.5 a3.5 3.5 0 0 0 -5 -5 L3.5 7 a5 5 0 0 0 7 7 L14 10.5"/></svg></button>
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
                <div class="terminal-pane__label-name">
                  <span class="terminal-pane__dot" aria-hidden="true"></span>
                  <span data-pane-label="secondary">Terminal</span>
                </div>
                <button
                  class="terminal-pane__attach"
                  data-file-select="secondary"
                  type="button"
                  title="${escapeAttribute(vscode.l10n.t('Attach image or video'))}"
                  aria-label="${escapeAttribute(vscode.l10n.t('Attach image or video'))}"
                  disabled
                ><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.5 4.5 L6 9 a2 2 0 0 0 2.8 2.8 L13 7.5 a3.5 3.5 0 0 0 -5 -5 L3.5 7 a5 5 0 0 0 7 7 L14 10.5"/></svg></button>
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
            <span class="theme-picker__scope" data-theme-scope>T1</span>
          </span>
          <select data-theme-select aria-label="Terminal theme"></select>
          <span
            class="footer__usage"
            data-usage
            title="${escapeAttribute(
              vscode.l10n.t(
                'Total size this extension keeps on disk (saved images and stored scrollback) / resident memory of the whole extension host process (RSS), which is shared with every other extension. Turn it off with aiTerminal.showResourceStats.'
              )
            )}"
          ></span>
          <button
            class="icon-button icon-button--danger"
            data-session-clear-all
            type="button"
            title="Closes every running shell in this view."
            aria-label="Clear all sessions"
          ><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3,4 5,4 13,4"/><path d="M5 4 v9 a1 1 0 0 0 1 1 h4 a1 1 0 0 0 1 -1 v-9"/></svg></button>
        </footer>
        <div
          class="link-popover"
          data-link-popover
          role="dialog"
          aria-label="Link actions"
          aria-hidden="true"
        >
          <span class="link-popover__url" data-link-popover-url></span>
          <div class="link-popover__actions">
            <button data-link-popover-open type="button">Open in browser</button>
            <button data-link-popover-copy type="button">Copy URL</button>
          </div>
        </div>
        <div class="clear-all__confirm" data-clear-all-confirm aria-hidden="true">
          <span class="clear-all__confirm-message">
            Are you sure you want to close every session?
          </span>
          <div class="clear-all__confirm-actions">
            <button data-clear-all-confirm-cancel type="button">Cancel</button>
            <button data-clear-all-confirm-accept type="button">Yes, close all</button>
          </div>
        </div>
        <script nonce="${nonce}" src="${scriptUri}"></script>
      </body>
    </html>`;
}
