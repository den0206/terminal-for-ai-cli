import * as vscode from 'vscode';

/**
 * Centralized logging utility for Terminal For AI CLI
 * Uses VS Code Output Channel for better log management
 */
export class Logger {
  private static outputChannel: vscode.OutputChannel | undefined;
  private static initialized = false;

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
    this.initialized = true;
  }

  /**
   * Log an error message
   * @param message Error message
   * @param error Optional error object
   */
  static error(message: string, error?: unknown): void {
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
    const timestamp = new Date().toISOString();
    const logMessage = `[INFO] ${timestamp} - ${message}`;

    this.outputChannel?.appendLine(logMessage);
    if (details.length > 0) {
      this.outputChannel?.appendLine(`  Details: ${JSON.stringify(details, null, 2)}`);
    }
  }

  /**
   * Log a debug message (only in development)
   * @param message Debug message
   * @param details Optional additional details
   */
  static debug(message: string, ...details: unknown[]): void {
    if (process.env.NODE_ENV === 'development' || process.env.DEBUG) {
      const timestamp = new Date().toISOString();
      const logMessage = `[DEBUG] ${timestamp} - ${message}`;

      this.outputChannel?.appendLine(logMessage);
      if (details.length > 0) {
        this.outputChannel?.appendLine(`  Details: ${JSON.stringify(details, null, 2)}`);
      }
      console.debug(message, ...details);
    }
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
  }
}

