import type {IPty} from 'node-pty';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {MAX_SESSIONS} from '../constants';
import {SessionManager} from './sessionManager';

// Mock validation module to avoid platform-specific shell path validation
vi.mock('../utils/validation', async () => {
  const actual = await vi.importActual('../utils/validation');
  return {
    ...actual,
    validateShellPath: vi.fn((path: string) => path), // Return the path as-is for testing
    getDefaultShell: vi.fn(() => '/bin/sh'), // Return a consistent default for testing
  };
});

// Mock node-pty
const mockPty: IPty = {
  pid: 12345,
  cols: 80,
  rows: 24,
  write: vi.fn(),
  resize: vi.fn(),
  kill: vi.fn(),
  onData: vi.fn((callback: (data: string) => void) => {
    // Store callback for testing
    (
      mockPty as unknown as {_dataCallback?: (data: string) => void}
    )._dataCallback = callback;
    return {dispose: vi.fn()};
  }),
  onExit: vi.fn(
    (callback: (exit: {exitCode: number; signal?: number}) => void) => {
      // Store callback for testing
      (
        mockPty as unknown as {
          _exitCallback?: (exit: {exitCode: number; signal?: number}) => void;
        }
      )._exitCallback = callback;
      return {dispose: vi.fn()};
    }
  ),
} as unknown as IPty;

vi.mock('node-pty', () => ({
  spawn: vi.fn(() => mockPty),
}));

// Mock VS Code API
vi.mock('vscode', () => {
  class EventEmitter<T> {
    private listeners: Array<(e: T) => unknown> = [];

    event = (listener: (e: T) => unknown) => {
      this.listeners.push(listener);
      return {
        dispose: () => {
          const index = this.listeners.indexOf(listener);
          if (index > -1) {
            this.listeners.splice(index, 1);
          }
        },
      };
    };

    fire(data: T) {
      this.listeners.forEach((listener) => listener(data));
    }

    dispose() {
      this.listeners = [];
    }
  }

  return {
    workspace: {
      workspaceFolders: [
        {
          uri: {
            scheme: 'file',
            fsPath: '/test/workspace',
          },
        },
      ],
    },
    EventEmitter,
  };
});

