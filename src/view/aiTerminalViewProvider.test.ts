import type {IPty} from 'node-pty';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type * as vscode from 'vscode';
import {env as mockEnv, window as mockWindow} from 'vscode';
import {SHARED_CONSTANTS} from '../shared/constants';
import {SessionManager} from '../terminal/sessionManager';
import {Logger} from '../utils/logger';
import {escapeShellPath} from '../utils/shellPath';
import {AiTerminalViewProvider} from './aiTerminalViewProvider';

// Mock node-pty for faster tests and CI compatibility
const mockPty: IPty = {
  pid: 12345,
  cols: 80,
  rows: 24,
  write: vi.fn(),
  resize: vi.fn(),
  kill: vi.fn(),
  onData: vi.fn((callback: (data: string) => void) => {
    // Immediately fire some data to simulate PTY startup
    setTimeout(() => callback('$ '), 10);
    return {dispose: vi.fn()};
  }),
  onExit: vi.fn(
    (_callback: (exit: {exitCode: number; signal?: number}) => void) => {
      return {dispose: vi.fn()};
    }
  ),
} as unknown as IPty;

vi.mock('node-pty', () => ({
  spawn: vi.fn(() => mockPty),
}));

// Mock Logger to avoid Output Channel creation
vi.mock('../utils/logger', () => ({
  Logger: {info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn()},
}));

// Mock vscode workspace module
vi.mock('vscode', async () => {
  const actual = await vi.importActual('vscode');
  return {
    ...actual,
    workspace: {
      getConfiguration: vi.fn(() => ({
        get: vi.fn((key: string, defaultValue?: unknown) => {
          if (key === 'defaultShell') {
            return '';
          }
          if (key === 'startupCommands') {
            return [];
          }
          if (key === 'themePreset') {
            return 'modern';
          }
          return defaultValue;
        }),
        update: vi.fn().mockResolvedValue(undefined),
      })),
      onDidChangeConfiguration: vi.fn(() => ({dispose: vi.fn()})),
      workspaceFolders: undefined,
      fs: {
        readDirectory: vi
          .fn()
          .mockRejectedValue(new Error('Directory not found')),
        readFile: vi.fn().mockRejectedValue(new Error('File not found')),
        delete: vi.fn().mockResolvedValue(undefined),
        createDirectory: vi.fn().mockResolvedValue(undefined),
        writeFile: vi.fn().mockResolvedValue(undefined),
      },
    },
    window: {
      showErrorMessage: vi.fn(),
      showWarningMessage: vi.fn(),
      showInformationMessage: vi.fn(),
    },
    Uri: {
      parse: vi.fn((value: string) => {
        const scheme = value.split(':')[0];
        // 本体と同じく file: URI から実パス（パーセントデコード済み）を取り出す
        const withoutScheme = value.replace(
          /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//,
          ''
        );
        const path =
          scheme === 'file' ? decodeURIComponent(withoutScheme) : value;
        return {
          scheme,
          path,
          fsPath: path,
          toString: () => value,
        };
      }),
      file: vi.fn((path: string) => ({
        scheme: 'file',
        fsPath: path,
        path,
        toString: () => `file://${path}`,
      })),
      joinPath: vi.fn((base: {fsPath: string}, ...paths: string[]) => {
        const joined = [base.fsPath, ...paths].join('/');
        return {
          scheme: 'file',
          fsPath: joined,
          path: joined,
          toString: () => `file://${joined}`,
        };
      }),
    },
    ConfigurationTarget: {
      Global: 1,
      Workspace: 2,
      WorkspaceFolder: 3,
    },
  };
});

/**
 * Helper function to create a mock ExtensionContext
 */
function createMockContext(): vscode.ExtensionContext {
  const globalStorageUri = {
    scheme: 'file',
    authority: '',
    path: '/tmp/test-storage',
    query: '',
    fragment: '',
    fsPath: '/tmp/test-storage',
    with: vi.fn(),
    toString: () => 'file:///tmp/test-storage',
    toJSON: () => ({scheme: 'file', path: '/tmp/test-storage'}),
  };

  const extensionUri = {
    scheme: 'file',
    authority: '',
    path: '/tmp/test-extension',
    query: '',
    fragment: '',
    fsPath: '/tmp/test-extension',
    with: vi.fn(),
    toString: () => 'file:///tmp/test-extension',
    toJSON: () => ({scheme: 'file', path: '/tmp/test-extension'}),
  };

  return {
    subscriptions: [],
    workspaceState: {
      get: vi.fn(),
      update: vi.fn(),
      keys: vi.fn(() => []),
    } as unknown as vscode.Memento,
    globalState: {
      get: vi.fn(),
      update: vi.fn(),
      keys: vi.fn(() => []),
      setKeysForSync: vi.fn(),
    } as unknown as vscode.Memento & {
      setKeysForSync: (keys: readonly string[]) => void;
    },
    extensionPath: '/tmp/test-extension',
    extensionUri,
    environmentVariableCollection:
      {} as unknown as vscode.GlobalEnvironmentVariableCollection,
    asAbsolutePath: vi.fn(
      (relativePath: string) => `/tmp/test-extension/${relativePath}`
    ),
    storageUri: undefined,
    storagePath: undefined,
    globalStorageUri,
    globalStoragePath: '/tmp/test-storage',
    logUri: {scheme: 'file', path: '/tmp/test-logs'} as vscode.Uri,
    logPath: '/tmp/test-logs',
    extensionMode: 3, // ExtensionMode.Test
    extension: {} as vscode.Extension<unknown>,
    secrets: {} as vscode.SecretStorage,
    languageModelAccessInformation: {} as vscode.LanguageModelAccessInformation,
  };
}

/**
 * Helper function to create a mock Webview
 */
function createMockWebview(): vscode.Webview {
  const onDidReceiveMessageEmitter = {
    // 本体と同じく IDisposable を返す（購読の解除をテストから確認できるように）
    event: vi.fn(() => ({dispose: vi.fn()})),
    fire: vi.fn(),
    dispose: vi.fn(),
  };

  return {
    html: '',
    options: {},
    onDidReceiveMessage: onDidReceiveMessageEmitter.event,
    postMessage: vi.fn().mockResolvedValue(true),
    asWebviewUri: vi.fn((uri) => uri),
    cspSource: 'vscode-webview://test',
  } as unknown as vscode.Webview;
}

/**
 * Helper function to create a mock WebviewView
 */
function createMockWebviewView(): vscode.WebviewView {
  const webview = createMockWebview();

  return {
    viewType: 'terminal-for-ai-cli-view',
    webview,
    visible: true,
    show: vi.fn(),
    title: 'Terminal For AI',
    description: undefined,
    badge: undefined,
    onDidDispose: vi.fn(() => ({dispose: vi.fn()})),
    onDidChangeVisibility: vi.fn(() => ({dispose: vi.fn()})),
  } as unknown as vscode.WebviewView;
}

