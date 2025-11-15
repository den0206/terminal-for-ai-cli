import * as vscode from 'vscode';
import {
  ThemePalette,
  ThemePresetKey,
  ThemePreview,
} from '../theming/themePresets';

export type ThemeOption = {
  key: ThemePresetKey;
  label: string;
  description: string;
  preview: ThemePreview;
};

export type ThemeSnapshot = {
  presetKey: ThemePresetKey;
  palette: ThemePalette;
  presets: ThemeOption[];
};

type HtmlTemplateParams = {
  webview: vscode.Webview;
  nonce: string;
  theme: ThemeSnapshot;
  iconUri: vscode.Uri;
  scriptUri: vscode.Uri;
  xtermCssUri: vscode.Uri;
};

export function buildWebviewHtml({
  webview,
  nonce,
  theme,
  iconUri,
  scriptUri,
  xtermCssUri,
}: HtmlTemplateParams) {
  return /* html */ `<!DOCTYPE html>
    <html lang="ja">
      <head>
        <meta charset="UTF-8" />
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Terminal For AI CLI</title>
        <link rel="stylesheet" href="${xtermCssUri}" />
        <style>
          :root {
            color-scheme: light dark;
            --terminal-bg: ${theme.palette.background};
            --terminal-fg: ${theme.palette.foreground};
          }
          html,
          body {
            height: 100%;
          }
          body {
            padding: 12px;
            margin: 0;
            box-sizing: border-box;
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--terminal-fg);
            background: var(--vscode-sideBar-background);
            display: flex;
            flex-direction: column;
            gap: 0.75rem;
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
          .terminal-shell {
            flex: 0 0 auto;
            display: flex;
            flex-direction: column;
            min-height: 240px;
            height: var(--terminal-height, 640px);
          }
          #terminal-root {
            flex: 1 1 auto;
            border-radius: 6px;
            border: 1px solid color-mix(in srgb, var(--terminal-fg) 30%, transparent);
            background: var(--terminal-bg);
            padding: 0.25rem;
            overflow: hidden;
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
          .theme-picker {
            display: flex;
            flex-direction: column;
            gap: 0.25rem;
          }
          .theme-picker__control {
            display: flex;
            align-items: center;
            gap: 0.5rem;
          }
          select[data-theme-select] {
            flex: 0 0 220px;
            background: var(--vscode-dropdown-background);
            color: var(--vscode-dropdown-foreground);
            border: 1px solid var(--vscode-dropdown-border, transparent);
            border-radius: 4px;
            padding: 0.2rem 0.5rem;
            font-size: 0.85rem;
          }
          .theme-preview {
            display: inline-flex;
            align-items: center;
            gap: 0.4rem;
            padding: 0.35rem 0.5rem;
            border-radius: 4px;
            border: 1px solid color-mix(in srgb, var(--terminal-fg) 25%, transparent);
            background: color-mix(in srgb, var(--terminal-bg) 70%, transparent);
            font-size: 0.75rem;
            width: fit-content;
          }
          .theme-preview__swatch {
            width: 32px;
            height: 16px;
            border-radius: 999px;
            box-shadow: inset 0 0 0 1px rgba(0,0,0,0.3);
          }
          section {
            flex: 0 0 auto;
          }
          .clear-all {
            border-top: 1px solid color-mix(in srgb, var(--terminal-fg) 20%, transparent);
            padding-top: 0.75rem;
            margin-top: 0.25rem;
            display: flex;
            flex-direction: column;
            gap: 0.4rem;
          }
          .danger-button {
            align-self: flex-start;
            background: transparent;
            color: var(--vscode-errorForeground, #f48771);
            border: 1px solid var(--vscode-errorForeground, #f48771);
            border-radius: 4px;
            padding: 0.4rem 0.8rem;
            font-size: 0.85rem;
            cursor: pointer;
            transition: background 0.15s ease, color 0.15s ease, opacity 0.15s ease;
          }
          .danger-button:hover:enabled {
            background: color-mix(in srgb, var(--vscode-errorForeground, #f48771) 15%, transparent);
            color: var(--vscode-errorForeground, #f48771);
          }
          .danger-button:disabled {
            opacity: 0.5;
            cursor: default;
          }
          .clear-all__confirm {
            display: none;
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
      <body>
        <header class="header">
          <div style="display:flex;align-items:center;gap:0.5rem;">
            <img src="${iconUri}" alt="Terminal For AI CLI" width="20" height="20" />
            <strong>Terminal For AI CLI</strong>
          </div>
          <span data-session-status>Initializing...</span>
        </header>
        <div class="controls" aria-label="Session controls">
          <select data-session-select></select>
          <button class="icon-button" data-session-add title="New session">+</button>
          <button class="icon-button" data-session-remove title="Close session">🗑</button>
        </div>
        <div class="terminal-shell" data-terminal-shell>
          <div id="terminal-root" aria-label="Terminal"></div>
          <div class="terminal-resizer" data-terminal-resizer aria-label="Adjust height"></div>
        </div>
        <section class="theme-picker" aria-label="Theme selector">
          <label style="font-size:0.85rem;display:flex;flex-direction:column;gap:0.35rem;">
            Theme
            <div class="theme-picker__control">
              <select data-theme-select></select>
              <span data-theme-active-label style="font-size:0.75rem;opacity:0.8;">―</span>
            </div>
          </label>
          <div class="theme-preview" data-theme-preview>
            <span class="theme-preview__swatch" data-theme-swatch></span>
            <span data-theme-preview-text>Preview</span>
          </div>
        </section>
        <section class="clear-all" aria-label="Danger zone">
          <button class="danger-button" data-session-clear-all type="button">
            Clear all sessions
          </button>
          <p style="margin:0;font-size:0.75rem;opacity:0.8;">
            Closes every running shell in this view.
          </p>
          <div class="clear-all__confirm" data-clear-all-confirm aria-hidden="true">
            <span style="font-size:0.85rem;">
              Are you sure you want to close every session?
            </span>
            <div class="clear-all__confirm-actions">
              <button data-clear-all-confirm-accept type="button">Yes, close all</button>
              <button data-clear-all-confirm-cancel type="button">Cancel</button>
            </div>
          </div>
        </section>
        <script nonce="${nonce}" src="${scriptUri}"></script>
      </body>
    </html>`;
}