describe('SessionManager', () => {
  let sessionManager: SessionManager;
  let currentMockPty: typeof mockPty;

  beforeEach(() => {
    sessionManager = new SessionManager();
    // Reset mock and store reference
    currentMockPty = mockPty;
    vi.clearAllMocks();
    // Reset callbacks
    (
      mockPty as unknown as {_dataCallback?: (data: string) => void}
    )._dataCallback = undefined;
    (
      mockPty as unknown as {
        _exitCallback?: (exit: {exitCode: number; signal?: number}) => void;
      }
    )._exitCallback = undefined;
  });

  afterEach(() => {
    sessionManager.dispose();
  });

  describe('createSession', () => {
    it('should create a new session with default options', () => {
      const info = sessionManager.createSession();

      expect(info).toBeDefined();
      expect(info.id).toBeTruthy();
      expect(typeof info.id).toBe('string');
      expect(info.shell).toBeTruthy();
      expect(sessionManager.getSessionCount()).toBe(1);
    });

    it('should create a session with custom shell', () => {
      // Use /bin/sh which exists on all Unix-like systems including CI environments
      const customShell = '/bin/sh';
      const info = sessionManager.createSession({shell: customShell});

      expect(info.shell).toBe(customShell);
    });

    it('should create a session with custom dimensions', () => {
      const info = sessionManager.createSession({
        cols: 120,
        rows: 30,
      });

      expect(info).toBeDefined();
    });

    it('should create a session with startup commands', () => {
      const startupCommands = ['echo "hello"', 'pwd'];
      const info = sessionManager.createSession({startupCommands});

      expect(info).toBeDefined();
      // Verify write was called for each command
      expect(mockPty.write).toHaveBeenCalled();
    });

    it('should generate unique session IDs', () => {
      const info1 = sessionManager.createSession();
      const info2 = sessionManager.createSession();

      expect(info1.id).not.toBe(info2.id);
    });

    it('should limit sessions to MAX_SESSIONS', () => {
      // Create maximum sessions
      for (let i = 0; i < MAX_SESSIONS; i++) {
        sessionManager.createSession();
      }

      expect(sessionManager.getSessionCount()).toBe(MAX_SESSIONS);
    });
  });

  describe('write', () => {
    it('should write data to an existing session', () => {
      const info = sessionManager.createSession();
      const testData = 'test data\n';

      sessionManager.write(info.id, testData);

      expect(mockPty.write).toHaveBeenCalledWith(testData);
    });

    it('should not throw when writing to non-existent session', () => {
      expect(() => {
        sessionManager.write('non-existent-id', 'data');
      }).not.toThrow();
    });
  });

  describe('resize', () => {
    it('should resize an existing session', () => {
      const info = sessionManager.createSession();
      const cols = 120;
      const rows = 30;

      sessionManager.resize(info.id, cols, rows);

      expect(mockPty.resize).toHaveBeenCalledWith(cols, rows);
    });

    it('should enforce minimum dimensions', () => {
      const info = sessionManager.createSession();

      sessionManager.resize(info.id, 1, 0);

      // Should be clamped to minimum values
      expect(mockPty.resize).toHaveBeenCalledWith(2, 1);
    });

    it('should not throw when resizing non-existent session', () => {
      expect(() => {
        sessionManager.resize('non-existent-id', 80, 24);
      }).not.toThrow();
    });
  });

  describe('disposeSession', () => {
    it('should dispose a session and remove it from the manager', () => {
      const info = sessionManager.createSession();
      expect(sessionManager.getSessionCount()).toBe(1);

      sessionManager.disposeSession(info.id);

      expect(sessionManager.getSessionCount()).toBe(0);
      // Note: kill() might not be called on Windows if process.kill is used instead
      // Just verify the session was removed
    });

    it('should not throw when disposing non-existent session', () => {
      expect(() => {
        sessionManager.disposeSession('non-existent-id');
      }).not.toThrow();
    });
  });

  describe('getSessionCount', () => {
    it('should return 0 for empty manager', () => {
      expect(sessionManager.getSessionCount()).toBe(0);
    });

    it('should return correct count after creating sessions', () => {
      sessionManager.createSession();
      expect(sessionManager.getSessionCount()).toBe(1);

      sessionManager.createSession();
      expect(sessionManager.getSessionCount()).toBe(2);
    });

    it('should return correct count after disposing sessions', () => {
      const info1 = sessionManager.createSession();
      const info2 = sessionManager.createSession();
      expect(sessionManager.getSessionCount()).toBe(2);

      sessionManager.disposeSession(info1.id);
      expect(sessionManager.getSessionCount()).toBe(1);

      sessionManager.disposeSession(info2.id);
      expect(sessionManager.getSessionCount()).toBe(0);
    });
  });

  describe('getActiveSessions', () => {
    it('should return empty array for empty manager', () => {
      expect(sessionManager.getActiveSessions()).toEqual([]);
    });

    it('should return all active sessions', () => {
      const info1 = sessionManager.createSession();
      const info2 = sessionManager.createSession();

      const activeSessions = sessionManager.getActiveSessions();

      expect(activeSessions).toHaveLength(2);
      expect(activeSessions.map((s) => s.id)).toContain(info1.id);
      expect(activeSessions.map((s) => s.id)).toContain(info2.id);
    });

    it('should not include disposed sessions', () => {
      const info1 = sessionManager.createSession();
      const info2 = sessionManager.createSession();

      sessionManager.disposeSession(info1.id);

      const activeSessions = sessionManager.getActiveSessions();
      expect(activeSessions).toHaveLength(1);
      expect(activeSessions[0]?.id).toBe(info2.id);
    });
  });

  describe('dispose', () => {
    it('should dispose all sessions', () => {
      sessionManager.createSession();
      sessionManager.createSession();
      expect(sessionManager.getSessionCount()).toBe(2);

      sessionManager.dispose();

      expect(sessionManager.getSessionCount()).toBe(0);
    });

    it('should be safe to call multiple times', () => {
      sessionManager.createSession();
      sessionManager.dispose();
      sessionManager.dispose();

      expect(sessionManager.getSessionCount()).toBe(0);
    });
  });

  describe('event emitters', () => {
    it('should emit data events when PTY writes data', async () => {
      const info = sessionManager.createSession();
      const testData = 'test output\n';

      const eventPromise = new Promise<{id: string; data: string}>(
        (resolve, reject) => {
          const disposable = sessionManager.onDidWriteData((event) => {
            resolve(event);
            disposable.dispose();
          });

          // Set timeout to fail if event doesn't fire
          setTimeout(() => {
            reject(new Error('Event did not fire within timeout'));
          }, 1000);
        }
      );

      // Wait a bit for the event listener to be set up
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Simulate PTY data event
      const dataCallback = (
        currentMockPty as unknown as {_dataCallback?: (data: string) => void}
      )._dataCallback;
      if (dataCallback) {
        dataCallback(testData);
      } else {
        throw new Error('Data callback was not set');
      }

      const event = await eventPromise;
      expect(event.id).toBe(info.id);
      expect(event.data).toBe(testData);
    });

    it('should emit exit events when PTY exits', async () => {
      const info = sessionManager.createSession();

      const eventPromise = new Promise<{
        id: string;
        code: number | null;
        signal: NodeJS.Signals | null;
      }>((resolve, reject) => {
        const disposable = sessionManager.onDidExit((event) => {
          resolve(event);
          disposable.dispose();
        });

        // Set timeout to fail if event doesn't fire
        setTimeout(() => {
          reject(new Error('Event did not fire within timeout'));
        }, 1000);
      });

      // Wait a bit for the event listener to be set up
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Simulate PTY exit event
      const exitCallback = (
        currentMockPty as unknown as {
          _exitCallback?: (exit: {exitCode: number; signal?: number}) => void;
        }
      )._exitCallback;
      if (exitCallback) {
        exitCallback({exitCode: 0});
      } else {
        throw new Error('Exit callback was not set');
      }

      const event = await eventPromise;
      expect(event.id).toBe(info.id);
      expect(event.code).toBe(0);
    });
  });
});
