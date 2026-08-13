/**
 * Shared constants used by BOTH:
 * - Extension host (Node.js)
 * - Webview bundle (Browser)
 *
 * Keep this file **pure** (no vscode/fs/path imports) so it can be safely bundled
 * into the webview and imported by node-side code.
 */
export const SHARED_CONSTANTS = {
  /** Maximum number of concurrent terminal sessions allowed */
  MAX_SESSIONS: 2,

  /** Maximum size in bytes for image files that can be dropped into the terminal (10MB) */
  MAX_IMAGE_SIZE_BYTES: 10 * 1024 * 1024,

  /** Maximum length for image file names to prevent filesystem limits */
  MAX_IMAGE_FILENAME_LENGTH: 255,

  /** Terminal UI dimension constraints */
  TERMINAL_CONSTRAINTS: {
    MIN_HEIGHT: 220,
    MAX_HEIGHT: 1000,
    DEFAULT_HEIGHT: 640,
    MIN_COLS: 2,
    MIN_ROWS: 1,
    DEFAULT_COLS: 80,
    DEFAULT_ROWS: 24,
  },

  /** Webview per-session buffer size in chars (covers 3000 scrollback lines at ~1k chars/line + ANSI) */
  MAX_BUFFER_SIZE: 2_000_000,

  /** Split view constraints */
  SPLIT_VIEW: {
    MIN_RATIO: 0.2,
    MAX_RATIO: 0.8,
    DEFAULT_RATIO: 0.5,
  },

  /** Process termination timeouts (in milliseconds) */
  PROCESS_TERMINATION: {
    /** Time to wait before sending SIGKILL after SIGTERM */
    SIGKILL_DELAY_MS: 2000,
  },

  /** Terminal scrollback buffer size (number of lines) */
  TERMINAL_SCROLLBACK_LINES: 3000,

  /** Maximum size of the message queue before oldest messages are dropped */
  MESSAGE_QUEUE_MAX_SIZE: 100,

  /** Time after which saved images are considered stale and eligible for cleanup (24 hours) */
  IMAGE_TTL_MS: 24 * 60 * 60 * 1000,
} as const;

