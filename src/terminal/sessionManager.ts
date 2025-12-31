import {spawn as spawnChildProcess} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type {IPty} from 'node-pty';
import {spawn as spawnPty} from 'node-pty';
import {PROCESS_TERMINATION} from '../constants';
import {Logger} from '../utils/logger';
import {
  validateShellPath,
  validateTerminalDimensions,
  validateWorkingDirectory,
} from '../utils/validation';

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
 * Handles process lifecycle, input/output, and cleanup.
 */
class ShellSession implements vscode.Disposable {
  private killTimer?: NodeJS.Timeout;
  private disposed = false;

  /**
   * Creates a new shell session.
   *
   * @param id - Unique identifier for this session
   * @param pty - The PTY process instance
   */
  constructor(
    public readonly id: string,
    private readonly pty: IPty
  ) {}

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
   * Safe to call multiple times.
   */
  dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.clearKillTimer();
    this.killProcessTree();
  }

  private clearKillTimer() {
    if (this.killTimer) {
      clearTimeout(this.killTimer);
      this.killTimer = undefined;
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
        }, PROCESS_TERMINATION.SIGKILL_DELAY_MS);

        // Clear timer if process exits normally
        this.pty.onExit(() => this.clearKillTimer());
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
   * Creates a new terminal session.
   *
   * @param options - Session configuration options
   * @returns Session information including ID, PID, shell, and creation timestamp
   * @throws Error if session creation fails
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

    return {
      id,
      pid: ptyProcess.pid ?? undefined,
      shell,
      createdAt: Date.now(),
    };
  }

  write(id: string, data: string) {
    this.sessions.get(id)?.write(data);
  }

  resize(id: string, cols: number, rows: number) {
    this.sessions.get(id)?.resize(Math.max(cols, 2), Math.max(rows, 1));
  }

  getSessionCount() {
    return this.sessions.size;
  }

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

  private launchShellProcess(
    shell: string,
    dimensions: Dimensions,
    options: SessionOptions
  ): IPty {
    // Validate and sanitize working directory
    const requestedCwd = options.cwd ?? this.getDefaultCwd();
    const cwd = validateWorkingDirectory(requestedCwd) ?? this.getDefaultCwd();
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

  getActiveSessions(): SessionInfo[] {
    return Array.from(this.sessionInfos.values());
  }

  private getDefaultCwd(): string {
    const workspaceFolder = vscode.workspace.workspaceFolders?.find(
      (folder) => folder.uri.scheme === 'file'
    )?.uri.fsPath;
    if (workspaceFolder) {
      return workspaceFolder;
    }

    const envCandidates = [
      process.env.CURSOR_PROJECT_PATH,
      process.env.CURSOR_WORKSPACE_DIR,
      process.env.CURSOR_CWD,
      process.env.PWD,
      process.env.INIT_CWD,
    ];
    for (const candidate of envCandidates) {
      if (candidate && candidate.trim().length > 0) {
        return candidate;
      }
    }

    try {
      const cwd = process.cwd();
      if (cwd && cwd.trim().length > 0) {
        return cwd;
      }
    } catch {
      // ignore
    }

    return os.homedir();
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
