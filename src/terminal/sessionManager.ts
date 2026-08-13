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
  getDefaultShell,
  validateShellPath,
  validateStartupCommands,
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

class ShellSession implements vscode.Disposable {
  private killTimer?: NodeJS.Timeout;
  private exitListener?: vscode.Disposable;
  private disposed = false;

  constructor(public readonly id: string, private readonly pty: IPty) {}

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

  resize(cols: number, rows: number) {
    try {
      this.pty.resize(cols, rows);
    } catch (error) {
      // Log resize failures but don't throw - the session may be in the process of closing
      Logger.warn(`Failed to resize PTY (session ${this.id})`, error);
    }
  }

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
      try {
        spawnChildProcess('taskkill', ['/F', '/T', '/PID', String(pid)], {
          stdio: 'ignore',
        });
      } catch {
        this.pty.kill();
      }
    } else {
      try {
        // Negative PID kills the entire process group, not just the shell
        process.kill(-pid, 'SIGTERM');

        this.killTimer = setTimeout(() => {
          try {
            process.kill(-pid, 'SIGKILL');
          } catch {
            // already gone
          }
          this.killTimer = undefined;
        }, SHARED_CONSTANTS.PROCESS_TERMINATION.SIGKILL_DELAY_MS);

        this.exitListener = this.pty.onExit(() => this.clearKillTimer());
      } catch {
        try {
          this.pty.kill();
        } catch {
          // ignore
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

  createSession(options: SessionOptions = {}): SessionInfo {
    if (this.sessions.size >= SHARED_CONSTANTS.MAX_SESSIONS) {
      throw new Error(
        `Session limit reached (max: ${SHARED_CONSTANTS.MAX_SESSIONS})`
      );
    }

    const id = randomUUID();
    let shell = options.shell?.trim() || getDefaultShell();

    // Validate shell path for security
    if (!validateShellPath(shell)) {
      const fallback = getDefaultShell();
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
    const info: SessionInfo = {id, shell, createdAt: Date.now()};
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

    for (const cmd of validateStartupCommands(options.startupCommands ?? [])) {
      session.write(`${cmd}\r`);
    }

    // Return the same object stored in sessionInfos to avoid duplicate allocation
    return info;
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

  getActiveSessions(): SessionInfo[] {
    return Array.from(this.sessionInfos.values());
  }
}
