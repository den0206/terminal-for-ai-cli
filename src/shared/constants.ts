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

  /** Webview buffer management */
  BUFFER_CONSTRAINTS: {
    MAX_SIZE: 200_000,
    MAX_COUNT: 10,
  },

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
  TERMINAL_SCROLLBACK_LINES: 2000,
} as const;

