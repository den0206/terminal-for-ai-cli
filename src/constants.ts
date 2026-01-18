/**
 * Global constants for Terminal For AI CLI (Extension Host)
 *
 * Source of truth lives in `src/shared/constants.ts` so the webview bundle and
 * extension host stay in sync without duplicating raw values.
 */

import { SHARED_CONSTANTS } from './shared/constants';

/**
 * Maximum number of concurrent terminal sessions allowed
 * @see src/webview/lib/constants.ts - Constants.MAX_SESSIONS
 */
export const MAX_SESSIONS = SHARED_CONSTANTS.MAX_SESSIONS;

/**
 * Maximum size in bytes for image files that can be dropped into the terminal
 * Default: 10MB
 * @see src/webview/lib/constants.ts - Constants.MAX_IMAGE_SIZE_BYTES
 */
export const MAX_IMAGE_SIZE_BYTES = SHARED_CONSTANTS.MAX_IMAGE_SIZE_BYTES;

/**
 * Maximum length for image file names to prevent filesystem limits
 */
export const MAX_IMAGE_FILENAME_LENGTH =
  SHARED_CONSTANTS.MAX_IMAGE_FILENAME_LENGTH;

/**
 * Terminal UI dimension constraints
 * @see src/webview/lib/constants.ts - Constants.MIN_TERMINAL_HEIGHT, MAX_TERMINAL_HEIGHT, DEFAULT_TERMINAL_HEIGHT
 */
export const TERMINAL_CONSTRAINTS = SHARED_CONSTANTS.TERMINAL_CONSTRAINTS;

/**
 * Webview buffer management
 * @see src/webview/lib/constants.ts - Constants.MAX_BUFFER_SIZE, MAX_BUFFER_COUNT
 */
export const BUFFER_CONSTRAINTS = SHARED_CONSTANTS.BUFFER_CONSTRAINTS;

/**
 * Split view constraints
 * @see src/webview/lib/constants.ts - Constants.MIN_SPLIT_RATIO, MAX_SPLIT_RATIO
 */
export const SPLIT_VIEW = SHARED_CONSTANTS.SPLIT_VIEW;

/**
 * Process termination timeouts (in milliseconds)
 */
export const PROCESS_TERMINATION = SHARED_CONSTANTS.PROCESS_TERMINATION;

/**
 * Terminal scrollback buffer size (number of lines)
 * @see src/webview/lib/constants.ts - Constants.TERMINAL_SCROLLBACK_LINES
 */
export const TERMINAL_SCROLLBACK_LINES =
  SHARED_CONSTANTS.TERMINAL_SCROLLBACK_LINES;
