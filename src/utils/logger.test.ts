import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import * as vscode from 'vscode';
import {Logger} from './logger';

// Mock VS Code API
vi.mock('vscode', () => {
  const mockOutputChannel = {
    appendLine: vi.fn(),
    show: vi.fn(),
    dispose: vi.fn(),
  };

  const mockConfiguration = {
    get: vi.fn((key: string, defaultValue?: unknown) => {
      if (key === 'logLevel') {
        return defaultValue ?? 'info';
      }
      return defaultValue;
    }),
  };

  const mockWorkspace = {
    getConfiguration: vi.fn(() => mockConfiguration),
    onDidChangeConfiguration: vi.fn(() => ({
      dispose: vi.fn(),
    })),
  };

  return {
    window: {
      createOutputChannel: vi.fn(() => mockOutputChannel),
    },
    workspace: mockWorkspace,
  };
});

describe('Logger', () => {
  let mockContext: vscode.ExtensionContext;
  let mockOutputChannel: vscode.OutputChannel;
  let mockConfig: {get: ReturnType<typeof vi.fn>};

  beforeEach(() => {
    mockOutputChannel = {
      appendLine: vi.fn(),
      show: vi.fn(),
      dispose: vi.fn(),
    } as unknown as vscode.OutputChannel;

    // Type assertion to handle mock return type
    (vi.mocked(vscode.window.createOutputChannel) as unknown as {
      mockReturnValue: (value: vscode.OutputChannel) => void;
    }).mockReturnValue(mockOutputChannel);

    mockConfig = {
      get: vi.fn((key: string, defaultValue?: unknown) => {
        if (key === 'logLevel') {
          return defaultValue ?? 'info';
        }
        return defaultValue;
      }),
    };

    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(
      mockConfig as unknown as vscode.WorkspaceConfiguration
    );

    mockContext = {
      subscriptions: [] as vscode.Disposable[],
    } as unknown as vscode.ExtensionContext;

    // Reset logger state
    Logger.dispose();
  });

  afterEach(() => {
    Logger.dispose();
  });

  describe('initialize', () => {
    it('should create output channel and add to subscriptions', () => {
      Logger.initialize(mockContext);

      expect(vscode.window.createOutputChannel).toHaveBeenCalledWith('Terminal For AI CLI');
      expect(mockContext.subscriptions).toContain(mockOutputChannel);
    });

    it('should not create multiple output channels on repeated initialization', () => {
      Logger.initialize(mockContext);
      const firstCallCount = vi.mocked(vscode.window.createOutputChannel).mock.calls.length;

      Logger.initialize(mockContext);
      const secondCallCount = vi.mocked(vscode.window.createOutputChannel).mock.calls.length;

      // Should still be called only once (second call should be ignored)
      expect(secondCallCount).toBe(firstCallCount);
    });
  });

  describe('error', () => {
    it('should log error message to output channel', () => {
      Logger.initialize(mockContext);
      Logger.error('Test error message');

      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('[ERROR]')
      );
      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('Test error message')
      );
    });

    it('should include error details when provided', () => {
      Logger.initialize(mockContext);
      const testError = new Error('Test error');
      Logger.error('Test error message', testError);

      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('[ERROR]')
      );
      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('Test error message')
      );
      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('Test error')
      );
    });
  });

  describe('warn', () => {
    it('should log warning message to output channel', () => {
      Logger.initialize(mockContext);
      Logger.warn('Test warning message');

      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('[WARN]')
      );
      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('Test warning message')
      );
    });

    it('should include additional details when provided', () => {
      Logger.initialize(mockContext);
      Logger.warn('Test warning', {key: 'value'});

      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('[WARN]')
      );
      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('Details:')
      );
    });
  });

  describe('info', () => {
    it('should log info message to output channel', () => {
      Logger.initialize(mockContext);
      Logger.info('Test info message');

      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('[INFO]')
      );
      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('Test info message')
      );
    });
  });

  describe('debug', () => {
    it('should log debug message when log level is debug', () => {
      mockConfig.get.mockReturnValue('debug');
      Logger.initialize(mockContext);
      Logger.debug('Test debug message');

      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('[DEBUG]')
      );
    });

    it('should not log debug message when log level is info', () => {
      mockConfig.get.mockReturnValue('info');
      Logger.initialize(mockContext);
      Logger.debug('Test debug message');

      expect(mockOutputChannel.appendLine).not.toHaveBeenCalledWith(
        expect.stringContaining('[DEBUG]')
      );
    });

    it('should not log debug message when log level is warn', () => {
      mockConfig.get.mockReturnValue('warn');
      Logger.initialize(mockContext);
      Logger.debug('Test debug message');

      expect(mockOutputChannel.appendLine).not.toHaveBeenCalledWith(
        expect.stringContaining('[DEBUG]')
      );
    });

    it('should not log debug message when log level is error', () => {
      mockConfig.get.mockReturnValue('error');
      Logger.initialize(mockContext);
      Logger.debug('Test debug message');

      expect(mockOutputChannel.appendLine).not.toHaveBeenCalledWith(
        expect.stringContaining('[DEBUG]')
      );
    });
  });

  describe('log level filtering', () => {
    it('should filter messages based on log level setting', () => {
      mockConfig.get.mockReturnValue('error');
      Logger.initialize(mockContext);

      Logger.error('Error message');
      Logger.warn('Warning message');
      Logger.info('Info message');
      Logger.debug('Debug message');

      // Only error should be logged
      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('[ERROR]')
      );
      expect(mockOutputChannel.appendLine).not.toHaveBeenCalledWith(
        expect.stringContaining('[WARN]')
      );
      expect(mockOutputChannel.appendLine).not.toHaveBeenCalledWith(
        expect.stringContaining('[INFO]')
      );
      expect(mockOutputChannel.appendLine).not.toHaveBeenCalledWith(
        expect.stringContaining('[DEBUG]')
      );
    });

    it('should log warn and error when log level is warn', () => {
      mockConfig.get.mockReturnValue('warn');
      Logger.initialize(mockContext);

      Logger.error('Error message');
      Logger.warn('Warning message');
      Logger.info('Info message');

      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('[ERROR]')
      );
      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('[WARN]')
      );
      expect(mockOutputChannel.appendLine).not.toHaveBeenCalledWith(
        expect.stringContaining('[INFO]')
      );
    });
  });

  describe('show', () => {
    it('should show output channel', () => {
      Logger.initialize(mockContext);
      Logger.show();

      expect(mockOutputChannel.show).toHaveBeenCalledWith(true);
    });
  });

  describe('dispose', () => {
    it('should dispose output channel', () => {
      Logger.initialize(mockContext);
      Logger.dispose();

      expect(mockOutputChannel.dispose).toHaveBeenCalled();
    });
  });
});

