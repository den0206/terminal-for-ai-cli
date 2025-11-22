import {
  ChildProcessWithoutNullStreams,
  spawn,
  SpawnOptions,
  spawnSync,
} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import * as os from 'node:os';
import * as path from 'node:path';
import {Writable} from 'node:stream';
import * as vscode from 'vscode';
import {Logger} from '../utils/logger';
import {
  validateShellPath,
  validateTerminalDimensions,
  validateWorkingDirectory,
} from '../utils/validation';

const PYTHON_PTY_BRIDGE = String.raw`
import fcntl
import json
import os
import pty
import select
import signal
import struct
import sys
import termios


child_pid = None


def set_winsize(fd, rows, cols):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))


def signal_handler(signum, frame):
    """Handle SIGTERM by killing child process"""
    global child_pid
    if child_pid:
        try:
            os.kill(child_pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    sys.exit(0)


def main():
    global child_pid

    argv = sys.argv[1:]
    if not argv:
        sys.stderr.write('No shell specified for PTY bridge\n')
        sys.stderr.flush()
        sys.exit(1)

    # Set up signal handler to properly terminate child process
    signal.signal(signal.SIGTERM, signal_handler)

    rows = int(os.environ.get('AI_TERM_ROWS', '24') or '24')
    cols = int(os.environ.get('AI_TERM_COLS', '80') or '80')

    master_fd, slave_fd = pty.openpty()
    pid = os.fork()
    if pid == 0:
        try:
            os.setsid()
        except OSError:
            pass
        os.close(master_fd)
        os.dup2(slave_fd, 0)
        os.dup2(slave_fd, 1)
        os.dup2(slave_fd, 2)
        if slave_fd > 2:
            os.close(slave_fd)
        try:
            os.execvp(argv[0], argv)
        except OSError as exc:
            sys.stderr.write(f'Failed to launch {argv[0]}: {exc}\n')
            sys.stderr.flush()
            os._exit(1)

    child_pid = pid
    os.close(slave_fd)
    set_winsize(master_fd, rows, cols)
    control_fd = 3
    control_buffer = b''

    while True:
        read_fds = [master_fd, sys.stdin.fileno()]
        if control_fd >= 0:
            read_fds.append(control_fd)
        rlist, _, _ = select.select(read_fds, [], [])

        if master_fd in rlist:
            data = os.read(master_fd, 4096)
            if not data:
                break
            os.write(sys.stdout.fileno(), data)

        if sys.stdin.fileno() in rlist:
            data = os.read(sys.stdin.fileno(), 4096)
            if not data:
                os.close(master_fd)
                break
            os.write(master_fd, data)

        if control_fd >= 0 and control_fd in rlist:
            chunk = os.read(control_fd, 4096)
            if not chunk:
                os.close(control_fd)
                control_fd = -1
            else:
                control_buffer += chunk
                while b'\n' in control_buffer:
                    line, control_buffer = control_buffer.split(b'\n', 1)
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        cmd = json.loads(line.decode('utf-8'))
                    except Exception:
                        continue
                    if cmd.get('type') == 'resize':
                        rows = int(cmd.get('rows', rows) or rows)
                        cols = int(cmd.get('cols', cols) or cols)
                        set_winsize(master_fd, rows, cols)

    try:
        os.waitpid(pid, 0)
    finally:
        os.close(master_fd)


if __name__ == '__main__':
    main()
`;

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

type LaunchResult = {
  child: ChildProcessWithoutNullStreams;
  usesPtyHelper: boolean;
  resizeControl?: Writable;
};

class ShellSession implements vscode.Disposable {
  private readonly stdin = this.child.stdin;

  constructor(
    public readonly id: string,
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly usesPtyHelper: boolean,
    private readonly resizeControl?: Writable
  ) {}

  write(data: string) {
    if (!this.stdin.destroyed) {
      this.stdin.write(data);
    }
  }

  resize(cols: number, rows: number) {
    if (this.resizeControl && !this.resizeControl.destroyed) {
      try {
        this.resizeControl.write(
          `${JSON.stringify({type: 'resize', cols, rows})}\n`,
          'utf8'
        );
      } catch {
        // ignore resize errors
      }
      return;
    }
    // When we rely on the OS helper a SIGWINCH is enough to notify the wrapped shell.
    if (
      !this.usesPtyHelper ||
      !this.child.pid ||
      process.platform === 'win32'
    ) {
      return;
    }
    try {
      process.kill(this.child.pid, 'SIGWINCH');
    } catch {
      // ignore resize errors
    }
  }

  dispose() {
    this.killProcessTree();
    if (this.resizeControl && !this.resizeControl.destroyed) {
      this.resizeControl.end();
    }
  }

