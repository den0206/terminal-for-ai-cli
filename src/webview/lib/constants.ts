/**
 * Constants for webview
 *
 * These are derived from the single source of truth: `src/shared/constants.ts`.
 * Keep this file as a small adapter so existing webview code can continue to use
 * `Constants.*` without duplicating raw values.
 */

import { SHARED_CONSTANTS } from '../../shared/constants';

export const Constants = {
  /** @see src/shared/constants.ts - MAX_SESSIONS */
  MAX_SESSIONS: SHARED_CONSTANTS.MAX_SESSIONS,
  /** @see src/shared/constants.ts - SPLIT_VIEW.MIN_RATIO */
  MIN_SPLIT_RATIO: SHARED_CONSTANTS.SPLIT_VIEW.MIN_RATIO,
  /** @see src/shared/constants.ts - SPLIT_VIEW.MAX_RATIO */
  MAX_SPLIT_RATIO: SHARED_CONSTANTS.SPLIT_VIEW.MAX_RATIO,
  /** @see src/shared/constants.ts - MAX_IMAGE_SIZE_BYTES */
  MAX_IMAGE_SIZE_BYTES: SHARED_CONSTANTS.MAX_IMAGE_SIZE_BYTES,
  /** @see src/shared/constants.ts - BUFFER_CONSTRAINTS.MAX_SIZE */
  MAX_BUFFER_SIZE: SHARED_CONSTANTS.BUFFER_CONSTRAINTS.MAX_SIZE,
  /** @see src/shared/constants.ts - BUFFER_CONSTRAINTS.MAX_COUNT */
  MAX_BUFFER_COUNT: SHARED_CONSTANTS.BUFFER_CONSTRAINTS.MAX_COUNT,
  /** @see src/shared/constants.ts - TERMINAL_CONSTRAINTS.MIN_HEIGHT */
  MIN_TERMINAL_HEIGHT: SHARED_CONSTANTS.TERMINAL_CONSTRAINTS.MIN_HEIGHT,
  /** @see src/shared/constants.ts - TERMINAL_CONSTRAINTS.MAX_HEIGHT */
  MAX_TERMINAL_HEIGHT: SHARED_CONSTANTS.TERMINAL_CONSTRAINTS.MAX_HEIGHT,
  /** @see src/shared/constants.ts - TERMINAL_CONSTRAINTS.DEFAULT_HEIGHT */
  DEFAULT_TERMINAL_HEIGHT: SHARED_CONSTANTS.TERMINAL_CONSTRAINTS.DEFAULT_HEIGHT,
  /** @see src/shared/constants.ts - TERMINAL_SCROLLBACK_LINES */
  TERMINAL_SCROLLBACK_LINES: SHARED_CONSTANTS.TERMINAL_SCROLLBACK_LINES,
} as const;
