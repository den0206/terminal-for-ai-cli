import {vi} from 'vitest';

// Mock VS Code API for testing
export const window = {
  activeTextEditor: undefined as {document: {uri: {scheme: string; fsPath: string}}} | undefined,
  createOutputChannel: vi.fn(() => ({
    appendLine: vi.fn(),
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    show: vi.fn(),
    dispose: vi.fn(),
  })),
  showWarningMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  showInformationMessage: vi.fn(),
};

type WorkspaceFolder = {uri: {scheme: string; fsPath: string}};
let _workspaceFolders: WorkspaceFolder[] = [];

export const workspace = {
  getConfiguration: vi.fn(() => ({
    get: vi.fn(),
    update: vi.fn(),
  })),
  getWorkspaceFolder: vi.fn(),
  onDidChangeConfiguration: vi.fn(),
  get workspaceFolders(): WorkspaceFolder[] {
    return _workspaceFolders;
  },
  set workspaceFolders(value: WorkspaceFolder[]) {
    _workspaceFolders = value;
  },
  fs: {
    readDirectory: vi.fn(),
    delete: vi.fn(),
    createDirectory: vi.fn(),
    writeFile: vi.fn(),
    stat: vi.fn(),
  },
};

export const commands = {
  registerCommand: vi.fn(),
  executeCommand: vi.fn(),
};

export const Uri = {
  file: vi.fn((path: string) => ({
    fsPath: path,
    scheme: 'file',
    path,
  })),
  joinPath: vi.fn((...args: unknown[]) => ({
    fsPath: args.join('/'),
    scheme: 'file',
  })),
};

export class EventEmitter<T> {
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

export const Disposable = {
  from: vi.fn((...disposables: unknown[]) => ({
    dispose: vi.fn(() => {
      disposables.forEach((d: unknown) => {
        if (d && typeof d === 'object' && 'dispose' in d) {
          (d as {dispose: () => void}).dispose();
        }
      });
    }),
  })),
};

export enum ConfigurationTarget {
  Global = 1,
  Workspace = 2,
  WorkspaceFolder = 3,
}

export class FileSystemError extends Error {
  static FileNotFound(messageOrUri?: string | unknown): FileSystemError {
    return new FileSystemError(
      typeof messageOrUri === 'string' ? messageOrUri : 'File not found'
    );
  }
}

export enum FileType {
  Unknown = 0,
  File = 1,
  Directory = 2,
  SymbolicLink = 64,
}
