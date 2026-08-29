import {describe, expect, it} from 'vitest';
import {
  validateTerminalHeight,
  clampSplitRatio,
  isShiftEnter,
  isValidViewState,
} from './utils';

describe('webview utils', () => {
  describe('validateTerminalHeight', () => {
    it('returns default when value is not a number', () => {
      expect(validateTerminalHeight(undefined)).toBe(640);
      expect(validateTerminalHeight(NaN)).toBe(640);
      expect(validateTerminalHeight('100')).toBe(640);
      expect(validateTerminalHeight(null)).toBe(640);
    });

    it('clamps to MIN_TERMINAL_HEIGHT and MAX_TERMINAL_HEIGHT', () => {
      expect(validateTerminalHeight(100)).toBe(220);
      expect(validateTerminalHeight(2000)).toBe(1000);
      expect(validateTerminalHeight(500)).toBe(500);
    });

    it('returns default for non-finite numbers', () => {
      expect(validateTerminalHeight(Infinity)).toBe(640);
      expect(validateTerminalHeight(-Infinity)).toBe(640);
    });
  });

  describe('clampSplitRatio', () => {
    it('returns 0.5 for non-finite input', () => {
      expect(clampSplitRatio(NaN)).toBe(0.5);
      expect(clampSplitRatio(Infinity)).toBe(0.5);
    });

    it('clamps to MIN and MAX split ratio', () => {
      expect(clampSplitRatio(0.1)).toBe(0.2);
      expect(clampSplitRatio(0.9)).toBe(0.8);
      expect(clampSplitRatio(0.5)).toBe(0.5);
    });

    it('accepts valid ratio within range', () => {
      expect(clampSplitRatio(0.3)).toBe(0.3);
      expect(clampSplitRatio(0.7)).toBe(0.7);
    });
  });

  describe('isValidViewState', () => {
    it('returns false for null or non-object', () => {
      expect(isValidViewState(null)).toBe(false);
      expect(isValidViewState(undefined)).toBe(false);
      expect(isValidViewState('state')).toBe(false);
      expect(isValidViewState(42)).toBe(false);
    });

    it('returns true for minimal valid state', () => {
      expect(isValidViewState({totalSessions: 0, sessionIds: []})).toBe(true);
    });

    it('returns true for full valid state', () => {
      expect(
        isValidViewState({
          totalSessions: 1,
          sessionIds: ['id-1'],
          activeSessionId: 'id-1',
          terminalHeight: 400,
          sessionMeta: {},
          viewMode: 'single',
          splitRatio: 0.5,
        })
      ).toBe(true);
    });

    it('returns false for invalid totalSessions', () => {
      expect(isValidViewState({totalSessions: '0', sessionIds: []})).toBe(false);
    });

    it('returns false for invalid sessionIds', () => {
      expect(isValidViewState({totalSessions: 0, sessionIds: 'not-array'})).toBe(false);
    });

    it('returns false for invalid viewMode', () => {
      expect(
        isValidViewState({
          totalSessions: 0,
          sessionIds: [],
          viewMode: 'invalid',
        })
      ).toBe(false);
    });

    it('returns false when sessionMeta is not an object', () => {
      expect(
        isValidViewState({
          totalSessions: 0,
          sessionIds: [],
          sessionMeta: 'invalid',
        })
      ).toBe(false);
    });
  });

  describe('isShiftEnter', () => {
    const keyEvent = (overrides: Record<string, unknown>) =>
      ({
        type: 'keydown',
        key: 'Enter',
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        ...overrides,
      }) as unknown as KeyboardEvent;

    it('matches Shift+Enter on keydown', () => {
      expect(isShiftEnter(keyEvent({shiftKey: true}))).toBe(true);
    });

    it('ignores a plain Enter and other keys', () => {
      expect(isShiftEnter(keyEvent({}))).toBe(false);
      expect(isShiftEnter(keyEvent({key: 'a', shiftKey: true}))).toBe(false);
    });

    it('ignores other modifiers and keyup', () => {
      expect(isShiftEnter(keyEvent({shiftKey: true, altKey: true}))).toBe(false);
      expect(isShiftEnter(keyEvent({shiftKey: true, ctrlKey: true}))).toBe(
        false
      );
      expect(isShiftEnter(keyEvent({shiftKey: true, type: 'keyup'}))).toBe(
        false
      );
    });
  });

});
