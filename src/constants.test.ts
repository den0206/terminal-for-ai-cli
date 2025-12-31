import {describe, expect, it} from 'vitest';
import {
  BUFFER_CONSTRAINTS,
  MAX_IMAGE_FILENAME_LENGTH,
  MAX_IMAGE_SIZE_BYTES,
  MAX_SESSIONS,
  SPLIT_VIEW,
  TERMINAL_CONSTRAINTS,
  TERMINAL_SCROLLBACK_LINES,
} from './constants';

// Import webview constants to verify they match
// Note: This is a dynamic import because webview constants are in a separate bundle
// We'll read the file directly to compare values
import * as fs from 'fs';
import * as path from 'path';

describe('Constants', () => {
  describe('Constants consistency check', () => {
    it('should have matching values between extension and webview constants', () => {
      // Read webview constants file
      // Use path relative to the src directory (where this test file is located)
      const srcDir = path.resolve(process.cwd(), 'src');
      const webviewConstantsPath = path.resolve(
        srcDir,
        'webview',
        'lib',
        'constants.ts'
      );
      const webviewConstantsContent = fs.readFileSync(
        webviewConstantsPath,
        'utf-8'
      );

      // Extract values from webview constants using regex
      // This is a simple approach - in a real scenario, you might want to parse the AST
      const extractConstant = (name: string): number | undefined => {
        // Match patterns like: MAX_SESSIONS: 2, or MAX_IMAGE_SIZE_BYTES: 10 * 1024 * 1024
        const regex = new RegExp(`${name}:\\s*([^,}]+)`);
        const match = webviewConstantsContent.match(regex);
        if (!match) {
          return undefined;
        }
        // Handle expressions like "10 * 1024 * 1024" or "200_000"
        const value = match[1].trim();
        // Remove underscores (numeric separators)
        const cleaned = value.replace(/_/g, '');
        // Handle simple multiplication expressions
        if (cleaned.includes('*')) {
          const parts = cleaned
            .split('*')
            .map((p) => Number.parseFloat(p.trim()));
          if (parts.every((p) => !Number.isNaN(p))) {
            return parts.reduce((acc, val) => acc * val, 1);
          }
        }
        return Number.parseFloat(cleaned);
      };

      // Check MAX_SESSIONS
      const webviewMaxSessions = extractConstant('MAX_SESSIONS');
      expect(webviewMaxSessions).toBe(MAX_SESSIONS);

      // Check MAX_IMAGE_SIZE_BYTES (handles expressions like "10 * 1024 * 1024")
      const webviewMaxImageSize = extractConstant('MAX_IMAGE_SIZE_BYTES');
      expect(webviewMaxImageSize).toBe(MAX_IMAGE_SIZE_BYTES);

      // Check TERMINAL_SCROLLBACK_LINES
      const webviewScrollback = extractConstant('TERMINAL_SCROLLBACK_LINES');
      expect(webviewScrollback).toBe(TERMINAL_SCROLLBACK_LINES);

      // Check MIN_TERMINAL_HEIGHT
      const webviewMinHeight = extractConstant('MIN_TERMINAL_HEIGHT');
      expect(webviewMinHeight).toBe(TERMINAL_CONSTRAINTS.MIN_HEIGHT);

      // Check MAX_TERMINAL_HEIGHT
      const webviewMaxHeight = extractConstant('MAX_TERMINAL_HEIGHT');
      expect(webviewMaxHeight).toBe(TERMINAL_CONSTRAINTS.MAX_HEIGHT);

      // Check DEFAULT_TERMINAL_HEIGHT
      const webviewDefaultHeight = extractConstant('DEFAULT_TERMINAL_HEIGHT');
      expect(webviewDefaultHeight).toBe(TERMINAL_CONSTRAINTS.DEFAULT_HEIGHT);

      // Check MIN_SPLIT_RATIO
      const webviewMinSplitRatio = extractConstant('MIN_SPLIT_RATIO');
      expect(webviewMinSplitRatio).toBe(SPLIT_VIEW.MIN_RATIO);

      // Check MAX_SPLIT_RATIO
      const webviewMaxSplitRatio = extractConstant('MAX_SPLIT_RATIO');
      expect(webviewMaxSplitRatio).toBe(SPLIT_VIEW.MAX_RATIO);

      // Check MAX_BUFFER_SIZE (handles numeric separators like 200_000)
      const webviewMaxBufferSize = extractConstant('MAX_BUFFER_SIZE');
      expect(webviewMaxBufferSize).toBe(BUFFER_CONSTRAINTS.MAX_SIZE);

      // Check MAX_BUFFER_COUNT
      const webviewMaxBufferCount = extractConstant('MAX_BUFFER_COUNT');
      expect(webviewMaxBufferCount).toBe(BUFFER_CONSTRAINTS.MAX_COUNT);
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
