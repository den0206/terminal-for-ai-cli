# Change Log

All notable changes to the "Terminal For AI CLI" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## How this file is updated

This file is the source of truth for release notes — there is no second copy to keep in sync.
On release, `scripts/release-changelog.mjs` cuts `[Unreleased]` into a version heading, and
`scripts/gen-release-notes.sh` lifts that section into the body of the GitHub Release. Both run
inside the `Export VSIX` workflow, and the cut happens **before the VSIX is built**: the Changelog
tab on the extension page renders the `CHANGELOG.md` packaged in the VSIX, so a later fix on `main`
would leave the published page reading `Unreleased` forever.

Release note body, in priority order:

1. `docs/release-notes/X.Y.Z.md` — a hand-written override, when one release needs its own framing
2. **This file** — the `[X.Y.Z]` section, or `[Unreleased]` when the cut has not happened yet
3. `feat:` / `fix:` commit subjects since the previous tag — the fallback when the section is empty
   (also forced with `--from-commits`)

Rules:

- **Write in English.** These entries ship inside the VSIX and appear on the extension's Changelog
  tab, and they become the GitHub Release body.
- **Add to `[Unreleased]`.** The release job promotes it to `## [X.Y.Z] - YYYY-MM-DD` and leaves a
  fresh empty `[Unreleased]` behind, so nothing has to be renamed by hand.
- **Only the six Keep a Changelog headings** — Added / Changed / Deprecated / Removed / Fixed /
  Security. No custom sections like `Improved` or `Documentation`.
- **Describe the change the user sees.** Test counts, coverage numbers, and quality scores belong in
  the pull request, not here.
- **Commit with Conventional Commits anyway.** The fallback path reads `feat:` / `fix:` subjects, and
  `docs:` / `chore:` / `ci:` / `test:` are dropped as noise.

## [Unreleased]

### Added

- The scrollback of each terminal now survives an editor restart. A snapshot is written to this
  window's storage while the terminal is idle and replayed on the next launch, framed by rules that
  mark it as read-only history — the shell behind it is gone, and a new one starts underneath.
  Snapshots are per terminal number, deleted by "Clear all sessions" and swept after 24 hours, and can
  be turned off with `aiTerminal.restoreScrollback`.

- A plain click on a terminal link now opens a popover offering **Open in browser** and **Copy URL**,
  instead of doing nothing. Copying helps with CLI sign-in flows, where the printed URL often has to
  go into a browser that is already signed in. `Cmd` / `Ctrl` + click still opens the link directly,
  and dragging across a link still selects text.

- Find in the terminal scrollback. `Cmd` / `Ctrl` + `F` opens a find bar for the focused terminal
  with a match count, next/previous navigation, and case-sensitive and regular-expression toggles.
  `Ctrl` + `F` is claimed by the find bar before it can reach the shell as a forward-character key.

- GPU rendering for the terminal. When WebGL is available, box-drawing and block characters are
  drawn by the terminal itself instead of the font, so borders in AI CLI TUIs connect cleanly, and
  heavy output costs less CPU. `aiTerminal.rendererType` (`auto` / `webgl` / `dom`) controls it.
  The renderer falls back to the DOM renderer on its own when the GPU is unavailable or the WebGL
  context is lost, so nothing has to be configured for it to keep working.

### Changed

- The toolbar resource readout now covers everything this extension keeps on disk — saved images
  plus the stored scrollback — instead of images only.

- Sessions now report the host app in `TERM_PROGRAM` (`vscode`, `cursor`, `windsurf`) instead of
  `terminal-for-ai-cli`. TERM_PROGRAM is a de-facto registry of known terminal emulators that CLIs
  branch on, so a name none of them knows put every one on its "unknown terminal" path - Claude Code,
  for one, reported that Shift+Enter was unavailable and refused to run `/terminal-setup`. Programs
  that want to detect this view specifically can read the new `TERMINAL_FOR_AI_CLI=1`.

### Fixed

- Typing Japanese (or any other IME-composed text) into an AI CLI prompt no longer occasionally
  appends a stale, half-finished copy of what was already typed. Shift+Enter stopped xterm.js just
  before it empties the hidden textarea an IME composition is read back out of, so across a
  multi-line prompt that buffer grew until the composition handler re-sent old text. Shift+Enter now
  clears it, and an Enter the IME is still consuming is left to xterm.js so the composed characters
  are flushed before the newline.

## [0.2.1] - 2026-08-29

### Added

- Shift+Enter now inserts a newline in the prompt of AI CLIs such as Claude Code and Codex, instead
  of submitting it.
- The window title reported by the shell (OSC 0/1/2) is shown next to the session name on the pane
  header.

### Changed

- Option now acts as Meta on macOS, so word-wise shortcuts such as Option+B / Option+F reach the
  shell. Option no longer composes accented characters in the terminal.
- Sessions start with `COLORTERM=truecolor` and `TERM_PROGRAM=terminal-for-ai-cli`, so programs can
  use 24-bit color and detect which terminal they are running in.

## [0.2.0] - 2026-08-23

### Security

- **Workspace Trust support**: `aiTerminal.defaultShell` and `aiTerminal.startupCommands` are now
  `machine` scope and listed under `capabilities.untrustedWorkspaces.restrictedConfigurations`.
  Previously a repository could override them from its own `.vscode/settings.json` and get arbitrary
  commands executed through the session that is created automatically when the view opens.
- **Dropped images are stored per window**: storage moved from `globalStorage` to `storageUri`
  (workspace storage). Every window runs its own extension host, so a shared directory meant one
  window's startup cleanup — and its `deactivate` — deleted images another window was still using.
  Global storage is now only a fallback for when no folder is open.
