import * as fs from 'fs';
import * as path from 'path';
import {SHARED_CONSTANTS} from '../shared/constants';
import {Logger} from './logger';

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

  // Fallback to common shells by platform (zsh is the macOS default since Catalina)
  const candidates =
    platform === 'darwin'
      ? ['/bin/zsh', '/bin/bash', '/bin/sh']
      : ['/bin/bash', '/bin/sh'];
  return candidates.find(validateShellPath) ?? '/bin/sh';
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
    .map((cmd) => cmd.trim())
    .filter((cmd) => {
      // Filter out empty commands
      if (!cmd) {
        return false;
      }

      // Warn about potentially dangerous commands (but don't block them)
      // Users should have control, but we log warnings
      const dangerousPatterns = [
        /^\s*rm\s+-rf\s+[/~]/, // rm -rf / or ~
        /^\s*:\(\)\{.*\}:/, // fork bomb
        /\bsudo\s+rm\b/, // sudo rm
      ];

      for (const pattern of dangerousPatterns) {
        if (pattern.test(cmd)) {
          Logger.warn(
            `Potentially dangerous startup command detected: ${cmd.substring(
              0,
              50
            )}...`
          );
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
export function validateWorkingDirectory(
  cwd: string | undefined
): string | undefined {
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
 * Validates terminal dimensions (cols and rows)
 * @param cols Number of columns
 * @param rows Number of rows
 * @returns Validated dimensions with minimum values
 */
export function validateTerminalDimensions(
  cols?: number,
  rows?: number
): {cols: number; rows: number} {
  const {MIN_COLS, MIN_ROWS, DEFAULT_COLS, DEFAULT_ROWS} =
    SHARED_CONSTANTS.TERMINAL_CONSTRAINTS;
  return {
    cols:
      typeof cols === 'number' && Number.isFinite(cols) && cols >= MIN_COLS
        ? cols
        : DEFAULT_COLS,
    rows:
      typeof rows === 'number' && Number.isFinite(rows) && rows >= MIN_ROWS
        ? rows
        : DEFAULT_ROWS,
  };
}

/**
 * Validates a URL coming from terminal output and returns its normalized form.
 * Terminal output is untrusted, so only http(s) is allowed - other schemes
 * (file:, vscode:, custom app handlers) can launch programs.
 *
 * Returns the parsed href rather than the input string: the URL parser drops
 * tabs and newlines, so a link that reads as good.com across two lines can
 * resolve to evil.com. Callers must show and open this return value, never
 * the original string, or the confirmation prompt shows a different host
 * than the one that opens.
 * @param uri The URL to validate
 * @returns The normalized URL, or undefined when it is not safe to open
 */
export function normalizeExternalUrl(uri: unknown): string | undefined {
  if (typeof uri !== 'string' || uri.length > 2048) {
    return undefined;
  }
  // Control characters vanish during parsing but survive in a modal, so they
  // let one host be displayed while another is opened.
  if (/[\u0000-\u001f\u007f]/.test(uri)) {
    return undefined;
  }
  try {
    const url = new URL(uri);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}