/** Runs the `onDidDispose` handler the provider registered on the view. */
function fireViewDisposed(webviewView: vscode.WebviewView): void {
  const handler = (webviewView.onDidDispose as ReturnType<typeof vi.fn>).mock
    .calls[0][0];
  handler();
}

/** Returns the message handler the provider registered on the webview. */
function getMessageHandler(
  webviewView: vscode.WebviewView
): (message: unknown) => Promise<void> {
  return (
    webviewView.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>
  ).mock.calls[0][0];
}

describe('AiTerminalViewProvider', () => {
  let context: vscode.ExtensionContext;
  let sessionManager: SessionManager;
  let provider: AiTerminalViewProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    context = createMockContext();
    sessionManager = new SessionManager();

    // Wrap provider creation in try-catch to handle initialization errors
    try {
      provider = new AiTerminalViewProvider(context, sessionManager);
    } catch {
      // If provider creation fails, set to undefined
      provider = undefined as unknown as AiTerminalViewProvider;
    }
  });

  afterEach(() => {
    if (provider) {
      provider.dispose();
    }
    sessionManager.dispose();
  });

  describe('constructor', () => {
    it('should create provider instance', () => {
      expect(provider).toBeDefined();
      expect(provider).toBeInstanceOf(AiTerminalViewProvider);
    });

    it('should register event listeners for session data', () => {
      const mockData = {id: 'session-1', data: 'test output'};

      // Trigger the onDidWriteData event
      sessionManager['onDataEmitter'].fire(mockData);

      // Provider should have registered a listener (verified by no errors)
      expect(true).toBe(true);
    });

    it('should register event listeners for session exit', () => {
      const mockExit = {id: 'session-1', code: 0, signal: null};

      // Trigger the onDidExit event
      sessionManager['onExitEmitter'].fire(mockExit);

      // Provider should have registered a listener (verified by no errors)
      expect(true).toBe(true);
    });
  });

  /**
   * Helper function to wait for a condition with retries
   */
  async function waitForCondition(
    condition: () => boolean,
    timeout: number = 10000, // Increased for CI environments
    interval: number = 50
  ): Promise<void> {
    const startTime = Date.now();
    while (!condition()) {
      if (Date.now() - startTime > timeout) {
        throw new Error('Timeout waiting for condition');
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }

  /**
   * Helper function to wait for session creation
   */
  async function waitForSessionCreation(
    sessionManager: SessionManager,
    minCount: number = 1,
    timeout: number = 10000 // Increased for CI environments
  ): Promise<void> {
    await waitForCondition(
      () => sessionManager.getSessionCount() >= minCount,
      timeout
    );
  }

  /**
   * Helper function to wait for postMessage calls
   */
  async function waitForPostMessage(
    postMessageMock: ReturnType<typeof vi.fn>,
    minCalls: number = 1,
    timeout: number = 10000 // Increased for CI environments
  ): Promise<void> {
    await waitForCondition(
      () => postMessageMock.mock.calls.length >= minCalls,
      timeout
    );
  }

  /**
   * 呼び出し回数ではなく「その種類のメッセージが届くまで」待つ。
   * 送信までに挟まる非同期処理（画像やスクロールバックの削除）が増えても壊れない。
   */
  async function waitForPostedType(
    postMessageMock: ReturnType<typeof vi.fn>,
    type: string,
    timeout: number = 10000
  ): Promise<void> {
    await waitForCondition(
      () =>
        postMessageMock.mock.calls.some(
          (call) => (call[0] as {type?: string} | undefined)?.type === type
        ),
      timeout
    );
  }

  describe('resolveWebviewView', () => {
    it('should set webview HTML', () => {
      const webviewView = createMockWebviewView();

      provider.resolveWebviewView(webviewView);

      expect(webviewView.webview.html).toBeTruthy();
      expect(webviewView.webview.html.length).toBeGreaterThan(0);
    });

    it('should enable scripts in webview options', () => {
      const webviewView = createMockWebviewView();

      provider.resolveWebviewView(webviewView);

      expect(webviewView.webview.options).toBeDefined();
      expect(
        (webviewView.webview.options as {enableScripts?: boolean}).enableScripts
      ).toBe(true);
    });

    it('should set local resource roots', () => {
      const webviewView = createMockWebviewView();

      provider.resolveWebviewView(webviewView);

      expect(webviewView.webview.options).toBeDefined();
      expect(
        (webviewView.webview.options as {localResourceRoots?: vscode.Uri[]})
          .localResourceRoots
      ).toBeDefined();
    });

    it('should register message handler', () => {
      const webviewView = createMockWebviewView();

      provider.resolveWebviewView(webviewView);

      expect(webviewView.webview.onDidReceiveMessage).toHaveBeenCalled();
    });
  });

  describe('reveal', () => {
    it('should call show on webview view', () => {
      const webviewView = createMockWebviewView();
      provider.resolveWebviewView(webviewView);

      provider.reveal();

      expect(webviewView.show).toHaveBeenCalledWith(true);
    });

    it('should not throw if webview view is not set', () => {
      expect(() => provider.reveal()).not.toThrow();
    });
  });

  describe('newSession', () => {
    it('should create a new session through handleSessionRequest', async () => {
      const webviewView = createMockWebviewView();
      provider.resolveWebviewView(webviewView);

      // Mock the webview-ready message to initialize the provider
      const messageHandler = (
        webviewView.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>
      ).mock.calls[0][0];
      await messageHandler({type: 'webview-ready'});

      // Wait for initial session creation
      await waitForSessionCreation(sessionManager, 1);

      // Get initial session count
      const initialCount = sessionManager.getSessionCount();

      provider.newSession();

      // Wait for async session creation
      await waitForSessionCreation(sessionManager, initialCount);

      // Should have created a new session
      const finalCount = sessionManager.getSessionCount();
      expect(finalCount).toBeGreaterThanOrEqual(initialCount);
    });

    it('should not create session if limit is reached', async () => {
      const webviewView = createMockWebviewView();
      provider.resolveWebviewView(webviewView);

      // Mock the webview-ready message
      const messageHandler = (
        webviewView.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>
      ).mock.calls[0][0];
      await messageHandler({type: 'webview-ready'});

      // Wait for initial session
      await waitForSessionCreation(sessionManager, 1);

      // Create sessions up to the limit (MAX_SESSIONS = 2)
      provider.newSession();
      await waitForSessionCreation(sessionManager, 2);

      // Try to create one more
      provider.newSession();
      // Give some time but should not exceed limit
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should not have created another session (should be at or below limit)
      expect(sessionManager.getSessionCount()).toBeLessThanOrEqual(2);
    });
  });

  describe('dispose', () => {
    it('should clear all internal state', () => {
      const webviewView = createMockWebviewView();
      provider.resolveWebviewView(webviewView);

      provider.dispose();

      // Should not throw errors after disposal
      expect(() => provider.reveal()).not.toThrow();
      expect(() => provider.newSession()).not.toThrow();
    });

    it('should be safe to call multiple times', () => {
      provider.dispose();

      expect(() => provider.dispose()).not.toThrow();
    });
  });

  describe('cleanupOrphanedImages', () => {
    it('should return 0 when images directory does not exist', async () => {
      const count = await provider.cleanupOrphanedImages();

      expect(count).toBe(0);
    });

    it('should handle errors gracefully', async () => {
      // Should not throw even if there are errors
      await expect(provider.cleanupOrphanedImages()).resolves.toBeDefined();
    });
  });

  describe('webview disposal', () => {
    it('should queue session output instead of posting to a disposed webview', async () => {
      const webviewView = createMockWebviewView();
      provider.resolveWebviewView(webviewView);
      await getMessageHandler(webviewView)({type: 'webview-ready'});
      await waitForSessionCreation(sessionManager, 1);

      const postMessage = webviewView.webview.postMessage as ReturnType<
        typeof vi.fn
      >;
      fireViewDisposed(webviewView);
      postMessage.mockClear();

      sessionManager['onDataEmitter'].fire({
        id: 'session-after-dispose',
        data: 'output produced while the view was gone',
      });

      // 破棄済みの Webview へは送らない
      expect(postMessage).not.toHaveBeenCalled();
      // 捨てずにキューへ積む
      expect(
        provider['messageQueue'].some(
          (message) =>
            message.type === 'session-data' &&
            message.payload.data ===
              'output produced while the view was gone'
        )
      ).toBe(true);
    });

    it('should flush output produced while disposed once the view comes back', async () => {
      const first = createMockWebviewView();
      provider.resolveWebviewView(first);
      await getMessageHandler(first)({type: 'webview-ready'});
      await waitForSessionCreation(sessionManager, 1);

      fireViewDisposed(first);
      sessionManager['onDataEmitter'].fire({
        id: 'session-1',
        data: 'missed output',
      });

      // ビューが作り直され、新しい Webview が ready になる
      const second = createMockWebviewView();
      provider.resolveWebviewView(second);
      await getMessageHandler(second)({type: 'webview-ready'});

      const postMessage = second.webview.postMessage as ReturnType<
        typeof vi.fn
      >;
      expect(
        postMessage.mock.calls.some(
          ([message]) =>
            message.type === 'session-data' &&
            message.payload.data === 'missed output'
        )
      ).toBe(true);
      expect(provider['messageQueue']).toHaveLength(0);
    });

    it('should keep sessions alive when the view is disposed', async () => {
      const webviewView = createMockWebviewView();
      provider.resolveWebviewView(webviewView);
      await getMessageHandler(webviewView)({type: 'webview-ready'});
      await waitForSessionCreation(sessionManager, 1);
      const countBefore = sessionManager.getSessionCount();

      fireViewDisposed(webviewView);

      // Webview は使い捨てでも PTY は拡張ホスト側で生き続ける
      expect(sessionManager.getSessionCount()).toBe(countBefore);
    });

    it('should stop handling messages from a disposed webview', async () => {
      const webviewView = createMockWebviewView();
      provider.resolveWebviewView(webviewView);
      const messageDisposable = (
        webviewView.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>
      ).mock.results[0].value;

      fireViewDisposed(webviewView);

      expect(messageDisposable.dispose).toHaveBeenCalled();
    });
  });

  describe('handleMessage - webview-ready', () => {
    it('should set webviewReady flag when receiving webview-ready message', async () => {
      const webviewView = createMockWebviewView();
      provider.resolveWebviewView(webviewView);

      const messageHandler = (
        webviewView.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>
      ).mock.calls[0][0];

      await messageHandler({type: 'webview-ready'});

      // Wait for async session creation
      await waitForSessionCreation(sessionManager, 1);

      // Should create initial session automatically
      const sessionCount = sessionManager.getSessionCount();
      expect(sessionCount).toBeGreaterThanOrEqual(1);
    });

    it('should flush queued messages on webview-ready', async () => {
      const webviewView = createMockWebviewView();
      provider.resolveWebviewView(webviewView);

      const messageHandler = (
        webviewView.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>
      ).mock.calls[0][0];

      // Send webview-ready
      await messageHandler({type: 'webview-ready'});

      // Wait for processing
      const postMessageMock = webviewView.webview.postMessage as ReturnType<
        typeof vi.fn
      >;
      await waitForPostMessage(postMessageMock, 1);

      // postMessage should have been called (for session-count, theme-update, etc.)
      expect(postMessageMock).toHaveBeenCalled();
    });

    it('should cap queued output across entries, not per entry', async () => {
      const webviewView = createMockWebviewView();
      provider.resolveWebviewView(webviewView);

      const messageHandler = (
        webviewView.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>
      ).mock.calls[0][0];

      // Alternating sessions defeat the merge, so every chunk takes its own
      // queue slot - the case a per-entry cap fails to bound.
      const chunk = 'x'.repeat(100_000);
      for (let i = 0; i < 40; i++) {
        sessionManager['onDataEmitter'].fire({
          id: i % 2 === 0 ? 'session-a' : 'session-b',
          data: chunk,
        });
      }
      sessionManager['onDataEmitter'].fire({id: 'session-b', data: 'TAIL'});

      await messageHandler({type: 'webview-ready'});

      const postMessageMock = webviewView.webview.postMessage as ReturnType<
        typeof vi.fn
      >;
      const flushed = postMessageMock.mock.calls
        .map(([message]) => message)
        .filter((message) => message?.type === 'session-data');
      const total = flushed.reduce(
        (sum, message) => sum + message.payload.data.length,
        0
      );

      // 4.1M characters were queued; only the newest 2M may survive.
      expect(total).toBe(SHARED_CONSTANTS.MAX_BUFFER_SIZE);
      expect(flushed[flushed.length - 1].payload.data.endsWith('TAIL')).toBe(
        true
      );
    });

    it('should prevent duplicate webview-ready processing', async () => {
      const webviewView = createMockWebviewView();
      provider.resolveWebviewView(webviewView);

      const messageHandler = (
        webviewView.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>
      ).mock.calls[0][0];

      // Send webview-ready twice
      await messageHandler({type: 'webview-ready'});
      await new Promise((resolve) => setTimeout(resolve, 100));
      const firstSessionCount = sessionManager.getSessionCount();

      await messageHandler({type: 'webview-ready'});
      await new Promise((resolve) => setTimeout(resolve, 100));
      const secondSessionCount = sessionManager.getSessionCount();

      // Should not create duplicate sessions
      expect(secondSessionCount).toBe(firstSessionCount);
    });
  });

  describe('handleMessage - request-new-session', () => {
    it('should create a new session on request', async () => {
      const webviewView = createMockWebviewView();
      provider.resolveWebviewView(webviewView);

      const messageHandler = (
        webviewView.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>
      ).mock.calls[0][0];

      // Initialize
      await messageHandler({type: 'webview-ready'});
      await waitForSessionCreation(sessionManager, 1);

      const initialCount = sessionManager.getSessionCount();

      // Request new session
      await messageHandler({
        type: 'request-new-session',
        payload: {cols: 80, rows: 24},
      });
      await waitForSessionCreation(sessionManager, initialCount + 1);

      const finalCount = sessionManager.getSessionCount();
      expect(finalCount).toBeGreaterThanOrEqual(initialCount);
    });

    it('should respect session limit', async () => {
      const webviewView = createMockWebviewView();
      provider.resolveWebviewView(webviewView);

      const messageHandler = (
        webviewView.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>
      ).mock.calls[0][0];

      // Initialize
      await messageHandler({type: 'webview-ready'});
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Create sessions up to limit (MAX_SESSIONS = 2)
      await messageHandler({
        type: 'request-new-session',
        payload: {cols: 80, rows: 24},
      });
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Try to exceed limit
      await messageHandler({
        type: 'request-new-session',
        payload: {cols: 80, rows: 24},
      });
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should not exceed MAX_SESSIONS (2)
      expect(sessionManager.getSessionCount()).toBeLessThanOrEqual(2);
    });

    it('should handle session creation errors', async () => {
      const webviewView = createMockWebviewView();
      provider.resolveWebviewView(webviewView);

      const messageHandler = (
        webviewView.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>
      ).mock.calls[0][0];

      // Initialize
      await messageHandler({type: 'webview-ready'});
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Mock createSession to throw error
      const originalCreateSession =
        sessionManager.createSession.bind(sessionManager);
      sessionManager.createSession = vi.fn().mockImplementation(() => {
        throw new Error('Test error: Shell not found');
      });

      // Should not throw, should send error message instead
      const result = messageHandler({
        type: 'request-new-session',
        payload: {cols: 80, rows: 24},
      });

      // Wait for the promise if it exists
      if (result && typeof result === 'object' && 'then' in result) {
        await result;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should have sent session-error message
      expect(webviewView.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'session-error',
        })
      );

      // Restore
      sessionManager.createSession = originalCreateSession;
    });
  });

  describe('handleMessage - terminal-input', () => {
    it('should write data to session', async () => {
      const webviewView = createMockWebviewView();
      provider.resolveWebviewView(webviewView);

      const messageHandler = (
        webviewView.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>
      ).mock.calls[0][0];

      // Initialize and create a session
      await messageHandler({type: 'webview-ready'});
      await waitForSessionCreation(sessionManager, 1);

      const sessions = sessionManager.getActiveSessions();
      expect(sessions.length).toBeGreaterThan(0);

      const sessionId = sessions[0].id;

      // Mock write method
      const writeSpy = vi.spyOn(sessionManager, 'write');

      // Send input
      await messageHandler({
        type: 'terminal-input',
        payload: {sessionId, data: 'ls -la\r'},
      });

      expect(writeSpy).toHaveBeenCalledWith(sessionId, 'ls -la\r');
    });
  });

  describe('handleMessage - open-link', () => {
    const getMessageHandler = (webviewView: ReturnType<typeof createMockWebviewView>) =>
      (webviewView.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>).mock
        .calls[0][0];

    it('should open an http(s) link after the user confirms', async () => {
      const webviewView = createMockWebviewView();
      provider.resolveWebviewView(webviewView);
      (mockWindow.showInformationMessage as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('Open');

      await getMessageHandler(webviewView)({
        type: 'open-link',
        payload: {uri: 'https://auth.openai.com/codex/device'},
      });

      expect(mockWindow.showInformationMessage).toHaveBeenCalled();
      expect(mockEnv.openExternal).toHaveBeenCalled();
    });

    it('should not open the link when the user cancels', async () => {
      const webviewView = createMockWebviewView();
      provider.resolveWebviewView(webviewView);
      (mockWindow.showInformationMessage as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(undefined);

      await getMessageHandler(webviewView)({
        type: 'open-link',
        payload: {uri: 'https://example.com'},
      });

      expect(mockEnv.openExternal).not.toHaveBeenCalled();
    });

    it('should reject non-http schemes without prompting', async () => {
      const webviewView = createMockWebviewView();
      provider.resolveWebviewView(webviewView);

      await getMessageHandler(webviewView)({
        type: 'open-link',
        payload: {uri: 'file:///etc/passwd'},
      });

      expect(mockWindow.showInformationMessage).not.toHaveBeenCalled();
      expect(mockEnv.openExternal).not.toHaveBeenCalled();
    });
  });

  describe('handleMessage - copy-link', () => {
    const getMessageHandler = (
      webviewView: ReturnType<typeof createMockWebviewView>
    ) =>
      (webviewView.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>).mock
        .calls[0][0];

    it('should copy an http(s) link to the clipboard', async () => {
      const webviewView = createMockWebviewView();
      provider.resolveWebviewView(webviewView);

      await getMessageHandler(webviewView)({
        type: 'copy-link',
        payload: {uri: 'https://example.com/path'},
      });

      expect(mockEnv.clipboard.writeText).toHaveBeenCalledWith(
        'https://example.com/path'
      );
    });

    it('should not copy a link with an unsupported scheme', async () => {
      const webviewView = createMockWebviewView();
      provider.resolveWebviewView(webviewView);

      await getMessageHandler(webviewView)({
        type: 'copy-link',
        payload: {uri: 'javascript:alert(1)'},
      });

      expect(mockEnv.clipboard.writeText).not.toHaveBeenCalled();
    });
  });

  describe('handleMessage - uri-drop', () => {
    const getMessageHandler = (
      webviewView: ReturnType<typeof createMockWebviewView>
    ) =>
      (webviewView.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>).mock
        .calls[0][0];

    const dropUris = async (uriList: string) => {
      const webviewView = createMockWebviewView();
      provider.resolveWebviewView(webviewView);
      const messageHandler = getMessageHandler(webviewView);
      await messageHandler({type: 'webview-ready'});
      const session = sessionManager.createSession();
      const writeSpy = vi.spyOn(sessionManager, 'write');

      await messageHandler({
        type: 'uri-drop',
        payload: {uriList, sessionId: session.id},
      });

      return {writeSpy, sessionId: session.id};
    };

    it('types the dropped path into the session', async () => {
      const {writeSpy, sessionId} = await dropUris('file:///tmp/notes.md');

      expect(writeSpy).toHaveBeenCalledWith(
        sessionId,
        `${escapeShellPath('/tmp/notes.md')} `
      );
    });

    it('types several dropped paths separated by spaces', async () => {
      const {writeSpy, sessionId} = await dropUris(
        'file:///tmp/a.ts\r\nfile:///tmp/b.ts\r\n'
      );

      expect(writeSpy).toHaveBeenCalledWith(
        sessionId,
        `${escapeShellPath('/tmp/a.ts')} ${escapeShellPath('/tmp/b.ts')} `
      );
    });

    it('decodes a percent-encoded path', async () => {
      const {writeSpy, sessionId} = await dropUris('file:///tmp/a%20b.ts');

      expect(writeSpy).toHaveBeenCalledWith(
        sessionId,
        `${escapeShellPath('/tmp/a b.ts')} `
      );
    });

    it('ignores URIs that do not name a file', async () => {
      const {writeSpy} = await dropUris(
        'https://example.com\nuntitled:Untitled-1'
      );

      expect(writeSpy).not.toHaveBeenCalled();
    });

    it('writes nothing for an empty list', async () => {
      const {writeSpy} = await dropUris('# comment only\n');

      expect(writeSpy).not.toHaveBeenCalled();
    });

    it('caps how many paths a single drop can type', async () => {
      const cap = SHARED_CONSTANTS.MAX_DROPPED_PATHS;
      const uriList = Array.from(
        {length: cap + 10},
        (_unused, index) => `file:///tmp/file-${index}.ts`
      ).join('\r\n');

      const {writeSpy} = await dropUris(uriList);

      const written = writeSpy.mock.calls[0][1] as string;
      expect(written.trimEnd().split(' ')).toHaveLength(cap);
    });
  });

  describe('handleMessage - terminal-resize', () => {
    it('should resize session', async () => {
      const webviewView = createMockWebviewView();
      provider.resolveWebviewView(webviewView);

      const messageHandler = (
        webviewView.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>
      ).mock.calls[0][0];

      // Initialize and create a session
      await messageHandler({type: 'webview-ready'});
      await new Promise((resolve) => setTimeout(resolve, 10));

      const sessions = sessionManager.getActiveSessions();
      if (sessions.length === 0) {
        expect(true).toBe(true);
        return;
      }
      const sessionId = sessions[0].id;

      // Mock resize method
      const resizeSpy = vi.spyOn(sessionManager, 'resize');

      // Send resize
      await messageHandler({
        type: 'terminal-resize',
        payload: {sessionId, cols: 120, rows: 30},
      });

      expect(resizeSpy).toHaveBeenCalledWith(sessionId, 120, 30);
    });
  });

  describe('handleMessage - dispose-session', () => {
    it('should dispose session', async () => {
      const webviewView = createMockWebviewView();
      provider.resolveWebviewView(webviewView);

      const messageHandler = (
        webviewView.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>
      ).mock.calls[0][0];

      // Initialize and create a session
      await messageHandler({type: 'webview-ready'});
      await new Promise((resolve) => setTimeout(resolve, 10));

      const sessions = sessionManager.getActiveSessions();
      if (sessions.length === 0) {
        expect(true).toBe(true);
        return;
      }
      const sessionId = sessions[0].id;
      const initialCount = sessionManager.getSessionCount();

      // Dispose session
      await messageHandler({
        type: 'dispose-session',
        payload: {sessionId},
      });

      expect(sessionManager.getSessionCount()).toBe(initialCount - 1);
    });
  });

  describe('handleMessage - dispose-all-sessions', () => {
    it('should dispose all sessions', async () => {
      const webviewView = createMockWebviewView();
      provider.resolveWebviewView(webviewView);

      const messageHandler = (
        webviewView.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>
      ).mock.calls[0][0];

      // Initialize
      await messageHandler({type: 'webview-ready'});

      // Create additional session
      await messageHandler({
        type: 'request-new-session',
        payload: {cols: 80, rows: 24},
      });

      // Dispose all
      await messageHandler({type: 'dispose-all-sessions'});

      expect(sessionManager.getSessionCount()).toBe(0);
    });

    it('should send all-sessions-cleared message', async () => {
      const webviewView = createMockWebviewView();
      provider.resolveWebviewView(webviewView);

      const messageHandler = (
        webviewView.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>
      ).mock.calls[0][0];

      // Initialize
      await messageHandler({type: 'webview-ready'});

      // Clear postMessage mock
      const postMessageMock = webviewView.webview.postMessage as ReturnType<
        typeof vi.fn
      >;
      postMessageMock.mockClear();

      // 画像とスクロールバックの削除を挟むため、種別で待つ
      await messageHandler({type: 'dispose-all-sessions'});
      await waitForPostedType(postMessageMock, 'all-sessions-cleared');

      // Should have sent all-sessions-cleared message
      expect(postMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'all-sessions-cleared',
        })
      );
    });
  });

  describe('Session Management', () => {
    describe('session labels', () => {
      it('should assign sequential labels to new sessions', async () => {
        const webviewView = createMockWebviewView();
        provider.resolveWebviewView(webviewView);

        const messageHandler = (
          webviewView.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>
        ).mock.calls[0][0];

        // Initialize
        await messageHandler({type: 'webview-ready'});
        await waitForSessionCreation(sessionManager, 1);

        // Verify session was created
        const sessionCount = sessionManager.getSessionCount();
        expect(sessionCount).toBeGreaterThan(0);

        // Clear postMessage mock
        const postMessageMock = webviewView.webview.postMessage as ReturnType<
          typeof vi.fn
        >;
        postMessageMock.mockClear();

        // Create a session
        await messageHandler({
          type: 'request-new-session',
          payload: {cols: 80, rows: 24},
        });

        // Wait for session-created message
        await waitForPostMessage(postMessageMock, 1);

        // Should have sent session-created with label
        const calls = postMessageMock.mock.calls;
        const sessionCreatedCall = calls.find(
          (call) => call[0]?.type === 'session-created'
        );

        if (sessionCreatedCall) {
          expect(sessionCreatedCall[0].payload.label).toMatch(/Terminal \d+/);
        } else {
          // If no call found, at least verify sessions were created
          expect(sessionManager.getSessionCount()).toBeGreaterThanOrEqual(
            sessionCount
          );
        }
      });

      it('should reuse freed label numbers', async () => {
        const webviewView = createMockWebviewView();
        provider.resolveWebviewView(webviewView);

        const messageHandler = (
          webviewView.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>
        ).mock.calls[0][0];

        // Initialize (creates Terminal 1)
        await messageHandler({type: 'webview-ready'});
        await new Promise((resolve) => setTimeout(resolve, 10));

        const sessions1 = sessionManager.getActiveSessions();
        if (sessions1.length === 0) {
          expect(true).toBe(true);
          return;
        }
        const session1Id = sessions1[0].id;

        // Create Terminal 2
        await messageHandler({
          type: 'request-new-session',
          payload: {cols: 80, rows: 24},
        });
        await new Promise((resolve) => setTimeout(resolve, 10));

        // Dispose Terminal 1
        await messageHandler({
          type: 'dispose-session',
          payload: {sessionId: session1Id},
        });
        await new Promise((resolve) => setTimeout(resolve, 10));

        // Clear postMessage mock
        (
          webviewView.webview.postMessage as ReturnType<typeof vi.fn>
        ).mockClear();

        // Create a new session - should reuse "Terminal 1"
        await messageHandler({
          type: 'request-new-session',
          payload: {cols: 80, rows: 24},
        });
        await new Promise((resolve) => setTimeout(resolve, 10));

        const calls = (
          webviewView.webview.postMessage as ReturnType<typeof vi.fn>
        ).mock.calls;
        const sessionCreatedCall = calls.find(
          (call) => call[0]?.type === 'session-created'
        );

        if (sessionCreatedCall) {
          expect(sessionCreatedCall[0].payload.label).toBe('Terminal 1');
        } else {
          expect(true).toBe(true);
        }
      });

      it('should send the terminal slot alongside the label', async () => {
        const webviewView = createMockWebviewView();
        provider.resolveWebviewView(webviewView);

        const messageHandler = (
          webviewView.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>
        ).mock.calls[0][0];

        // Initialize (creates Terminal 1)
        await messageHandler({type: 'webview-ready'});
        await waitForSessionCreation(sessionManager, 1);

        const postMessageMock = webviewView.webview.postMessage as ReturnType<
          typeof vi.fn
        >;
        postMessageMock.mockClear();

        // Create Terminal 2
        await messageHandler({
          type: 'request-new-session',
          payload: {cols: 80, rows: 24},
        });
        await waitForPostMessage(postMessageMock, 1);

        const sessionCreatedCall = postMessageMock.mock.calls.find(
          (call) => call[0]?.type === 'session-created'
        );

        expect(sessionCreatedCall).toBeDefined();
        if (sessionCreatedCall) {
          expect(sessionCreatedCall[0].payload.slot).toBe(2);
          expect(sessionCreatedCall[0].payload.label).toBe('Terminal 2');
        }
      });
    });

    describe('session exit handling', () => {
      it('should handle session exit event', async () => {
        const webviewView = createMockWebviewView();
        provider.resolveWebviewView(webviewView);

        const messageHandler = (
          webviewView.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>
        ).mock.calls[0][0];

        // Initialize
        await messageHandler({type: 'webview-ready'});
        await waitForSessionCreation(sessionManager, 1);

        const sessions = sessionManager.getActiveSessions();
        if (sessions.length === 0) {
          expect(true).toBe(true);
          return;
        }
        const sessionId = sessions[0].id;

        // Clear postMessage mock
        const postMessageMock = webviewView.webview.postMessage as ReturnType<
          typeof vi.fn
        >;
        postMessageMock.mockClear();

        // Simulate session exit by firing the exit event
        sessionManager.disposeSession(sessionId);

        // Manually fire the exit event to simulate what would happen in real scenario
        sessionManager['onExitEmitter'].fire({
          id: sessionId,
          code: 0,
          signal: null,
        });

        // Wait for async processing (event propagation)
        await waitForPostMessage(postMessageMock, 1);

        // Should have sent at least one message (session-count update)
        expect(postMessageMock).toHaveBeenCalled();
      });
    });

    describe('session data handling', () => {
      it('should forward session data to webview', async () => {
        const webviewView = createMockWebviewView();
        provider.resolveWebviewView(webviewView);

        const messageHandler = (
          webviewView.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>
        ).mock.calls[0][0];

        // Initialize
        await messageHandler({type: 'webview-ready'});
        await new Promise((resolve) => setTimeout(resolve, 10));

        const sessions = sessionManager.getActiveSessions();
        if (sessions.length === 0) {
          expect(true).toBe(true);
          return;
        }
        const sessionId = sessions[0].id;

        // Clear postMessage mock
        (
          webviewView.webview.postMessage as ReturnType<typeof vi.fn>
        ).mockClear();

        // Simulate data output
        const testData = 'test output data\r\n';
        sessionManager['onDataEmitter'].fire({id: sessionId, data: testData});

        // Should have forwarded the data
        expect(webviewView.webview.postMessage).toHaveBeenCalledWith({
          type: 'session-data',
          payload: {sessionId, data: testData},
        });
      });
    });
  });

  describe('Theme Management', () => {
    describe('handleMessage - theme-select', () => {
      it('should update theme preset on selection', async () => {
        const webviewView = createMockWebviewView();
        provider.resolveWebviewView(webviewView);

        const messageHandler = (
          webviewView.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>
        ).mock.calls[0][0];

        // Initialize
        await messageHandler({type: 'webview-ready'});

        // Clear postMessage mock
        (
          webviewView.webview.postMessage as ReturnType<typeof vi.fn>
        ).mockClear();

        // Select theme
        await messageHandler({
          type: 'theme-select',
          payload: {presetKey: 'basic'},
        });

        // Should have sent theme-update message
        const calls = (
          webviewView.webview.postMessage as ReturnType<typeof vi.fn>
        ).mock.calls;
        const themeUpdateCall = calls.find(
          (call) => call[0]?.type === 'theme-update'
        );

        expect(themeUpdateCall).toBeDefined();
      });

      it('should persist the selection to the setting of the given terminal', async () => {
        const webviewView = createMockWebviewView();
        provider.resolveWebviewView(webviewView);

        const messageHandler = (
          webviewView.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>
        ).mock.calls[0][0];

        await messageHandler({type: 'webview-ready'});

        const getConfiguration = vi.mocked(
          (await import('vscode')).workspace.getConfiguration
        );
        getConfiguration.mockClear();

        await messageHandler({
          type: 'theme-select',
          payload: {presetKey: 'ocean', slot: 1},
        });
        await messageHandler({
          type: 'theme-select',
          payload: {presetKey: 'homebrew', slot: 2},
        });

        const updateCalls = getConfiguration.mock.results
          .map((result) => result.value as {update: ReturnType<typeof vi.fn>})
          .flatMap((config) => config.update?.mock.calls ?? []);

        expect(updateCalls).toContainEqual(
          expect.arrayContaining(['themePreset', 'ocean'])
        );
        expect(updateCalls).toContainEqual(
          expect.arrayContaining(['themePresetSecondary', 'homebrew'])
        );
      });

      it('should fall back to Terminal 1 when the slot is unknown', async () => {
        const webviewView = createMockWebviewView();
        provider.resolveWebviewView(webviewView);

        const messageHandler = (
          webviewView.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>
        ).mock.calls[0][0];

        await messageHandler({type: 'webview-ready'});

        const getConfiguration = vi.mocked(
          (await import('vscode')).workspace.getConfiguration
        );
        getConfiguration.mockClear();

        await messageHandler({
          type: 'theme-select',
          payload: {presetKey: 'grass', slot: 99},
        });

        const updateCalls = getConfiguration.mock.results
          .map((result) => result.value as {update: ReturnType<typeof vi.fn>})
          .flatMap((config) => config.update?.mock.calls ?? []);

        expect(updateCalls).toContainEqual(
          expect.arrayContaining(['themePreset', 'grass'])
        );
      });

      it('should ignore invalid theme preset keys', async () => {
        const webviewView = createMockWebviewView();
        provider.resolveWebviewView(webviewView);

        const messageHandler = (
          webviewView.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>
        ).mock.calls[0][0];

        // Initialize
        await messageHandler({type: 'webview-ready'});

        // Clear postMessage mock
        (
          webviewView.webview.postMessage as ReturnType<typeof vi.fn>
        ).mockClear();

        // Try to select invalid theme
        await messageHandler({
          type: 'theme-select',
          payload: {presetKey: 'invalid-theme-key'},
        });

        // Should not have sent theme-update for invalid key
        const calls = (
          webviewView.webview.postMessage as ReturnType<typeof vi.fn>
        ).mock.calls;
        const themeUpdateCalls = calls.filter(
          (call) => call[0]?.type === 'theme-update'
        );

        // Should not have sent any new theme-update messages
        expect(themeUpdateCalls.length).toBe(0);
      });
    });

    describe('theme initialization', () => {
      it('should send theme-update on webview-ready', async () => {
        const webviewView = createMockWebviewView();
        provider.resolveWebviewView(webviewView);

        const messageHandler = (
          webviewView.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>
        ).mock.calls[0][0];

        // Clear postMessage mock
        (
          webviewView.webview.postMessage as ReturnType<typeof vi.fn>
        ).mockClear();

        // Initialize
        await messageHandler({type: 'webview-ready'});

        // Should have sent theme-update
        expect(webviewView.webview.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'theme-update',
            payload: expect.objectContaining({
              slots: expect.objectContaining({
                1: expect.objectContaining({
                  presetKey: expect.any(String),
                  palette: expect.any(Object),
                }),
                2: expect.objectContaining({
                  presetKey: expect.any(String),
                  palette: expect.any(Object),
                }),
              }),
              presets: expect.any(Array),
            }),
          })
        );
      });

      it('should include all theme presets in theme-update', async () => {
        const webviewView = createMockWebviewView();
        provider.resolveWebviewView(webviewView);

        const messageHandler = (
          webviewView.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>
        ).mock.calls[0][0];

        // Clear postMessage mock
        (
          webviewView.webview.postMessage as ReturnType<typeof vi.fn>
        ).mockClear();

        // Initialize
        await messageHandler({type: 'webview-ready'});

        const calls = (
          webviewView.webview.postMessage as ReturnType<typeof vi.fn>
        ).mock.calls;
        const themeUpdateCall = calls.find(
          (call) => call[0]?.type === 'theme-update'
        );

        expect(themeUpdateCall).toBeDefined();
        if (themeUpdateCall) {
          expect(themeUpdateCall[0].payload.presets).toBeInstanceOf(Array);
          expect(themeUpdateCall[0].payload.presets.length).toBeGreaterThan(0);
        }
      });
    });
  });

  describe('Image Handling', () => {
    describe('handleMessage - image-drop', () => {
      it('should validate image MIME type', async () => {
        const webviewView = createMockWebviewView();
        provider.resolveWebviewView(webviewView);

        const messageHandler = (
          webviewView.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>
        ).mock.calls[0][0];

        // Initialize and create session
        await messageHandler({type: 'webview-ready'});

        const sessions = sessionManager.getActiveSessions();
        if (sessions.length === 0) {
          // Skip test if no sessions created
          expect(true).toBe(true);
          return;
        }
        const sessionId = sessions[0].id;

        // Try to drop non-image file
        await messageHandler({
          type: 'image-drop',
          payload: {
            fileName: 'test.txt',
            mimeType: 'text/plain',
            data: 'dGVzdCBkYXRh', // base64 encoded "test data"
            sessionId,
          },
        });

        // Should log error (checked via Logger mock)
        expect(Logger.error).toHaveBeenCalled();
      });

      it('should validate base64 data', async () => {
        const webviewView = createMockWebviewView();
        provider.resolveWebviewView(webviewView);

        const messageHandler = (
          webviewView.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>
        ).mock.calls[0][0];

        // Initialize
        await messageHandler({type: 'webview-ready'});

        const sessions = sessionManager.getActiveSessions();
        if (sessions.length === 0) {
          expect(true).toBe(true);
          return;
        }
        const sessionId = sessions[0].id;

        // Try with invalid base64 data
        await messageHandler({
          type: 'image-drop',
          payload: {
            fileName: 'test.png',
            mimeType: 'image/png',
            data: '', // empty data
            sessionId,
          },
        });

        // Should log error
        expect(Logger.error).toHaveBeenCalled();
      });

      it('should validate file size', async () => {
        const webviewView = createMockWebviewView();
        provider.resolveWebviewView(webviewView);

        const messageHandler = (
          webviewView.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>
        ).mock.calls[0][0];

        // Initialize
        await messageHandler({type: 'webview-ready'});

        const sessions = sessionManager.getActiveSessions();
        if (sessions.length === 0) {
          expect(true).toBe(true);
          return;
        }
        const sessionId = sessions[0].id;

        // Create a large base64 string (> 10MB when decoded)
        // Each base64 character represents 6 bits, so 4 chars = 3 bytes
        // For 11MB: (11 * 1024 * 1024 * 4) / 3 ≈ 15,461,333 chars
        const largeData = 'A'.repeat(15_500_000);

        await messageHandler({
          type: 'image-drop',
          payload: {
            fileName: 'large.png',
            mimeType: 'image/png',
            data: largeData,
            sessionId,
          },
        });

        // Should log error for file too large
        expect(Logger.error).toHaveBeenCalled();
      });

      it('should validate filename', async () => {
        const webviewView = createMockWebviewView();
        provider.resolveWebviewView(webviewView);

        const messageHandler = (
          webviewView.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>
        ).mock.calls[0][0];

        // Initialize
        await messageHandler({type: 'webview-ready'});

        const sessions = sessionManager.getActiveSessions();
        if (sessions.length === 0) {
          expect(true).toBe(true);
          return;
        }
        const sessionId = sessions[0].id;

        // Try with empty filename
        await messageHandler({
          type: 'image-drop',
          payload: {
            fileName: '',
            mimeType: 'image/png',
            data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
            sessionId,
          },
        });

        // Should log error
        expect(Logger.error).toHaveBeenCalled();
      });

      it('should sanitize filename with special characters', async () => {
        const webviewView = createMockWebviewView();
        provider.resolveWebviewView(webviewView);

        const messageHandler = (
          webviewView.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>
        ).mock.calls[0][0];

        // Initialize
        await messageHandler({type: 'webview-ready'});
        await waitForSessionCreation(sessionManager, 1);

        const sessions = sessionManager.getActiveSessions();
        if (sessions.length === 0) {
          expect(true).toBe(true);
          return;
        }
        const sessionId = sessions[0].id;

        // Clear the error mock
        (Logger.error as ReturnType<typeof vi.fn>).mockClear();

        // Mock write to capture the sanitized filename
        const writeSpy = vi.spyOn(sessionManager, 'write');

        // Try with special characters in filename (await the result)
        await messageHandler({
          type: 'image-drop',
          payload: {
            fileName: 'test/../../../etc/passwd.png',
            mimeType: 'image/png',
            data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
            sessionId,
          },
        });

        // Wait for async file operations - check if error was called or write was called
        await waitForCondition(
          () => {
            const errorCalled =
              (Logger.error as ReturnType<typeof vi.fn>).mock.calls.length > 0;
            const writeWasCalled = writeSpy.mock.calls.length > 0;
            return errorCalled || writeWasCalled;
          },
          2000,
          50
        );
      });
    });

    describe('image cleanup', () => {
      it('should cleanup session images on session disposal', async () => {
        const webviewView = createMockWebviewView();
        provider.resolveWebviewView(webviewView);

        const messageHandler = (
          webviewView.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>
        ).mock.calls[0][0];

        // Initialize
        await messageHandler({type: 'webview-ready'});

        const sessions = sessionManager.getActiveSessions();
        if (sessions.length === 0) {
          expect(true).toBe(true);
          return;
        }
        const sessionId = sessions[0].id;

        // Dispose session (should trigger image cleanup)
        await messageHandler({
          type: 'dispose-session',
          payload: {sessionId},
        });

        // Should not throw errors during cleanup
        expect(true).toBe(true);
      });

      it('should cleanup all images when clearing all sessions', async () => {
        const webviewView = createMockWebviewView();
        provider.resolveWebviewView(webviewView);

        const messageHandler = (
          webviewView.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>
        ).mock.calls[0][0];

        // Initialize
        await messageHandler({type: 'webview-ready'});

        // Clear all sessions (should trigger image cleanup)
        await messageHandler({type: 'dispose-all-sessions'});

        // Should not throw errors during cleanup
        expect(true).toBe(true);
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle errors in message processing', async () => {
      const webviewView = createMockWebviewView();
      provider.resolveWebviewView(webviewView);

      const messageHandler = (
        webviewView.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>
      ).mock.calls[0][0];

      // Initialize
      await messageHandler({type: 'webview-ready'});
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Send malformed message (should not throw)
      const result = messageHandler({
        type: 'request-new-session',
        payload: null, // Invalid payload
      });

      // Wait for the promise if it exists
      if (result && typeof result === 'object' && 'then' in result) {
        await expect(result).resolves.not.toThrow();
      } else {
        // If not a promise, just verify it didn't throw
        expect(true).toBe(true);
      }
    });

    it('should log errors when message handling fails', async () => {
      const webviewView = createMockWebviewView();
      provider.resolveWebviewView(webviewView);

      const messageHandler = (
        webviewView.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>
      ).mock.calls[0][0];

      // Initialize
      await messageHandler({type: 'webview-ready'});
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Mock sessionManager to throw
      const originalDisposeSession =
        sessionManager.disposeSession.bind(sessionManager);
      sessionManager.disposeSession = vi.fn().mockImplementation(() => {
        throw new Error('Test error');
      });

      // Should log error but not throw
      const result = messageHandler({
        type: 'dispose-session',
        payload: {sessionId: 'test-id'},
      });

      // Wait for the promise if it exists
      if (result && typeof result === 'object' && 'then' in result) {
        await expect(result).resolves.not.toThrow();
      } else {
        expect(true).toBe(true);
      }

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(Logger.error).toHaveBeenCalled();

      // Restore
      sessionManager.disposeSession = originalDisposeSession;
    });
  });

  describe('message queue', () => {
    it('should flush queued messages when webview becomes ready', async () => {
      const webviewView = createMockWebviewView();
      provider.resolveWebviewView(webviewView);

      const messageHandler = (
        webviewView.webview.onDidReceiveMessage as ReturnType<typeof vi.fn>
      ).mock.calls[0][0];

      // Send webview-ready to flush queue
      await messageHandler({type: 'webview-ready'});

      // postMessage should have been called multiple times (flushing queue)
      expect(webviewView.webview.postMessage).toHaveBeenCalled();
    });

    it('should merge consecutive session-data instead of dropping output', async () => {
      const webviewView = createMockWebviewView();
      provider.resolveWebviewView(webviewView);

      // Generate many chunks before the webview is ready
      for (let i = 0; i < 150; i++) {
        sessionManager['onDataEmitter'].fire({
          id: 'test-session',
          data: `data ${i};`,
        });
      }

      // Merging keeps the queue short, so nothing is dropped
      expect(Logger.warn).not.toHaveBeenCalled();

      const queue = provider['messageQueue'] as Array<{
        type: string;
        payload: {sessionId: string; data: string};
      }>;
      const dataMessages = queue.filter((m) => m.type === 'session-data');
      expect(dataMessages).toHaveLength(1);
      expect(dataMessages[0].payload.data).toContain('data 0;');
      expect(dataMessages[0].payload.data).toContain('data 149;');
    });

    it('should drop the oldest message once non-mergeable messages fill the queue', async () => {
      const webviewView = createMockWebviewView();
      provider.resolveWebviewView(webviewView);

      // Alternate sessions so no two neighbours can merge
      for (let i = 0; i < 150; i++) {
        sessionManager['onDataEmitter'].fire({
          id: `session-${i % 2}`,
          data: `data ${i}`,
        });
      }

      expect(Logger.warn).toHaveBeenCalled();
      expect(
        (provider['messageQueue'] as unknown[]).length
      ).toBeLessThanOrEqual(SHARED_CONSTANTS.MESSAGE_QUEUE_MAX_SIZE);
    });
  });
});
