import type {IPty} from 'node-pty';
import {spawn as spawnPty} from 'node-pty';
import {spawn as spawnChildProcess} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {SHARED_CONSTANTS} from '../shared/constants';
import {Logger} from '../utils/logger';
import {
  validateShellPath,
  validateTerminalDimensions,
  validateWorkingDirectory,
} from '../utils/validation';
import {getDefaultCwd} from '../utils/workingDirectory';

type SessionOptions = {
  shell?: string;
  cols?: number;
  rows?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  startupCommands?: string[];
};

type SessionInfo = {
  id: string;
  pid?: number;
  shell: string;
  createdAt: number;
};

type SessionDataEvent = {id: string; data: string};
type SessionExitEvent = {
  id: string;
  code: number | null;
  signal: NodeJS.Signals | null;
};

type Dimensions = {cols: number; rows: number};

const SIGNAL_ENTRIES = Object.entries(os.constants?.signals ?? {});

function resolveSignal(signalCode?: number): NodeJS.Signals | null {
  if (typeof signalCode !== 'number') {
    return null;
  }
  const match = SIGNAL_ENTRIES.find(([, value]) => value === signalCode);
  return (match?.[0] as NodeJS.Signals | undefined) ?? null;
}

/**
 * Represents a single shell session with a PTY process.
 *
 * This class encapsulates a PTY (pseudo-terminal) process and provides methods
 * for interacting with it. Each session has a unique ID and manages its own
 * PTY lifecycle, including graceful termination with SIGTERM/SIGKILL.
 *
 * @remarks
 * The session uses a two-phase termination process:
 * 1. Send SIGTERM to allow graceful shutdown
 * 2. If process doesn't exit within grace period, send SIGKILL
 *
 * On Windows, uses `taskkill /F /T` to terminate the entire process tree.
 * On Unix-like systems, sends signals to the process group (negative PID).
 *
 * @example
 * ```typescript
 * const session = new ShellSession('session-123', ptyProcess);
 * session.write('ls -la\r');
 * session.resize(120, 30);
 * session.dispose(); // Cleanup when done
 * ```
 */
class ShellSession implements vscode.Disposable {
  private killTimer?: NodeJS.Timeout;
  private exitListener?: vscode.Disposable;
  private disposed = false;

  /**
   * Creates a new shell session.
   *
   * @param id - Unique identifier for this session
   * @param pty - The PTY process instance
   */
  constructor(public readonly id: string, private readonly pty: IPty) {}

  /**
   * Writes data to the PTY process.
   *
   * @param data - The data to write to the terminal
   */
  write(data: string) {
    if (!this.disposed) {
      try {
        this.pty.write(data);
      } catch (error) {
        // Log write failures but don't throw - the session may be in the process of closing
        Logger.warn(`Failed to write to PTY (session ${this.id})`, error);
      }
    }
  }

  /**
   * Resizes the PTY terminal dimensions.
   *
   * @param cols - Number of columns
   * @param rows - Number of rows
   */
  resize(cols: number, rows: number) {
    try {
      this.pty.resize(cols, rows);
    } catch (error) {
      // Log resize failures but don't throw - the session may be in the process of closing
      Logger.warn(`Failed to resize PTY (session ${this.id})`, error);
    }
  }

