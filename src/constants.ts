/**
 * Global constants for Terminal For AI CLI
 *
 * ⚠️ IMPORTANT: When updating these constants, also update the corresponding
 * values in src/webview/lib/constants.ts to maintain consistency.
 * Run `npm test` to verify consistency between extension and webview constants.
 */

/**
 * Maximum number of concurrent terminal sessions allowed
 * @see src/webview/lib/constants.ts - Constants.MAX_SESSIONS
 */
export const MAX_SESSIONS = 2;

/**
 * Maximum size in bytes for image files that can be dropped into the terminal
 * Default: 10MB
 * @see src/webview/lib/constants.ts - Constants.MAX_IMAGE_SIZE_BYTES
 */
export const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;

/**
 * Maximum length for image file names to prevent filesystem limits
 */
export const MAX_IMAGE_FILENAME_LENGTH = 255;

/**
 * Terminal UI dimension constraints
 * @see src/webview/lib/constants.ts - Constants.MIN_TERMINAL_HEIGHT, MAX_TERMINAL_HEIGHT, DEFAULT_TERMINAL_HEIGHT
 */
export const TERMINAL_CONSTRAINTS = {
  MIN_HEIGHT: 220,
  MAX_HEIGHT: 1000,
  DEFAULT_HEIGHT: 640,
  MIN_COLS: 2,
  MIN_ROWS: 1,
  DEFAULT_COLS: 80,
  DEFAULT_ROWS: 24,
} as const;

/**
 * Webview buffer management
 * @see src/webview/lib/constants.ts - Constants.MAX_BUFFER_SIZE, MAX_BUFFER_COUNT
 */
export const BUFFER_CONSTRAINTS = {
  MAX_SIZE: 200_000,
  MAX_COUNT: 10,
} as const;

/**
 * Split view constraints
 * @see src/webview/lib/constants.ts - Constants.MIN_SPLIT_RATIO, MAX_SPLIT_RATIO
 */
export const SPLIT_VIEW = {
  MIN_RATIO: 0.2,
  MAX_RATIO: 0.8,
  DEFAULT_RATIO: 0.5,
} as const;

/**
 * Process termination timeouts (in milliseconds)
 */
export const PROCESS_TERMINATION = {
  /** Time to wait before sending SIGKILL after SIGTERM */
  SIGKILL_DELAY_MS: 2000,
} as const;

/**
 * Terminal scrollback buffer size (number of lines)
 * @see src/webview/lib/constants.ts - Constants.TERMINAL_SCROLLBACK_LINES
 */
export const TERMINAL_SCROLLBACK_LINES = 2000;
