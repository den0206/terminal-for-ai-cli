/**
 * Constants for webview
 * Note: These constants are duplicated here for the webview bundle
 * which runs in a separate context. They should match the values in src/constants.ts
 */

export const Constants = {
  MAX_SESSIONS: 2,
  MIN_SPLIT_RATIO: 0.2,
  MAX_SPLIT_RATIO: 0.8,
  MAX_IMAGE_SIZE_BYTES: 10 * 1024 * 1024, // 10MB
  MAX_BUFFER_SIZE: 200_000,
  MAX_BUFFER_COUNT: 10,
  MIN_TERMINAL_HEIGHT: 220,
  MAX_TERMINAL_HEIGHT: 1000,
  DEFAULT_TERMINAL_HEIGHT: 640,
  TERMINAL_SCROLLBACK_LINES: 2000,
} as const;