- **Correct shell quoting on Windows**: replacing `"` with `""` was never a valid escape. A path
  containing `%` or `!` (which `cmd.exe` expands even inside double quotes) or `"` (which has no
  portable escape) is now rejected instead of being quoted in a way that would still expand.
- **Removed the fake screening in `validateStartupCommands`**: matching a handful of shapes like
  `rm -rf /` only logged a warning and let the command through, so it blocked nothing while implying
  a guarantee it could not make. Now that the setting is `machine` scope, only empty entries are
  dropped.
- **Pinned a GitHub Action**: `trufflesecurity/trufflehog@main` is pinned to the v3.97.0 commit.
- **Trimmed what ships in the VSIX**: `.cursor/**` (internal review notes were being packaged) and
  `.env` / `.env.*` are now excluded.

### Added

- **Per-terminal themes**: Terminal 1 and Terminal 2 each carry their own preset. The in-view
  dropdown applies to whichever terminal has focus (shown by the badge next to the "Theme" label) and
  writes to `aiTerminal.themePreset` (Terminal 1) or `aiTerminal.themePresetSecondary` (Terminal 2).
  Leaving the second one empty makes it follow Terminal 1. In split view each pane renders in its own
  colors, borders included.
- **Open links from the terminal**: Cmd (macOS) / Ctrl + click opens plain URLs and OSC 8 hyperlinks
  in your default browser. Terminal output is untrusted, so only `http` / `https` is accepted, and the
  confirmation dialog shows the normalized URL that will actually open. Set
  `aiTerminal.confirmOpenLink` to `false` to skip the confirmation.
- **Setup walkthrough**: Help → Welcome now covers moving the view to the Secondary Side Bar and
  starting your first session.
- **Resource readout setting**: `aiTerminal.showResourceStats` (default `true`). Turning it off hides
  the readout and stops the 30-second polling behind it.

### Changed

- **Localization**: command titles and setting descriptions moved to `package.nls*.json`, runtime
  messages to `l10n/bundle.l10n.*.json` via `vscode.l10n.t`. English is the source language and
  Japanese ships alongside it.
- **The output buffer is now a chunk ring**: the per-session buffer in the webview changed from one
  string to an array of chunks. Past the cap (2M characters) every incoming chunk used to re-slice the
  whole window; chunks are now dropped from the front instead. The cap itself is unchanged.
- **Queued `session-data` is merged instead of dropped**: when the queue filled up before the webview
  was ready, the oldest message was discarded and terminal output went missing silently. Consecutive
  chunks for the same session are now appended to the queued entry.
- **The resource readout caches its directory scan**: the images directory is only re-measured after
  an image is saved or deleted, so a steady state costs no I/O. The tooltip and the setting
  description now state that RSS covers the whole extension host process, which is shared with every
  other extension.
- **`debounce` / `throttle`**: switched from `window.setTimeout` to `setTimeout` so the module works —
  and can be tested — outside a browser context.

## [0.1.0] - 2026-08-15

Covers 0.0.3 through 0.1.0 (0.0.3 and 0.0.4 were never tagged; 0.0.5 shipped the same day).

### Added

- **Publishing to Open VSX**: pushing a `release/Ver_X.Y.Z` branch runs the `Export VSIX` workflow end
  to end — build the all-platform VSIX, sync the version into `package.json`, and publish a GitHub
  Release tagged `Ver_X.Y.Z` with the VSIX attached. A colliding tag gets a `+N` suffix, and published
  releases are never rewritten.
- **Generated release notes**: `scripts/gen-release-notes.sh` drafts the notes from commits since the
  previous tag, preferring a hand-written `docs/release-notes/X.Y.Z.md` when one exists.
- **README release info is updated automatically**: after publishing,
  `scripts/update-readme-release-info.mjs` rewrites the `release` block in README.md and README_JP.md
  and commits it.
- **Resource readout**: the webview toolbar (between the session picker and `+`) shows the total size
  of saved images and the extension host's RSS.
- **CI**: typecheck, build, and tests run on an Ubuntu / macOS / Windows matrix, alongside npm audit
  and TruffleHog scanning, a check that `package.json` is not behind the latest release, and VSIX
  packaging verification.

### Changed

- **Documentation rewritten for users**: README.md and README_JP.md gained a table of contents and
  sections for features, storage and memory, limitations, troubleshooting, and development.
- **Stricter types and teardown**: TypeScript strict mode, no `any`, and an exhaustive check on every
  message crossing the webview boundary. Added JSDoc to `AiTerminalViewProvider`, `ShellSession`, and
  `extension.ts`.

## [0.0.2] - 2025-12-07

### Changed

- Moved the terminal backend to `node-pty` for better performance and compatibility.

## [0.0.1] - 2025-11-09

### Added

- Terminal view in the Secondary Side Bar.
- Multiple session management.
- Split view for two sessions.
- Drag and drop images into the terminal.
- Automatic image cleanup.
- Nine theme presets (modern, basic, clearDark, clearLight, grass, homebrew, manPage, ocean, pro).
- Configurable startup commands.
- Configurable shell path.
- Input validation on everything crossing a trust boundary.
- Centralized logging.

[Unreleased]: https://github.com/den0206/terminal-for-ai-cli/compare/Ver_0.2.1...HEAD
[0.2.1]: https://github.com/den0206/terminal-for-ai-cli/compare/Ver_0.2.0...Ver_0.2.1
[0.2.0]: https://github.com/den0206/terminal-for-ai-cli/compare/Ver_0.1.0...Ver_0.2.0
[0.1.0]: https://github.com/den0206/terminal-for-ai-cli/releases/tag/Ver_0.1.0
