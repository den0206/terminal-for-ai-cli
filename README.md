# Terminal for AI CLI

Terminal for AI CLI is a VS Code / Cursor extension that anchors a multi-session terminal inside the secondary sidebar. It is powered by `xterm.js`, communicates with a lightweight `SessionManager` (Node.js + Python bridge), and keeps UI state in the Webview so you can switch shells without context switching to another window.

> 🇯🇵 Looking for the Japanese documentation? Check [`README_JP.md`](README_JP.md). This file and the Japanese version are intentionally kept in sync.

---

## Features

- Multiple shells in one Webview: add, remove, and switch sessions from the dropdown.
- In-memory scrollback persistence per session (restored when the Webview reloads).
- Automatic naming (`Terminal 1`, `Terminal 2`, …) that reuses freed numbers.
- Theme presets (Modern, Basic, Homebrew, etc.) with live preview and VS Code color integration.
- Adjustable terminal height with a drag handle; the setting is persisted across reloads.
- “Clear all sessions” section with an inline confirmation flow to terminate every running shell safely.
- Configurable default shell, startup commands, and theme preset via VS Code settings.
- Pure TypeScript codebase (`src/extension.ts`, `src/webview/main.ts`, `src/terminal/sessionManager.ts`) with esbuild + `tsc` outputs committed to `media/` and `dist/`.

---

## Usage

1. **Install dependencies**
   ```bash
   npm install
   ```
2. **Compile / bundle**
   ```bash
   npm run compile
   ```
3. **Launch in Extension Development Host**
   - Press `F5` inside VS Code or Cursor.
   - In the Extension Development Host, open the “Terminal For AI CLI” view (Activity Bar).
   - A first terminal session is created automatically; additional sessions can be added with `+`.
4. **Operate the UI**
   - **Dropdown**: select any existing session.
   - **`+` / 🗑**: add or close the active session.
   - **Clear all sessions**: open the confirmation panel below the Theme section to terminate every shell.
   - **Theme selector**: pick any preset; the palette updates instantly.
   - **Resize handle**: drag to change the terminal height (value is saved).

---

## Configuration (VS Code settings)

| Setting | Key | Description |
| --- | --- | --- |
| Default shell | `aiTerminal.defaultShell` | Absolute path to the shell executable. Empty string falls back to the user’s login shell. |
| Startup commands | `aiTerminal.startupCommands` | Array of commands sent (in order) right after a session starts. |
| Theme preset | `aiTerminal.themePreset` | One of `modern`, `basic`, `clearDark`, `clearLight`, `grass`, `homebrew`, `manPage`, `ocean`, `pro`. The same presets are available in the Webview. |

---

## Known Issues / Limitations

| Item | Description |
| --- | --- |
| Windows PTY fallback | Windows uses a simple `spawn` fallback instead of the Python PTY bridge, so full-screen applications and cursor control may be unstable. |
| Resize propagation | The Python bridge proxies resize events via JSON/SIGWINCH; some environments may see a short delay. |
| Session restoration | Webview reloads restore buffered output, but a full IDE restart still kills OS processes. A persistent session registry is on the roadmap. |
| Theme customization | Only built-in presets are supported today; user-defined palettes are a future task. |
| Logging | The old event log was removed. Consider using the VS Code Output channel for future troubleshooting. |

---

## Roadmap

1. **Windows pseudo console integration** (ConPTY/winpty) for reliable rendering.
2. **Persistent session recovery** even after restarting VS Code.
3. **Custom theme JSON** support in `settings.json`.
4. **Command palette / snippet presets** to inject frequently used commands.
5. **Improved telemetry/logging** via Output channels and notifications.

---

## Development Notes

- `npm run bundle:webview` – bundles `src/webview/main.ts` (IIFE) to `media/webview.js`.
- `npm run compile` – runs the bundle script and `tsc -p ./` to emit `dist/extension.js`.
- `npm run watch` – TypeScript watch mode for iterative work.
- Dependencies: `@xterm/xterm`, `@xterm/addon-fit`, `esbuild`, `typescript`, VS Code `@types`, and Python 3 (Unix PTY bridge).
- Outputs: extension host bundle (`dist/extension.js`), Webview bundle (`media/webview.js`, `media/webview.js.map`, `media/xterm.css`).

### Architecture Overview

| Area | File(s) | Responsibility |
| --- | --- | --- |
| Extension entry | `src/extension.ts` | Registers commands and the Webview view provider. |
| View provider | `src/view/aiTerminalViewProvider.ts` | Routes messages, manages sessions, and feeds theme data to the Webview. |
| Webview template | `src/view/htmlTemplate.ts` | Generates the HTML/CSS shell for the Webview UI. |
| Theming | `src/theming/themePresets.ts` | Defines palette presets, previews, and validation helpers. |
| Session management | `src/terminal/sessionManager.ts` | Spawns shells, proxies PTY data via Python bridge or OS fallback. |

---

## Localization

- English: `README.md` (this file)
- Japanese: [`README_JP.md`](README_JP.md)

Both files describe the same features, usage steps, and roadmap so contributors can reference their preferred language.