  /**
   * Disposes the session and kills the associated process tree.
   *
   * This method ensures proper cleanup of the PTY process and its children:
   * - On Unix: Sends SIGTERM to process group, then SIGKILL after grace period
   * - On Windows: Uses taskkill /F /T to terminate the entire process tree
   *
   * Safe to call multiple times - subsequent calls are no-ops.
   *
   * @remarks
   * The grace period before SIGKILL is controlled by SHARED_CONSTANTS.PROCESS_TERMINATION.SIGKILL_DELAY_MS
   * (default: 2000ms). This allows processes to clean up resources before forced termination.
   *
   * @example
   * ```typescript
   * session.dispose(); // First call terminates the process
   * session.dispose(); // Subsequent calls do nothing
   * ```
   */
  dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.clearKillTimer();
    this.disposeExitListener();
    this.killProcessTree();
  }

  private clearKillTimer() {
    if (this.killTimer) {
      clearTimeout(this.killTimer);
      this.killTimer = undefined;
    }
  }

  private disposeExitListener() {
    if (this.exitListener) {
      this.exitListener.dispose();
      this.exitListener = undefined;
    }
  }

  private killProcessTree() {
    const pid = this.pty.pid;
    if (!pid) {
      return;
    }

    if (process.platform === 'win32') {
      // Windows: Use taskkill to terminate the entire process tree
      try {
        spawnChildProcess('taskkill', ['/F', '/T', '/PID', String(pid)], {
          stdio: 'ignore',
        });
      } catch {
        // Fallback to standard kill
        this.pty.kill();
      }
    } else {
      // Unix-like systems: Kill the process group
      try {
        // Send SIGTERM to the entire process group
        // Negative PID sends signal to the process group
        process.kill(-pid, 'SIGTERM');

        // Schedule SIGKILL if process doesn't terminate within the grace period
        this.killTimer = setTimeout(() => {
          try {
            process.kill(-pid, 'SIGKILL');
          } catch {
            // Process already terminated
          }
          this.killTimer = undefined;
        }, SHARED_CONSTANTS.PROCESS_TERMINATION.SIGKILL_DELAY_MS);

        // Clear timer if process exits normally
        this.exitListener = this.pty.onExit(() => this.clearKillTimer());
      } catch {
        // Fallback to pty.kill if process group kill fails
        try {
          this.pty.kill();
        } catch {
          // ignore failures
        }
      }
    }
  }
}

/**
 * Performance metrics for monitoring session manager health
 */
export type PerformanceMetrics = {
  sessionCount: number;
  maxSessions: number;
  sessionCountPercentage: number;
};

/**
 * Manages multiple shell sessions using node-pty.
 * Handles session creation, lifecycle, input/output, and cleanup.
 */
export class SessionManager implements vscode.Disposable {
  private readonly sessions = new Map<string, ShellSession>();
  private readonly onDataEmitter = new vscode.EventEmitter<SessionDataEvent>();
  private readonly onExitEmitter = new vscode.EventEmitter<SessionExitEvent>();
  private readonly sessionInfos = new Map<string, SessionInfo>();

  readonly onDidWriteData = this.onDataEmitter.event;
  readonly onDidExit = this.onExitEmitter.event;

  /**
   * Creates a new terminal session with the specified options.
   *
   * Validates shell path, working directory, and startup commands before creating the session.
   * Automatically handles session lifecycle events (data, exit) and cleanup.
   *
   * @param options - Session configuration options
   * @param options.shell - Optional shell path (must be absolute and executable). If not provided, uses the default shell.
   * @param options.cols - Terminal column count (default: 80, min: 2). Invalid values are clamped to valid range.
   * @param options.rows - Terminal row count (default: 24, min: 1). Invalid values are clamped to valid range.
   * @param options.cwd - Working directory (must exist and be accessible). If invalid, falls back to default.
   * @param options.env - Additional environment variables to merge with process.env
   * @param options.startupCommands - Commands to execute after session creation (in order). Empty commands are skipped.
   * @returns Session information including ID, PID, shell, and creation timestamp
   * @throws {Error} If session creation fails (invalid shell, permission denied, spawn failure, etc.)
   *
   * @example
   * ```typescript
   * const session = sessionManager.createSession({
   *   shell: '/bin/zsh',
   *   cwd: '/home/user/project',
   *   startupCommands: ['cd src', 'ls -la']
   * });
   * ```
   */
  createSession(options: SessionOptions = {}): SessionInfo {
    const id = this.generateSessionId();
    let shell = options.shell?.trim() || this.getDefaultShell();

    // Validate shell path for security
    if (!validateShellPath(shell)) {
      const fallback = this.getDefaultShell();
      Logger.warn(
        `Invalid shell path: "${shell}". Using fallback: "${fallback}"`
      );
      shell = fallback;
    }

    const validatedDimensions = validateTerminalDimensions(
      options.cols,
      options.rows
    );
    const dimensions: Dimensions = {
      cols: validatedDimensions.cols,
      rows: validatedDimensions.rows,
    };
    const ptyProcess = this.launchShellProcess(shell, dimensions, options);

    const session = new ShellSession(id, ptyProcess);
    this.sessions.set(id, session);
    const info: SessionInfo = {
      id,
      pid: ptyProcess.pid ?? undefined,
      shell,
      createdAt: Date.now(),
    };
    this.sessionInfos.set(id, info);

    ptyProcess.onData((data) => {
      this.onDataEmitter.fire({id, data});
    });

    ptyProcess.onExit(({exitCode, signal}) => {
      this.sessions.delete(id);
      this.sessionInfos.delete(id);
      this.onExitEmitter.fire({
        id,
        code: exitCode,
        signal: resolveSignal(signal),
      });
    });

    for (const cmd of options.startupCommands ?? []) {
      if (cmd.trim().length > 0) {
        session.write(`${cmd}\r`);
      }
    }

    // Return the same object stored in sessionInfos to avoid duplicate allocation
    return info;
  }

