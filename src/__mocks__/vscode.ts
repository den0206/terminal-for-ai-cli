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

export const env = {
  openExternal: vi.fn(),
};

// vscode.l10n.t: 本体と同じく {0} 形式のプレースホルダを引数で置換する
export const l10n = {
  t: vi.fn((message: string, ...args: unknown[]): string =>
    message.replace(/\{(\d+)\}/g, (match, index: string) => {
      const value = args[Number(index)];
      return value === undefined ? match : String(value);
    })
  ),
};

export const Uri = {
  parse: vi.fn((value: string) => ({
    toString: () => value,
    scheme: value.split(':')[0],
    path: value,
  })),
  file: vi.fn((path: string) => ({
    fsPath: path,
    scheme: 'file',
    path,
  })),
  // 本体と同じく base の fsPath に segment を継ぎ足す（テストでパスを検証できるように）
  joinPath: vi.fn((base: unknown, ...segments: string[]) => {
    const root =
      typeof base === 'string'
        ? base
        : ((base as {fsPath?: string} | null)?.fsPath ?? '');
    const fsPath = [root, ...segments].filter(Boolean).join('/');
    return {fsPath, scheme: 'file', path: fsPath};
  }),
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
