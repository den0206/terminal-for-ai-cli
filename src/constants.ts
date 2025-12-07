/**
 * Global constants for Terminal For AI CLI
 */

/**
 * Maximum number of concurrent terminal sessions allowed
 */
export const MAX_SESSIONS = 2;

/**
 * Maximum size in bytes for image files that can be dropped into the terminal
 * Default: 10MB
 */
export const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;

/**
 * Maximum length for image file names to prevent filesystem limits
 */
export const MAX_IMAGE_FILENAME_LENGTH = 255;

/**
 * Terminal UI dimension constraints
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
 */
export const BUFFER_CONSTRAINTS = {
  MAX_SIZE: 200_000,
  MAX_COUNT: 10,
} as const;

/**
 * Split view constraints
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
 */
export const TERMINAL_SCROLLBACK_LINES = 2000;
