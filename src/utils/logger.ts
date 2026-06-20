import * as vscode from 'vscode';

/**
 * Log level enumeration
 */
export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

/**
 * Centralized logging utility for Terminal For AI CLI
 * Uses VS Code Output Channel for better log management
 *
 * Supports configurable log levels via VS Code settings.
 */
export class Logger {
  private static outputChannel: vscode.OutputChannel | undefined;
  private static initialized = false;
  private static currentLogLevel: LogLevel = 'info';

  /**
   * Initialize the logger with VS Code Output Channel
   * @param context Extension context for managing subscriptions
   */
  static initialize(context: vscode.ExtensionContext): void {
    if (this.initialized) {
      return;
    }
    this.outputChannel = vscode.window.createOutputChannel('Terminal For AI CLI');
    // OutputChannel implements Disposable, so it can be added to subscriptions
    context.subscriptions.push(this.outputChannel as vscode.Disposable);

    // Load log level from settings
    this.updateLogLevel();

    // Listen for configuration changes
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('aiTerminal.logLevel')) {
          this.updateLogLevel();
        }
      })
    );

    this.initialized = true;
  }

  /**
   * Updates the current log level from VS Code settings
   * @private
   */
  private static updateLogLevel(): void {
    const config = vscode.workspace.getConfiguration('aiTerminal');
    const configuredLevel = config.get<LogLevel>('logLevel', 'info');
    const validLevels: LogLevel[] = ['error', 'warn', 'info', 'debug'];
    if (validLevels.includes(configuredLevel)) {
      this.currentLogLevel = configuredLevel;
    } else {
      this.currentLogLevel = 'info';
    }
  }

  /**
   * Checks if a log level should be output based on current configuration
   * @param level The log level to check
   * @returns true if the level should be logged
   * @private
   */
  private static shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['error', 'warn', 'info', 'debug'];
    const currentIndex = levels.indexOf(this.currentLogLevel);
    const messageIndex = levels.indexOf(level);
    return messageIndex <= currentIndex;
  }

  /**
   * Log an error message
   * @param message Error message
   * @param error Optional error object
   */
  static error(message: string, error?: unknown): void {
    if (!this.shouldLog('error')) {
      return;
    }
    const timestamp = new Date().toISOString();
    const errorMessage = error instanceof Error ? error.message : String(error ?? '');
    const logMessage = `[ERROR] ${timestamp} - ${message}${errorMessage ? `: ${errorMessage}` : ''}`;

    this.outputChannel?.appendLine(logMessage);
    if (error) {
      console.error(message, error);
    } else {
      console.error(message);
    }
  }

  /**
   * Log a warning message
   * @param message Warning message
   * @param details Optional additional details
   */
  static warn(message: string, ...details: unknown[]): void {
    if (!this.shouldLog('warn')) {
      return;
    }
    const timestamp = new Date().toISOString();
    const logMessage = `[WARN] ${timestamp} - ${message}`;

    this.outputChannel?.appendLine(logMessage);
    if (details.length > 0) {
      this.outputChannel?.appendLine(`  Details: ${JSON.stringify(details, null, 2)}`);
    }
    console.warn(message, ...details);
  }

  /**
   * Log an info message
   * @param message Info message
   * @param details Optional additional details
   */
  static info(message: string, ...details: unknown[]): void {
    if (!this.shouldLog('info')) {
      return;
    }
    const timestamp = new Date().toISOString();
    const logMessage = `[INFO] ${timestamp} - ${message}`;

    this.outputChannel?.appendLine(logMessage);
    if (details.length > 0) {
      this.outputChannel?.appendLine(`  Details: ${JSON.stringify(details, null, 2)}`);
    }
  }

  /**
   * Log a debug message
   * @param message Debug message
   * @param details Optional additional details
   * @remarks Debug messages are only logged if log level is set to 'debug' in settings
   */
  static debug(message: string, ...details: unknown[]): void {
    if (!this.shouldLog('debug')) {
      return;
    }
    const timestamp = new Date().toISOString();
    const logMessage = `[DEBUG] ${timestamp} - ${message}`;

    this.outputChannel?.appendLine(logMessage);
    if (details.length > 0) {
      this.outputChannel?.appendLine(`  Details: ${JSON.stringify(details, null, 2)}`);
    }
    console.debug(message, ...details);
  }

  /**
   * Show the output channel in VS Code
   */
  static show(): void {
    this.outputChannel?.show(true);
  }

  /**
   * Dispose the logger
   */
  static dispose(): void {
    this.outputChannel?.dispose();
    this.outputChannel = undefined;
    this.initialized = false;
    this.currentLogLevel = 'info';
  }
}

