import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

/**
 * Environment variable candidates for resolving working directory.
 * Includes Cursor-specific and standard environment variables.
 */
const ENV_CANDIDATES = [
  'CURSOR_PROJECT_PATH',
  'CURSOR_WORKSPACE_DIR',
  'CURSOR_CWD',
  'PWD',
  'INIT_CWD',
] as const;

/**
 * Resolves a working directory from environment variable candidates.
 */
function resolveFromEnv(): string | undefined {
  for (const key of ENV_CANDIDATES) {
    const value = process.env[key];
    if (value && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
}

/**
 * Resolves a working directory from VS Code workspace folders.
 */
function resolveFromWorkspace(): string | undefined {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders?.length) {
    return undefined;
  }
  const preferred = workspaceFolders.find(
    (folder) => folder.uri.scheme === 'file'
  );
  return (preferred ?? workspaceFolders[0]).uri.fsPath;
}

/**
 * Resolves the working directory for new sessions with editor context.
 *
 * Priority order:
 * 1. Active editor's workspace folder
 * 2. Active editor's file directory
 * 3. First workspace folder
 * 4. Environment variables (Cursor-specific, PWD, INIT_CWD)
 * 5. process.cwd()
 *
 * @returns The resolved working directory path, or undefined if resolution fails
 */
export function resolveWorkingDirectory(): string | undefined {
  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor) {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(
      activeEditor.document.uri
    );
    if (workspaceFolder?.uri.scheme === 'file') {
      return workspaceFolder.uri.fsPath;
    }

    if (activeEditor.document.uri.scheme === 'file') {
      return path.dirname(activeEditor.document.uri.fsPath);
    }
  }

  const fromWorkspace = resolveFromWorkspace();
  if (fromWorkspace) {
    return fromWorkspace;
  }

  const fromEnv = resolveFromEnv();
  if (fromEnv) {
    return fromEnv;
  }

  try {
    return process.cwd();
  } catch {
    return undefined;
  }
}

/**
 * Gets a default working directory that always returns a string.
 *
 * Priority order:
 * 1. VS Code workspace folder
 * 2. Environment variables (Cursor-specific, PWD, INIT_CWD)
 * 3. process.cwd()
 * 4. os.homedir()
 *
 * @returns The default working directory path (never undefined)
 */
export function getDefaultCwd(): string {
  const fromWorkspace = resolveFromWorkspace();
  if (fromWorkspace) {
    return fromWorkspace;
  }

  const fromEnv = resolveFromEnv();
  if (fromEnv) {
    return fromEnv;
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
