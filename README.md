# Terminal for AI CLI

[![CI](https://github.com/den0206/terminal-for-ai-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/den0206/terminal-for-ai-cli/actions/workflows/ci.yml)
[![PR Check](https://github.com/den0206/terminal-for-ai-cli/actions/workflows/pr-check.yml/badge.svg)](https://github.com/den0206/terminal-for-ai-cli/actions/workflows/pr-check.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Terminal for AI CLI is a VS Code / Cursor extension that anchors a multi-session terminal inside the secondary sidebar. It is powered by `xterm.js`, communicates with a lightweight `SessionManager` (Node.js + Python bridge), and keeps UI state in the Webview so you can switch shells without context switching to another window.

> 🇯🇵 Looking for the Japanese documentation? Check [`README_JP.md`](README_JP.md). This file and the Japanese version are intentionally kept in sync.

---

## Features

- Multiple shells in one Webview: add, remove, and switch sessions from the dropdown.
- In-memory scrollback persistence per session (restored when the Webview reloads).
- Automatic naming (`Terminal 1`, `Terminal 2`, …) that reuses freed numbers.
- Theme presets (Modern, Basic, Homebrew, etc.) with live preview and VS Code color integration.
- Adjustable terminal height with a drag handle; the setting is persisted across reloads.
- "Clear all sessions" section with an inline confirmation flow to terminate every running shell safely.
- Configurable default shell, startup commands, and theme preset via VS Code settings.
- **Security hardened**: Input validation for shell paths and commands, cryptographically secure random generation, image file size limits (10MB).
- **Type-safe**: Strict TypeScript with discriminated unions for message handling (zero `any` types).
- **Tested**: Comprehensive test suite with Vitest (33+ tests covering utilities, validation, and logging).
- **Robust logging**: Centralized logging system using VS Code Output Channel for better debugging and troubleshooting.
- **Resource management**: Automatic cleanup of session buffers, message queue limits, and orphaned images to prevent memory leaks and storage bloat.
- **Image cleanup**: Automatic cleanup of orphaned images on extension startup, plus manual cleanup command available from the command palette.
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

## Commands

| Command | Description |
| --- | --- |
| `Terminal For AI CLI: フォーカス` | Focus and reveal the terminal view. |
| `Terminal For AI CLI: 新しいセッション` | Create a new terminal session. |
| `Terminal For AI CLI: 画像をクリーンアップ` | Manually delete all saved images from global storage. Shows confirmation dialog before deletion. |

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

---

## Roadmap

1. **Windows pseudo console integration** (ConPTY/winpty) for reliable rendering.
2. **Persistent session recovery** even after restarting VS Code.
3. **Custom theme JSON** support in `settings.json`.
4. **Command palette / snippet presets** to inject frequently used commands.

---

## Security

Terminal For AI CLI implements multiple security measures to protect against common vulnerabilities:

### Input Validation
- **Shell path validation**: Verifies that shell paths are absolute, exist, and are executable before spawning processes.
- **Startup command sanitization**: Filters and validates startup commands, with warnings for potentially dangerous patterns.
- **Working directory validation**: Ensures working directories are valid and exist before use.
- **Image file validation**: Validates image file size (10MB limit), base64 data integrity, and filename sanitization to prevent path traversal attacks.

### Cryptographic Security
- **Secure random generation**: Uses Node.js `crypto` module for generating session IDs and CSP nonces instead of `Math.random()`.
- **Content Security Policy**: Implements strict CSP with nonce-based script execution to prevent XSS attacks.

### Type Safety
- **Zero `any` types**: All message handlers use strict TypeScript discriminated unions for type-safe message routing.
- **Strict compilation**: TypeScript strict mode enabled with comprehensive type checking.

### Testing
- **Automated tests**: 33+ unit tests covering validation logic, random generation, security features, and logging.
- **Continuous validation**: ESLint enforces code quality and catches potential issues at development time.

### Logging & Debugging
- **Centralized logging**: VS Code Output Channel integration for structured logging with timestamps and log levels.
- **Error tracking**: Comprehensive error handling with detailed logging for troubleshooting.
- **Resource monitoring**: Automatic cleanup of session buffers and message queues to prevent memory issues.

---

## Development Notes

- `npm run bundle:webview` – bundles `src/webview/main.ts` (IIFE) to `media/webview.js`.
- `npm run compile` – runs the bundle script and `tsc -p ./` to emit `dist/extension.js`.
- `npm run watch` – TypeScript watch mode for iterative work.
- `npm run lint` – runs ESLint on the source code.
- `npm test` – runs the test suite with Vitest.
- `npm run test:watch` – runs tests in watch mode.
- `npm run test:coverage` – generates test coverage report.
- Dependencies: `@xterm/xterm`, `@xterm/addon-fit`, `esbuild`, `typescript`, `vitest`, VS Code `@types`, and Python 3 (Unix PTY bridge).
- Outputs: extension host bundle (`dist/extension.js`), Webview bundle (`media/webview.js`, `media/webview.js.map`, `media/xterm.css`).

### Extension Icons

The extension uses two icon files:

- **Extension icon** (`package.json` → `icon`): `media/icon.png` (128x128 PNG recommended, supports transparency)
  - Displayed in VS Code marketplace and extension view
  - Should be a square PNG image with optional transparency

- **Activity bar icon** (`package.json` → `contributes.viewsContainers.activitybar[].icon`): `media/icon-bit.png`
  - Displayed in the VS Code activity bar
  - Can be PNG or SVG format
  - Also used in the Webview UI (`src/view/aiTerminalViewProvider.ts`)

**Note**: For best results, use PNG format with transparency (alpha channel) for both icons. The extension icon should be 128x128 pixels for optimal display in the VS Code marketplace.

### CI/CD

The project uses GitHub Actions for continuous integration:

- **CI Workflow** (`.github/workflows/ci.yml`): Runs on push to `feature/**`, `fix/**`, `main`, and `develop` branches
  - Lint check with ESLint
  - TypeScript compilation
  - Test execution with Vitest
  - Test coverage report generation
  - Multi-version Node.js testing (18.x, 20.x)

- **PR Check Workflow** (`.github/workflows/pr-check.yml`): Runs on all pull requests
  - Full validation suite (lint, type-check, tests)
  - Coverage report as PR comment
  - Bundle size check with warnings
  - Security audit with npm audit
  - Secret scanning with TruffleHog

All checks must pass before merging pull requests.

### Architecture Overview

| Area | File(s) | Responsibility |
| --- | --- | --- |
| Extension entry | `src/extension.ts` | Registers commands and the Webview view provider. |
| View provider | `src/view/aiTerminalViewProvider.ts` | Routes messages, manages sessions, and feeds theme data to the Webview. |
| Webview template | `src/view/htmlTemplate.ts` | Generates the HTML/CSS shell for the Webview UI. |
| Theming | `src/theming/themePresets.ts` | Defines palette presets, previews, and validation helpers. |
| Session management | `src/terminal/sessionManager.ts` | Spawns shells, proxies PTY data via Python bridge or OS fallback. |
| Security & validation | `src/utils/validation.ts` | Validates shell paths, startup commands, and working directories. |
| Logging | `src/utils/logger.ts` | Centralized logging system using VS Code Output Channel. |
| Utilities | `src/utils/nonce.ts` | Generates cryptographically secure nonces for CSP. |

---

## Localization

- English: `README.md` (this file)
- Japanese: [`README_JP.md`](README_JP.md)

Both files describe the same features, usage steps, and roadmap so contributors can reference their preferred language.