  private killProcessTree() {
    if (this.child.killed || !this.child.pid) {
      return;
    }

    const pid = this.child.pid;

    if (process.platform === 'win32') {
      // Windows: Use taskkill to terminate the entire process tree
      try {
        spawn('taskkill', ['/F', '/T', '/PID', String(pid)], {stdio: 'ignore'});
      } catch {
        // Fallback to standard kill
        this.child.kill();
      }
    } else {
      // Unix-like systems: Kill the process group
      try {
        // Send SIGTERM to the entire process group
        // Negative PID sends signal to the process group
        process.kill(-pid, 'SIGTERM');

        // Schedule SIGKILL if process doesn't terminate within 2 seconds
        const killTimer = setTimeout(() => {
          try {
            if (!this.child.killed) {
              process.kill(-pid, 'SIGKILL');
            }
          } catch {
            // Process already terminated
          }
        }, 2000);

        // Clear timer if process exits normally
        this.child.once('exit', () => clearTimeout(killTimer));
      } catch {
        // Fallback to standard kill if process group kill fails
        this.child.kill();
      }
    }
  }
}

export class SessionManager implements vscode.Disposable {
  private readonly sessions = new Map<string, ShellSession>();
  private readonly onDataEmitter = new vscode.EventEmitter<SessionDataEvent>();
  private readonly onExitEmitter = new vscode.EventEmitter<SessionExitEvent>();
  private pythonExecutable: string | null | undefined;
  private readonly sessionInfos = new Map<string, SessionInfo>();

  readonly onDidWriteData = this.onDataEmitter.event;
  readonly onDidExit = this.onExitEmitter.event;

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
    const {child, usesPtyHelper, resizeControl} = this.launchShellProcess(
      shell,
      dimensions,
      options
    );

    const session = new ShellSession(id, child, usesPtyHelper, resizeControl);
    this.sessions.set(id, session);
    const info: SessionInfo = {
      id,
      pid: child.pid ?? undefined,
      shell,
      createdAt: Date.now(),
    };
    this.sessionInfos.set(id, info);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (data: string) => {
      this.onDataEmitter.fire({id, data});
    });

    child.stderr.on('data', (data: string) => {
      this.onDataEmitter.fire({id, data});
    });

    child.on('close', (code, signal) => {
      this.sessions.delete(id);
      this.sessionInfos.delete(id);
      this.onExitEmitter.fire({id, code, signal});
    });

    for (const cmd of options.startupCommands ?? []) {
      if (cmd.trim().length > 0) {
        session.write(`${cmd}\r`);
      }
    }

    return {
      id,
      pid: child.pid ?? undefined,
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
    this.onDataEmitter.dispose();
    this.onExitEmitter.dispose();
  }

  private launchShellProcess(
    shell: string,
    dimensions: Dimensions,
    options: SessionOptions
  ): LaunchResult {
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
    const stdio: SpawnOptions['stdio'] = 'pipe';

    const python = this.getPythonExecutable();
    if (python && process.platform !== 'win32') {
      const pythonEnv = {
        ...env,
        AI_TERM_ROWS: String(dimensions.rows),
        AI_TERM_COLS: String(dimensions.cols),
      };
      const child = spawn(
        python,
        ['-u', '-c', PYTHON_PTY_BRIDGE, shell, ...shellArgs],
        {
          cwd,
          env: pythonEnv,
          stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
        }
      ) as ChildProcessWithoutNullStreams;
      const resizeControl = child.stdio?.[3] as Writable | undefined;
      if (resizeControl) {
        resizeControl.setDefaultEncoding?.('utf8');
        resizeControl.write(
          `${JSON.stringify({
            type: 'resize',
            cols: dimensions.cols,
            rows: dimensions.rows,
          })}\n`
        );
      }
      return {child, usesPtyHelper: true, resizeControl};
    }

    const child = spawn(shell, shellArgs, {
      cwd,
      env,
      stdio,
    }) as ChildProcessWithoutNullStreams;
    return {
      child: child as ChildProcessWithoutNullStreams,
      usesPtyHelper: false,
    };
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
   * Generates a cryptographically secure session ID
   * @returns A unique session identifier
   */
  private generateSessionId(): string {
    // Use crypto.randomUUID() for cryptographically secure random IDs
    return `session-${randomUUID()}`;
  }

  private getPythonExecutable(): string | null {
    if (this.pythonExecutable !== undefined) {
      return this.pythonExecutable;
    }
    if (process.platform === 'win32') {
      this.pythonExecutable = null;
      return null;
    }
    const candidates = ['python3', 'python'];
    for (const cmd of candidates) {
      try {
        const result = spawnSync(cmd, ['-c', 'import pty'], {stdio: 'ignore'});
        if (result.status === 0) {
          this.pythonExecutable = cmd;
          return cmd;
        }
      } catch {
        // ignore
      }
    }
    this.pythonExecutable = null;
    return null;
  }
}
