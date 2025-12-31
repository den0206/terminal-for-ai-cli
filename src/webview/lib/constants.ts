/**
 * Constants for webview
 *
 * ⚠️ IMPORTANT: These constants are duplicated here for the webview bundle
 * which runs in a separate context. They MUST match the values in src/constants.ts
 *
 * When updating these values:
 * 1. Update the corresponding value in src/constants.ts
 * 2. Update this file with the same value
 * 3. Run `npm test` to verify consistency
 *
 * @see src/constants.ts - Source of truth for all constant values
 */

export const Constants = {
  /** @see src/constants.ts - MAX_SESSIONS */
  MAX_SESSIONS: 2,
  /** @see src/constants.ts - SPLIT_VIEW.MIN_RATIO */
  MIN_SPLIT_RATIO: 0.2,
  /** @see src/constants.ts - SPLIT_VIEW.MAX_RATIO */
  MAX_SPLIT_RATIO: 0.8,
  /** @see src/constants.ts - MAX_IMAGE_SIZE_BYTES */
  MAX_IMAGE_SIZE_BYTES: 10 * 1024 * 1024, // 10MB
  /** @see src/constants.ts - BUFFER_CONSTRAINTS.MAX_SIZE */
  MAX_BUFFER_SIZE: 200_000,
  /** @see src/constants.ts - BUFFER_CONSTRAINTS.MAX_COUNT */
  MAX_BUFFER_COUNT: 10,
  /** @see src/constants.ts - TERMINAL_CONSTRAINTS.MIN_HEIGHT */
  MIN_TERMINAL_HEIGHT: 220,
  /** @see src/constants.ts - TERMINAL_CONSTRAINTS.MAX_HEIGHT */
  MAX_TERMINAL_HEIGHT: 1000,
  /** @see src/constants.ts - TERMINAL_CONSTRAINTS.DEFAULT_HEIGHT */
  DEFAULT_TERMINAL_HEIGHT: 640,
  /** @see src/constants.ts - TERMINAL_SCROLLBACK_LINES */
  TERMINAL_SCROLLBACK_LINES: 2000,
} as const;
