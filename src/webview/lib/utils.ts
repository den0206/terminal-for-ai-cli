import {Constants} from './constants';
import type {ViewState} from './types';

// ============================================================================
// Webview Logger
// ============================================================================

const LOG_PREFIX = '[TerminalForAI]';

export const webviewLog = {
  warn(message: string, ...args: unknown[]): void {
    console.warn(`${LOG_PREFIX} ${message}`, ...args);
  },
  error(message: string, ...args: unknown[]): void {
    console.error(`${LOG_PREFIX} ${message}`, ...args);
  },
};

// ============================================================================
// Utility Types
// ============================================================================

export type CancellableFunction<T extends (...args: never[]) => void> = ((
  ...args: Parameters<T>
) => void) & {cancel: () => void; flush: () => void};

// ============================================================================
// Utility Functions
// ============================================================================

export function debounce<T extends (...args: never[]) => void>(
  fn: T,
  delay: number
): CancellableFunction<T> {
  let handle: number | undefined;
  let pendingArgs: Parameters<T> | undefined;
  const debounced = (...args: Parameters<T>) => {
    pendingArgs = args;
    if (handle) {
      clearTimeout(handle);
    }
    handle = window.setTimeout(() => {
      fn(...(pendingArgs as Parameters<T>));
      handle = undefined;
      pendingArgs = undefined;
    }, delay);
  };
  debounced.cancel = () => {
    if (handle) {
      clearTimeout(handle);
      handle = undefined;
      pendingArgs = undefined;
    }
  };
  debounced.flush = () => {
    if (handle !== undefined) {
      clearTimeout(handle);
      handle = undefined;
      if (pendingArgs !== undefined) {
        fn(...pendingArgs);
        pendingArgs = undefined;
      }
    }
  };
  return debounced;
}

export function throttle<T extends (...args: never[]) => void>(
  fn: T,
  delay: number
): CancellableFunction<T> {
  let lastCall = 0;
  let timeoutHandle: number | undefined;
  let pendingArgs: Parameters<T> | undefined;
  const throttled = (...args: Parameters<T>) => {
    pendingArgs = args;
    const now = Date.now();
    const timeSinceLastCall = now - lastCall;

    if (timeSinceLastCall >= delay) {
      lastCall = now;
      pendingArgs = undefined;
      fn(...args);
    } else {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      timeoutHandle = window.setTimeout(() => {
        lastCall = Date.now();
        fn(...(pendingArgs as Parameters<T>));
        timeoutHandle = undefined;
        pendingArgs = undefined;
      }, delay - timeSinceLastCall);
    }
  };
  throttled.cancel = () => {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = undefined;
      pendingArgs = undefined;
    }
  };
  throttled.flush = () => {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
      timeoutHandle = undefined;
      if (pendingArgs !== undefined) {
        lastCall = Date.now();
        fn(...pendingArgs);
        pendingArgs = undefined;
      }
    }
  };
  return throttled;
}

export function getComputedVar(
  name: string,
  fallbackVar?: string,
  fallbackValue?: string
): string {
  const styles = getComputedStyle(document.documentElement);
  const value = styles.getPropertyValue(name)?.trim();
  if (value) {
    return value;
  }
  if (fallbackVar) {
    const nested = styles.getPropertyValue(fallbackVar)?.trim();
    if (nested) {
      return nested;
    }
  }
  return fallbackValue ?? '';
}

export function validateTerminalHeight(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return Constants.DEFAULT_TERMINAL_HEIGHT;
  }
  return Math.min(
    Constants.MAX_TERMINAL_HEIGHT,
    Math.max(Constants.MIN_TERMINAL_HEIGHT, value)
  );
}

export function clampSplitRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.5;
  }
  return Math.min(
    Constants.MAX_SPLIT_RATIO,
    Math.max(Constants.MIN_SPLIT_RATIO, value)
  );
}

export function isValidViewState(state: unknown): state is ViewState {
  if (!state || typeof state !== 'object') {
    return false;
  }
  const s = state as Record<string, unknown>;
  return (
    (s.totalSessions === undefined || typeof s.totalSessions === 'number') &&
    (s.sessionIds === undefined || Array.isArray(s.sessionIds)) &&
    (s.activeSessionId === undefined ||
      typeof s.activeSessionId === 'string') &&
    (s.terminalHeight === undefined || typeof s.terminalHeight === 'number') &&
    (s.sessionMeta === undefined ||
      (typeof s.sessionMeta === 'object' && s.sessionMeta !== null)) &&
    (s.viewMode === undefined ||
      s.viewMode === 'single' ||
      s.viewMode === 'split') &&
    (s.splitRatio === undefined || typeof s.splitRatio === 'number')
  );
}
