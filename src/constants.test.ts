import { describe, expect, it } from 'vitest';
import {
    BUFFER_CONSTRAINTS,
    MAX_IMAGE_FILENAME_LENGTH,
    MAX_IMAGE_SIZE_BYTES,
    MAX_SESSIONS,
    SPLIT_VIEW,
    TERMINAL_CONSTRAINTS,
    TERMINAL_SCROLLBACK_LINES,
} from './constants';

// Import webview constants (built from shared single source of truth)
import { Constants as WebviewConstants } from './webview/lib/constants';

describe('Constants', () => {
  describe('Constants consistency check', () => {
    it('should have matching values between extension and webview constants', () => {
      expect(WebviewConstants.MAX_SESSIONS).toBe(MAX_SESSIONS);
      expect(WebviewConstants.MAX_IMAGE_SIZE_BYTES).toBe(MAX_IMAGE_SIZE_BYTES);
      expect(WebviewConstants.TERMINAL_SCROLLBACK_LINES).toBe(
        TERMINAL_SCROLLBACK_LINES
      );
      expect(WebviewConstants.MIN_TERMINAL_HEIGHT).toBe(
        TERMINAL_CONSTRAINTS.MIN_HEIGHT
      );
      expect(WebviewConstants.MAX_TERMINAL_HEIGHT).toBe(
        TERMINAL_CONSTRAINTS.MAX_HEIGHT
      );
      expect(WebviewConstants.DEFAULT_TERMINAL_HEIGHT).toBe(
        TERMINAL_CONSTRAINTS.DEFAULT_HEIGHT
      );
      expect(WebviewConstants.MIN_SPLIT_RATIO).toBe(SPLIT_VIEW.MIN_RATIO);
      expect(WebviewConstants.MAX_SPLIT_RATIO).toBe(SPLIT_VIEW.MAX_RATIO);
      expect(WebviewConstants.MAX_BUFFER_SIZE).toBe(BUFFER_CONSTRAINTS.MAX_SIZE);
      expect(WebviewConstants.MAX_BUFFER_COUNT).toBe(
        BUFFER_CONSTRAINTS.MAX_COUNT
      );
    });
  });

  describe('Constants values', () => {
    it('should have valid MAX_SESSIONS', () => {
      expect(MAX_SESSIONS).toBeGreaterThan(0);
      expect(MAX_SESSIONS).toBeLessThanOrEqual(10); // Reasonable upper limit
    });

    it('should have valid MAX_IMAGE_SIZE_BYTES', () => {
      expect(MAX_IMAGE_SIZE_BYTES).toBeGreaterThan(0);
      expect(MAX_IMAGE_SIZE_BYTES).toBe(10 * 1024 * 1024); // 10MB
    });

    it('should have valid MAX_IMAGE_FILENAME_LENGTH', () => {
      expect(MAX_IMAGE_FILENAME_LENGTH).toBeGreaterThan(0);
      expect(MAX_IMAGE_FILENAME_LENGTH).toBeLessThanOrEqual(255); // Filesystem limit
    });

    it('should have valid TERMINAL_CONSTRAINTS', () => {
      expect(TERMINAL_CONSTRAINTS.MIN_HEIGHT).toBeGreaterThan(0);
      expect(TERMINAL_CONSTRAINTS.MAX_HEIGHT).toBeGreaterThan(
        TERMINAL_CONSTRAINTS.MIN_HEIGHT
      );
      expect(TERMINAL_CONSTRAINTS.DEFAULT_HEIGHT).toBeGreaterThanOrEqual(
        TERMINAL_CONSTRAINTS.MIN_HEIGHT
      );
      expect(TERMINAL_CONSTRAINTS.DEFAULT_HEIGHT).toBeLessThanOrEqual(
        TERMINAL_CONSTRAINTS.MAX_HEIGHT
      );
      expect(TERMINAL_CONSTRAINTS.MIN_COLS).toBeGreaterThan(0);
      expect(TERMINAL_CONSTRAINTS.MIN_ROWS).toBeGreaterThan(0);
    });

    it('should have valid BUFFER_CONSTRAINTS', () => {
      expect(BUFFER_CONSTRAINTS.MAX_SIZE).toBeGreaterThan(0);
      expect(BUFFER_CONSTRAINTS.MAX_COUNT).toBeGreaterThan(0);
    });

    it('should have valid SPLIT_VIEW constraints', () => {
      expect(SPLIT_VIEW.MIN_RATIO).toBeGreaterThan(0);
      expect(SPLIT_VIEW.MAX_RATIO).toBeLessThan(1);
      expect(SPLIT_VIEW.MIN_RATIO).toBeLessThan(SPLIT_VIEW.MAX_RATIO);
      expect(SPLIT_VIEW.DEFAULT_RATIO).toBeGreaterThanOrEqual(
        SPLIT_VIEW.MIN_RATIO
      );
      expect(SPLIT_VIEW.DEFAULT_RATIO).toBeLessThanOrEqual(
        SPLIT_VIEW.MAX_RATIO
      );
    });

    it('should have valid TERMINAL_SCROLLBACK_LINES', () => {
      expect(TERMINAL_SCROLLBACK_LINES).toBeGreaterThan(0);
    });
  });
});