  /**
   * Writes data to a terminal session.
   *
   * @param id - The session ID to write to
   * @param data - The data string to write to the terminal
   * @remarks If the session doesn't exist or is disposed, the write is silently ignored.
   */
  write(id: string, data: string) {
    this.sessions.get(id)?.write(data);
  }

  /**
   * Resizes a terminal session to the specified dimensions.
   *
   * @param id - The session ID to resize
   * @param cols - Number of columns (minimum: 2)
   * @param rows - Number of rows (minimum: 1)
   * @remarks Dimensions are automatically clamped to minimum values. If the session doesn't exist, the resize is silently ignored.
   */
  resize(id: string, cols: number, rows: number) {
    this.sessions.get(id)?.resize(Math.max(cols, 2), Math.max(rows, 1));
  }

  /**
   * Gets the current number of active sessions.
   *
   * @returns The number of active terminal sessions
   */
  getSessionCount() {
    return this.sessions.size;
  }

  /**
   * Disposes a terminal session and kills the associated process.
   *
   * @param id - The session ID to dispose
   * @remarks Safe to call multiple times. If the session doesn't exist, this is a no-op.
   */
  disposeSession(id: string) {
    const session = this.sessions.get(id);
    if (session) {
      session.dispose();
      this.sessions.delete(id);
      this.sessionInfos.delete(id);
    }
  }

  dispose() {
    for (const session of this.sessions.values()) {
      session.dispose();
    }
    this.sessions.clear();
    this.sessionInfos.clear();
    this.onDataEmitter.dispose();
    this.onExitEmitter.dispose();
  }

