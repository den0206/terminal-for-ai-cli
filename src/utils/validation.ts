import * as fs from 'fs';
import * as path from 'path';

// Conditional import to avoid issues in test environment
let Logger: typeof import('./logger').Logger;
try {
  const loggerModule = require('./logger');
  Logger = loggerModule.Logger;
} catch {
  // Fallback for test environment
  Logger = {
    warn: (...args: unknown[]) => console.warn(...args),
  } as typeof import('./logger').Logger;
}

/**
 * Validates that a shell path is safe to execute
 * @param shellPath The path to validate
 * @returns true if the shell path is valid and safe, false otherwise
 */
export function validateShellPath(shellPath: string | undefined): boolean {
  if (!shellPath || typeof shellPath !== 'string') {
    return false;
  }

  const trimmedPath = shellPath.trim();
  if (!trimmedPath) {
    return false;
  }

  // Must be an absolute path
  if (!path.isAbsolute(trimmedPath)) {
    return false;
  }

  // Check for path traversal attempts
  const normalized = path.normalize(trimmedPath);
  if (normalized !== trimmedPath) {
    return false;
  }

  // Check if file exists and is executable
  try {
    const stats = fs.statSync(trimmedPath);
    if (!stats.isFile()) {
      return false;
    }

    // On Unix-like systems, check if file is executable
    if (process.platform !== 'win32') {
      try {
        fs.accessSync(trimmedPath, fs.constants.X_OK);
      } catch {
        return false;
      }
    }
  } catch {
    return false;
  }

  return true;
}

/**
 * Gets the default shell path for the current platform
 * @returns The default shell path
 */
export function getDefaultShell(): string {
  const platform = process.platform;

  if (platform === 'win32') {
    return process.env.COMSPEC || 'C:\\Windows\\System32\\cmd.exe';
  }

  // Try to get user's login shell from environment
  const shell = process.env.SHELL || process.env.shell;
  if (shell && validateShellPath(shell)) {
    return shell;
  }

  // Fallback to common shells by platform
  if (platform === 'darwin') {
    // macOS: try zsh first (default since Catalina), then bash
    const candidates = ['/bin/zsh', '/bin/bash', '/bin/sh'];
    for (const candidate of candidates) {
      if (validateShellPath(candidate)) {
        return candidate;
      }
    }
  } else {
    // Linux and others: try bash, then sh
    const candidates = ['/bin/bash', '/bin/sh'];
    for (const candidate of candidates) {
      if (validateShellPath(candidate)) {
        return candidate;
      }
    }
  }

  // Final fallback
  return '/bin/sh';
}

/**
 * Validates startup commands to prevent command injection
 * @param commands Array of commands to validate
 * @returns Sanitized array of commands
 */
export function validateStartupCommands(commands: unknown): string[] {
  if (!Array.isArray(commands)) {
    return [];
  }

  return commands
    .filter((cmd): cmd is string => typeof cmd === 'string')
    .map(cmd => cmd.trim())
    .filter(cmd => {
      // Filter out empty commands
      if (!cmd) {
        return false;
      }

      // Warn about potentially dangerous commands (but don't block them)
      // Users should have control, but we log warnings
      const dangerousPatterns = [
        /^\s*rm\s+-rf\s+[/~]/,  // rm -rf / or ~
        /^\s*:\(\)\{.*\}:/,       // fork bomb
        /\bsudo\s+rm\b/,          // sudo rm
      ];

      for (const pattern of dangerousPatterns) {
        if (pattern.test(cmd)) {
          Logger.warn(`Potentially dangerous startup command detected: ${cmd.substring(0, 50)}...`);
        }
      }

      return true;
    });
}

/**
 * Validates a working directory path
 * @param cwd The directory path to validate
 * @returns The validated path or undefined if invalid
 */
export function validateWorkingDirectory(cwd: string | undefined): string | undefined {
  if (!cwd || typeof cwd !== 'string') {
    return undefined;
  }

  const trimmedPath = cwd.trim();
  if (!trimmedPath) {
    return undefined;
  }

  // Resolve to absolute path
  const resolved = path.resolve(trimmedPath);

  // Check if directory exists
  try {
    const stats = fs.statSync(resolved);
    if (!stats.isDirectory()) {
      return undefined;
    }
  } catch {
    return undefined;
  }

  return resolved;
}

/**
 * Validates a numeric configuration value within a specified range
 * @param value The value to validate
 * @param min Minimum allowed value (inclusive)
 * @param max Maximum allowed value (inclusive)
 * @param defaultValue Default value to return if validation fails
 * @returns Validated value within range, or default value
 */
export function validateNumericRange(
  value: unknown,
  min: number,
  max: number,
  defaultValue: number
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return defaultValue;
  }
  return Math.min(max, Math.max(min, value));
}

/**
 * Validates terminal height configuration
 * @param value The terminal height value to validate
 * @returns Validated terminal height (220-1000 pixels)
 */
export function validateTerminalHeight(value: unknown): number {
  const MIN_TERMINAL_HEIGHT = 220;
  const MAX_TERMINAL_HEIGHT = 1000;
  const DEFAULT_TERMINAL_HEIGHT = 640;
  return validateNumericRange(
    value,
    MIN_TERMINAL_HEIGHT,
    MAX_TERMINAL_HEIGHT,
    DEFAULT_TERMINAL_HEIGHT
  );
}

/**
 * Validates split ratio configuration
 * @param value The split ratio value to validate (0.0-1.0)
 * @param minRatio Minimum allowed ratio (default: 0.2)
 * @param maxRatio Maximum allowed ratio (default: 0.8)
 * @returns Validated split ratio
 */
export function validateSplitRatio(
  value: unknown,
  minRatio = 0.2,
  maxRatio = 0.8
): number {
  const DEFAULT_RATIO = 0.5;
  return validateNumericRange(value, minRatio, maxRatio, DEFAULT_RATIO);
}

/**
 * Validates terminal dimensions (cols and rows)
 * @param cols Number of columns
 * @param rows Number of rows
 * @returns Validated dimensions with minimum values
 */
export function validateTerminalDimensions(
  cols?: number,
  rows?: number
): {cols: number; rows: number} {
  const MIN_COLS = 2;
  const MIN_ROWS = 1;
  const DEFAULT_COLS = 80;
  const DEFAULT_ROWS = 24;

  return {
    cols: typeof cols === 'number' && Number.isFinite(cols) && cols >= MIN_COLS
      ? cols
      : DEFAULT_COLS,
    rows: typeof rows === 'number' && Number.isFinite(rows) && rows >= MIN_ROWS
      ? rows
      : DEFAULT_ROWS,
  };
}