  /**
   * Launches a shell process using node-pty.
   *
   * Validates and sanitizes the working directory, builds the environment,
   * and determines appropriate shell arguments based on the platform.
   *
   * @param shell - The shell executable path (already validated)
   * @param dimensions - Terminal dimensions (cols, rows)
   * @param options - Session options including cwd and env
   * @returns The spawned PTY process instance
   * @throws {Error} If the PTY spawn fails (e.g., shell not found, permission denied)
   * @private
   */
  private launchShellProcess(
    shell: string,
    dimensions: Dimensions,
    options: SessionOptions
  ): IPty {
    // Validate and sanitize working directory
    const requestedCwd = options.cwd ?? getDefaultCwd();
    const cwd = validateWorkingDirectory(requestedCwd) ?? getDefaultCwd();
    if (cwd !== requestedCwd) {
      Logger.warn(
        `Invalid working directory: "${requestedCwd}". Using fallback: "${cwd}"`
      );
    }

    const env = this.buildEnv(options.env, dimensions);
    const shellArgs = this.getShellArgs(shell);
    const termName = env.TERM ?? 'xterm-256color';

    try {
      return spawnPty(shell, shellArgs, {
        cols: dimensions.cols,
        rows: dimensions.rows,
        cwd,
        env,
        name: termName,
      });
    } catch (error) {
      Logger.error('Failed to create PTY session with node-pty', error);
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  /**
   * Builds the environment variables for the shell process.
   *
   * Merges process.env with additional environment variables, sets TERM,
   * and includes COLUMNS and LINES based on terminal dimensions.
   * Only string values are included in the final environment.
   *
   * @param additionalEnv - Additional environment variables to merge
   * @param dimensions - Terminal dimensions for COLUMNS and LINES
   * @returns A sanitized environment object with only string values
   * @private
   */
  private buildEnv(
    additionalEnv: NodeJS.ProcessEnv | undefined,
    dimensions: Dimensions
  ): NodeJS.ProcessEnv {
    const merged = {
      ...process.env,
      ...additionalEnv,
      TERM: additionalEnv?.TERM || process.env.TERM || 'xterm-256color',
      COLUMNS: String(dimensions.cols),
      LINES: String(dimensions.rows),
    };

    const sanitized: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(merged)) {
      if (typeof value === 'string') {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  /**
   * Gets the appropriate command-line arguments for a shell based on the platform.
   *
   * - Windows: PowerShell uses `-NoLogo -NoExit`, cmd.exe uses `/d /q /k`
   * - Unix-like: bash/zsh/fish use `-i` for interactive mode
   *
   * @param shell - The shell executable path
   * @returns An array of shell arguments
   * @private
   */
  private getShellArgs(shell: string): string[] {
    if (process.platform === 'win32') {
      const normalized = shell.toLowerCase();
      if (normalized.includes('powershell')) {
        return ['-NoLogo', '-NoExit'];
      }
      return ['/d', '/q', '/k'];
    }
    const shellName = path.basename(shell);
    if (shellName === 'bash' || shellName === 'zsh' || shellName === 'fish') {
      return ['-i'];
    }
    return [];
  }

  /**
   * Gets the default shell for the current platform.
   *
   * - Windows: Uses COMSPEC environment variable or falls back to cmd.exe
   * - Unix-like: Uses SHELL environment variable or falls back to /bin/bash
   *
   * @returns The default shell executable path
   * @private
   */
  private getDefaultShell(): string {
    if (process.platform === 'win32') {
      return process.env.COMSPEC || 'C:\\Windows\\System32\\cmd.exe';
    }
    const userShell = process.env.SHELL;
    if (userShell && userShell.trim().length > 0) {
      return userShell;
    }
    return '/bin/bash';
  }

  /**
   * Gets information about all active sessions.
   *
   * @returns An array of session information objects, each containing id, pid, shell, and createdAt
   */
  getActiveSessions(): SessionInfo[] {
    return Array.from(this.sessionInfos.values());
  }

  /**
   * Gets current performance metrics for monitoring.
   *
   * @returns Performance metrics including session count and percentage of limit
   */
  getPerformanceMetrics(): PerformanceMetrics {
    const sessionCount = this.sessions.size;
    const maxSessions = SHARED_CONSTANTS.MAX_SESSIONS;
    const sessionCountPercentage =
      maxSessions > 0 ? (sessionCount / maxSessions) * 100 : 0;

    return {
      sessionCount,
      maxSessions,
      sessionCountPercentage,
    };
  }

  /**
   * Checks for performance warnings based on current metrics.
   *
   * @returns An array of warning messages if performance thresholds are exceeded
   */
  checkPerformanceWarnings(): string[] {
    const config = vscode.workspace.getConfiguration('aiTerminal');
    const monitoringEnabled = config.get<boolean>(
      'enablePerformanceMonitoring',
      true
    );

    if (!monitoringEnabled) {
      return [];
    }

    const warnings: string[] = [];
    const metrics = this.getPerformanceMetrics();

    // Warn if session count exceeds 80% of limit
    if (metrics.sessionCountPercentage >= 80) {
      warnings.push(
        `Session count is ${metrics.sessionCount}/${
          metrics.maxSessions
        } (${Math.round(metrics.sessionCountPercentage)}% of limit)`
      );
    }

    return warnings;
  }

  /**
   * Generates a cryptographically secure session ID using UUID v4
   * @returns A unique session identifier (UUID format)
   */
  private generateSessionId(): string {
    // Use crypto.randomUUID() for cryptographically secure random IDs
    // UUID alone is sufficient for uniqueness - no prefix needed
    return randomUUID();
  }
}
