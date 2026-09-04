import * as vscode from 'vscode';
import {SHARED_CONSTANTS} from '../shared/constants';
import type {
  InboundMessage as WebviewInboundMessage,
  OutboundMessage as WebviewOutboundMessage,
  RendererType,
  TerminalSlot,
} from '../shared/types';
import {TERMINAL_SLOTS, isRendererType, isTerminalSlot} from '../shared/types';
import {SessionManager} from '../terminal/sessionManager';
import {isValidPresetKey} from '../theming/themePresets';
import {Logger} from '../utils/logger';
import {getNonce} from '../utils/nonce';
import {
  getDefaultShell,
  normalizeExternalUrl,
  validateShellPath,
  validateStartupCommands,
} from '../utils/validation';
import {escapeShellPath, parseUriList} from '../utils/shellPath';
import {resolveWorkingDirectory} from '../utils/workingDirectory';
import {ThemeSnapshot, buildWebviewHtml} from './htmlTemplate';
import {ImageManager} from './imageManager';
import {ScrollbackStore} from './scrollbackStore';
import {pruneOrphanedWindowStorage} from './storageRoot';
import {THEME_CONFIG_KEYS, getThemeSnapshot} from './themeSnapshot';

// Extension 視点: 送信 = WebviewInboundMessage (shared), 受信 = WebviewOutboundMessage (shared)
type OutboundMessage = WebviewInboundMessage;
type InboundMessage = WebviewOutboundMessage;

function labelForSlot(slot: TerminalSlot): string {
  return `Terminal ${slot}`;
}

/**
 * Bridges the extension host and the webview UI: session lifecycle, message
 * routing, theme selection and dropped-image storage.
 *
 * Messages are queued while the webview is not ready and flushed once it
 * reports `webview-ready`.
 */
export class AiTerminalViewProvider
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  private webviewView?: vscode.WebviewView;
  private webviewReady = false;
  private initialSessionEnsured = false;
  private readonly messageQueue: OutboundMessage[] = [];
  /** Characters of `session-data` currently held in `messageQueue`. */
  private queuedDataChars = 0;
  private readonly disposables: vscode.Disposable[] = [];
  /**
   * 現在の Webview に紐づく購読。ビューは作り直されるので、拡張本体の
   * `disposables` とは分けて、`resolveWebviewView` のたびに張り替える。
   */
  private viewDisposables: vscode.Disposable[] = [];
  /** セッション ID → ターミナル番号（Terminal 1 / Terminal 2） */
  private readonly sessionSlots = new Map<string, TerminalSlot>();
  private readonly imageManager: ImageManager;
  private readonly scrollbackStore: ScrollbackStore;
  /**
   * 復元は拡張ホストの 1 起動につき 1 回だけ。Webview の再読み込みでは
   * 生きているセッションのバッファがそのまま再生されるので、二重に流さない。
   */
  private scrollbackRestored = false;
  private usageTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly sessionManager: SessionManager,
  ) {
    this.imageManager = new ImageManager(context);
    this.scrollbackStore = new ScrollbackStore(context);
    // 起動時に期限切れを掃除する（画像の孤児掃除と同じ位置づけ）
    void this.scrollbackStore.pruneExpired();
    this.disposables.push(
      this.sessionManager.onDidWriteData(({id, data}) => {
        this.postMessage({
          type: 'session-data',
          payload: {sessionId: id, data},
        });
      }),
      this.sessionManager.onDidExit(({id, code, signal}) => {
        this.postMessage({
          type: 'session-exited',
          payload: {sessionId: id, code, signal},
        });
        this.sessionSlots.delete(id);
        this.imageManager.deleteSessionImages(id).catch((error) => {
          Logger.error(`Failed to delete images for session ${id}`, error);
        });
        this.postSessionCount();
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        const themeChanged = TERMINAL_SLOTS.some((slot) =>
          event.affectsConfiguration(`aiTerminal.${THEME_CONFIG_KEYS[slot]}`),
        );
        if (themeChanged) {
          this.postThemeUpdate();
        }
        if (event.affectsConfiguration('aiTerminal.showResourceStats')) {
          this.startUsagePolling();
        }
        if (event.affectsConfiguration('aiTerminal.rendererType')) {
          this.postRendererUpdate();
        }
        if (
          event.affectsConfiguration('aiTerminal.restoreScrollback') &&
          !this.isScrollbackRestoreEnabled()
        ) {
          // オフにした人は、既に書かれた履歴も消えることを期待する
          void this.scrollbackStore.clear();
        }
      }),
    );
  }

  /** Disposes listeners, labels, tracked images and queued messages. Idempotent. */
  dispose() {
    // Webview 側の購読は resolveWebviewView のたびに張り替わるので別管理
    this.disposeViewSubscriptions();
    clearInterval(this.usageTimer);
    this.usageTimer = undefined;
    vscode.Disposable.from(...this.disposables).dispose();
    this.sessionSlots.clear();
    this.imageManager.clearTracking();
    this.messageQueue.length = 0;
    this.queuedDataChars = 0;
    this.webviewView = undefined;
    this.webviewReady = false;
    this.initialSessionEnsured = false;
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this.webviewView = webviewView;
    this.webviewReady = false;
    this.initialSessionEnsured = false;

    const webview = webviewView.webview;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };

    webview.html = this.getHtml(webview);

    // Clean up previous subscriptions if the webview is re-resolved
    this.disposeViewSubscriptions();

    this.viewDisposables.push(
      // `handleMessage` の Promise はそのまま返す。VS Code は戻り値を見ないが、
      // 捨てると呼び出し側（テストを含む）が処理の完了を待てなくなる。
      webview.onDidReceiveMessage((message) => this.handleMessage(message)),
      // ビューを別コンテナへ移す・Webview を再読み込みすると、この View は破棄されて
      // 作り直される。検知しないと `webviewReady` が立ったままになり、破棄済みの
      // Webview へ post し続けて、その間の出力がキューにも載らずに失われる
      // （Webview 側のバッファは再読み込みで消えるので、取り戻す先が無い）。
      webviewView.onDidDispose(() => {
        this.handleViewDisposed();
      }),
    );
  }

  /** Drops the subscriptions tied to the current webview. Safe to call twice. */
  private disposeViewSubscriptions() {
    for (const disposable of this.viewDisposables) {
      disposable?.dispose();
    }
    this.viewDisposables = [];
  }

  /**
   * Webview が破棄されたときの後始末。
   *
   * セッションは拡張ホスト側で生き続けるので落とさない。以降の出力は
   * `postMessage` がキューに積み、次の `webview-ready` でまとめて流し込む。
   */
  private handleViewDisposed() {
    this.disposeViewSubscriptions();
    this.webviewView = undefined;
    this.webviewReady = false;
    this.initialSessionEnsured = false;
  }

  /** Brings the view into focus (command: terminal-for-ai-cli.focus). */
  reveal() {
    this.webviewView?.show?.(true);
  }

  /** Creates a new terminal session (command: terminal-for-ai-cli.newSession). */
  newSession() {
    this.handleSessionRequest();
  }

  private async handleMessage(message: InboundMessage): Promise<void> {
    try {
      switch (message.type) {
        case 'webview-ready':
          // Prevent duplicate webview-ready processing
          if (this.webviewReady) {
            Logger.debug('Duplicate webview-ready message received, ignoring');
            break;
          }
          // Flush queued messages before setting webviewReady to maintain message ordering
          this.flushQueuedMessages();
          this.webviewReady = true;
          this.postSessionCount();
          this.postThemeUpdate();
          this.startUsagePolling();
          this.postExistingSessions();
          // ディスク読み取りの完了を待たずに最初のシェルを起こす。復元は届いた時点で
          // 反映されるので、セッション生成との前後関係に依存しない。
          void this.restoreScrollback();
          this.ensureInitialSession();
          break;
        case 'request-new-session':
          this.handleSessionRequest(message.payload);
          break;
        case 'terminal-input':
          this.sessionManager.write(
            message.payload.sessionId,
            message.payload.data,
          );
          break;
        case 'terminal-resize':
          this.sessionManager.resize(
            message.payload.sessionId,
            message.payload.cols,
            message.payload.rows,
          );
          break;
        case 'dispose-session':
          await this.imageManager.deleteSessionImages(
            message.payload.sessionId,
          );
          this.sessionSlots.delete(message.payload.sessionId);
          this.removeSessionFromQueue(message.payload.sessionId);
          this.sessionManager.disposeSession(message.payload.sessionId);
          this.postSessionCount();
          break;
        case 'dispose-all-sessions':
          await this.handleClearAllSessions();
          break;
        case 'theme-select':
          await this.updateThemePreset(
            message.payload.presetKey,
            message.payload.slot,
          );
          break;
        case 'open-link':
          await this.handleOpenLink(message.payload.uri);
          break;
        case 'copy-link':
          await this.handleCopyLink(message.payload.uri);
          break;
        case 'session-snapshot':
          await this.handleSessionSnapshot(message.payload);
          break;
        case 'uri-drop':
          this.handleUriDrop(message.payload);
          break;
        case 'image-drop':
          await this.handleImageDrop(message.payload);
          break;
        default: {
          // TypeScript exhaustive check - this should never happen
          const _exhaustive: never = message;
          Logger.warn(
            `Unknown message type received: ${
              (_exhaustive as InboundMessage).type
            }`,
          );
          break;
        }
      }
    } catch (error) {
      Logger.error(`Error handling message type: ${message.type}`, error);
      if (
        message.type === 'request-new-session' ||
        message.type === 'dispose-session'
      ) {
        this.postMessage({
          type: 'session-error',
          payload: {
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }
  }

  /**
   * Validates configuration, enforces the session limit and creates a session.
   * An invalid shell path falls back to the platform default with a warning.
   */
  private handleSessionRequest(dimensions?: {cols?: number; rows?: number}) {
    if (
      this.sessionManager.getSessionCount() >= SHARED_CONSTANTS.MAX_SESSIONS
    ) {
      vscode.window.showWarningMessage(
        vscode.l10n.t(
          'Terminal For AI CLI supports up to {0} sessions.',
          SHARED_CONSTANTS.MAX_SESSIONS,
        ),
      );
      this.postMessage({
        type: 'session-limit-reached',
        payload: {max: SHARED_CONSTANTS.MAX_SESSIONS},
      });
      return;
    }
    const config = vscode.workspace.getConfiguration('aiTerminal');
    const configuredShell = config.get<string>('defaultShell')?.trim();
    const configuredCommands = config.get<string[]>('startupCommands');

    // Validate and sanitize shell path
    let shell: string | undefined;
    if (configuredShell) {
      if (validateShellPath(configuredShell)) {
        shell = configuredShell;
      } else {
        Logger.warn(
          `Invalid shell path configured: "${configuredShell}". Using default shell instead.`,
        );
        vscode.window.showWarningMessage(
          vscode.l10n.t(
            'Invalid shell path configured: "{0}". Using the default shell instead.',
            configuredShell,
          ),
        );
        shell = getDefaultShell();
      }
    } else {
      shell = undefined; // Let SessionManager use its default
    }

    // Validate and sanitize startup commands
    const startupCommands = validateStartupCommands(configuredCommands);
    const invalidCount =
      (configuredCommands?.length ?? 0) - startupCommands.length;
    if (invalidCount > 0) {
      Logger.warn(
        `Filtered out ${invalidCount} invalid startup command(s). ${startupCommands.length} valid command(s) will be executed.`,
      );
    }

    try {
      const info = this.sessionManager.createSession({
        shell,
        cols: dimensions?.cols,
        rows: dimensions?.rows,
        startupCommands,
        cwd: resolveWorkingDirectory(),
      });
      const slot = this.getOrCreateSlot(info.id);

      this.postMessage({
        type: 'session-created',
        payload: {...info, label: labelForSlot(slot), slot},
      });
      this.postSessionCount();
    } catch (error) {
      Logger.error('Failed to create Terminal For AI CLI session', error);

      // Provide user-friendly error messages
      let userMessage = vscode.l10n.t('Failed to create a terminal session.');
      if (error instanceof Error) {
        const errorMessage = error.message.toLowerCase();
        if (
          errorMessage.includes('enoent') ||
          errorMessage.includes('not found')
        ) {
          userMessage = vscode.l10n.t(
            'Shell not found. Check your "aiTerminal.defaultShell" setting, or make sure your default shell is available.',
          );
        } else if (
          errorMessage.includes('eacces') ||
          errorMessage.includes('permission')
        ) {
          userMessage = vscode.l10n.t(
            'Permission denied. Check that the shell is executable.',
          );
        } else if (errorMessage.includes('spawn')) {
          userMessage = vscode.l10n.t(
            'Failed to start the shell process. Check your shell configuration.',
          );
        } else {
          userMessage = vscode.l10n.t(
            'Failed to create session: {0}',
            error.message,
          );
        }
      }

      vscode.window.showErrorMessage(
        vscode.l10n.t(
          'Terminal For AI CLI: {0} Check the Output channel for details.',
          userMessage,
        ),
      );
      this.postMessage({
        type: 'session-error',
        payload: {
          message: userMessage,
        },
      });
    }
  }

  /** True when the user opted into the toolbar resource readout. */
  private isResourceStatsEnabled(): boolean {
    return vscode.workspace
      .getConfiguration('aiTerminal')
      .get<boolean>('showResourceStats', true);
  }

  /**
   * Refreshes the usage readout periodically while the view is visible.
   * Does nothing while `aiTerminal.showResourceStats` is off, so turning the
   * readout off also stops the polling behind it.
   */
  private startUsagePolling() {
    clearInterval(this.usageTimer);
    this.usageTimer = undefined;
    if (!this.isResourceStatsEnabled()) {
      this.postMessage({type: 'usage-update', payload: {text: ''}});
      return;
    }
    void this.postUsage();
    this.usageTimer = setInterval(() => {
      if (this.webviewView?.visible) {
        void this.postUsage();
      }
    }, SHARED_CONSTANTS.USAGE_POLL_INTERVAL_MS);
  }

  /**
   * Posts "<saved images + stored scrollback> / <extension host RSS>".
   * ponytail: RSS covers the whole extension host process (shared with other
   * extensions); per-extension memory would need a separate process to measure.
   * The setting description says so, and the readout carries a tooltip.
   */
  private async postUsage() {
    // 保存済み画像と、再起動用に取ってあるスクロールバック。どちらもこの拡張が
    // ワークスペースのストレージに置いたもので、放っておくと数 MB になる。
    const [imageBytes, scrollbackBytes] = await Promise.all([
      this.imageManager.getStorageBytes(),
      this.scrollbackStore.getStorageBytes(),
    ]);
    const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)}MB`;
    this.postMessage({
      type: 'usage-update',
      payload: {
        text: `\u{1F4BE} ${mb(imageBytes + scrollbackBytes)} \u00B7 \u{1F9E0} ${mb(
          process.memoryUsage().rss,
        )}`,
      },
    });
  }

  private postSessionCount() {
    this.postMessage({
      type: 'session-count',
      payload: {total: this.sessionManager.getSessionCount()},
    });
  }

  /**
   * Posts a message to the webview, or queues it while the webview is not ready.
   *
   * Consecutive `session-data` for one session is merged into the queued entry
   * instead of taking a slot: dropping the oldest entry would silently swallow
   * terminal output, and shell startup alone emits far more than
   * MESSAGE_QUEUE_MAX_SIZE chunks. Queued output is capped across the whole
   * queue rather than per entry, so interleaved sessions cannot multiply the
   * ceiling by the number of queue slots.
   */
  private postMessage(message: OutboundMessage): void {
    if (!this.webviewView || !this.webviewReady) {
      if (!this.mergeIntoQueuedData(message)) {
        if (
          this.messageQueue.length >= SHARED_CONSTANTS.MESSAGE_QUEUE_MAX_SIZE
        ) {
          Logger.warn('Message queue is full, dropping oldest message');
          this.removeQueuedAt(0);
        }
        this.messageQueue.push(message);
        if (message.type === 'session-data') {
          this.queuedDataChars += message.payload.data.length;
        }
      }
      this.trimQueuedData();
      return;
    }
    try {
      this.webviewView.webview.postMessage(message);
    } catch (error) {
      Logger.error('Failed to post message to webview', error);
    }
  }

  /**
   * Appends `session-data` onto the last queued chunk for the same session.
   * @returns true when the message was merged and must not be queued again
   */
  private mergeIntoQueuedData(message: OutboundMessage): boolean {
    if (message.type !== 'session-data') {
      return false;
    }
    const last = this.messageQueue[this.messageQueue.length - 1];
    if (
      last?.type !== 'session-data' ||
      last.payload.sessionId !== message.payload.sessionId
    ) {
      return false;
    }
    last.payload.data += message.payload.data;
    this.queuedDataChars += message.payload.data.length;
    return true;
  }

  /** Removes one queued entry, keeping `queuedDataChars` in step. */
  private removeQueuedAt(index: number): void {
    const [removed] = this.messageQueue.splice(index, 1);
    if (removed?.type === 'session-data') {
      this.queuedDataChars -= removed.payload.data.length;
    }
  }

  /**
   * Caps the terminal output held across the whole queue at MAX_BUFFER_SIZE by
   * dropping the oldest characters - the same "keep the newest" rule the
   * webview applies to its own per-session buffer. Trimming across entries
   * rather than within each one keeps the ceiling independent of how many
   * sessions are interleaved in the queue.
   */
  private trimQueuedData(): void {
    let overflow = this.queuedDataChars - SHARED_CONSTANTS.MAX_BUFFER_SIZE;
    for (let i = 0; overflow > 0 && i < this.messageQueue.length; ) {
      const entry = this.messageQueue[i];
      if (entry.type !== 'session-data') {
        i++;
        continue;
      }
      const {data} = entry.payload;
      if (data.length <= overflow) {
        overflow -= data.length;
        // Leaves `i` on the next entry, which shifted down into this slot.
        this.removeQueuedAt(i);
      } else {
        entry.payload.data = data.slice(overflow);
        this.queuedDataChars -= overflow;
        overflow = 0;
      }
    }
  }

  private postThemeUpdate() {
    this.postMessage({type: 'theme-update', payload: this.getThemeValues()});
  }

  /**
   * The renderer is chosen in the webview, where the GL context lives. The
   * setting is only the request - the webview falls back to the DOM renderer
   * on its own when WebGL is unavailable.
   */
  private getRendererType(): RendererType {
    const value = vscode.workspace
      .getConfiguration('aiTerminal')
      .get<string>('rendererType');
    return isRendererType(value) ? value : 'auto';
  }

  private postRendererUpdate() {
    this.postMessage({
      type: 'renderer-update',
      payload: {rendererType: this.getRendererType()},
    });
  }

  /**
   * Persists the selected preset for one terminal to global settings.
   * Invalid keys are ignored; an unknown slot falls back to Terminal 1.
   */
  private async updateThemePreset(presetKey: string, slot?: number) {
    if (!isValidPresetKey(presetKey)) {
      return;
    }
    const targetSlot: TerminalSlot = isTerminalSlot(slot) ? slot : 1;
    const config = vscode.workspace.getConfiguration('aiTerminal');
    await config.update(
      THEME_CONFIG_KEYS[targetSlot],
      presetKey,
      vscode.ConfigurationTarget.Global,
    );
    this.postThemeUpdate();
  }

  /** Drops queued messages for a disposed session so they are not flushed later. */
  private removeSessionFromQueue(sessionId: string) {
    for (let i = this.messageQueue.length - 1; i >= 0; i--) {
      const message = this.messageQueue[i];
      const shouldRemove =
        (message.type === 'session-data' || message.type === 'session-exited')
          ? message.payload.sessionId === sessionId
          : message.type === 'session-created' && message.payload.id === sessionId;
      if (shouldRemove) {
        this.removeQueuedAt(i);
      }
    }
  }

  /** Flushes queued messages once the webview is ready, skipping failures. */
  private flushQueuedMessages() {
    if (!this.webviewView) {
      return;
    }
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (message) {
        try {
          this.webviewView.webview.postMessage(message);
        } catch (error) {
          Logger.error('Failed to flush queued message to webview', error);
          // Continue flushing remaining messages
        }
      }
    }
    this.queuedDataChars = 0;
  }

  /** Creates a session on first webview-ready if none exist. */
  private isScrollbackRestoreEnabled(): boolean {
    return vscode.workspace
      .getConfiguration('aiTerminal')
      .get<boolean>('restoreScrollback', true);
  }

  /**
   * Stores the scrollback of one terminal so it can be read after a restart.
   * The webview decides when a snapshot is worth taking; this only persists it.
   */
  private async handleSessionSnapshot(payload: {
    slot: TerminalSlot;
    data: string;
    cols: number;
    rows: number;
  }): Promise<void> {
    if (!this.isScrollbackRestoreEnabled() || !isTerminalSlot(payload.slot)) {
      return;
    }
    await this.scrollbackStore.save(payload.slot, {
      data: payload.data,
      cols: payload.cols,
      rows: payload.rows,
      label: labelForSlot(payload.slot),
      savedAt: Date.now(),
    });
  }

  /**
   * Sends the stored scrollback to the webview, once per activation.
   *
   * Skipped when sessions are already running: that means the webview reloaded
   * while the extension host stayed up, and their live buffers are replayed
   * instead. The restored text is history only — the PTY behind it is gone.
   */
  private async restoreScrollback(): Promise<void> {
    if (
      this.scrollbackRestored ||
      !this.isScrollbackRestoreEnabled() ||
      this.sessionManager.getSessionCount() > 0
    ) {
      return;
    }
    this.scrollbackRestored = true;
    for (const slot of TERMINAL_SLOTS) {
      const snapshot = await this.scrollbackStore.load(slot);
      if (snapshot) {
        this.postMessage({
          type: 'restore-scrollback',
          payload: {slot, snapshot},
        });
      }
    }
  }

  private ensureInitialSession() {
    if (this.initialSessionEnsured) {
      return;
    }
    this.initialSessionEnsured = true;
    if (this.sessionManager.getSessionCount() === 0) {
      this.handleSessionRequest();
    }
  }

  private async handleClearAllSessions() {
    for (const session of this.sessionManager.getActiveSessions()) {
      this.sessionManager.disposeSession(session.id);
    }
    this.sessionSlots.clear();
    await this.imageManager.clearAllImages();
    await this.scrollbackStore.clear();
    this.postMessage({type: 'all-sessions-cleared'});
    this.postSessionCount();
  }

  /**
   * Deletes images left behind by previous sessions.
   * Called on activation and from the cleanupImages command.
   * @returns The number of deleted files
   */
  async cleanupOrphanedImages(): Promise<number> {
    return this.imageManager.cleanupOrphanedImages();
  }

  /** Deletes all saved images. Called on extension deactivation. */
  async clearAllStoredImages(): Promise<void> {
    return this.imageManager.clearAllImages();
  }

  /**
   * Deletes the storage of folderless windows that are no longer running.
   * Called on activation, like the image and scrollback sweeps.
   * @returns The number of deleted directories
   */
  async cleanupOrphanedWindowStorage(): Promise<number> {
    return pruneOrphanedWindowStorage(this.context);
  }

  private getThemeValues(): ThemeSnapshot {
    return getThemeSnapshot(vscode.workspace.getConfiguration('aiTerminal'));
  }

  /** Replays active sessions to the webview so it can restore its state. */
  private postExistingSessions() {
    for (const session of this.sessionManager.getActiveSessions()) {
      const slot = this.getOrCreateSlot(session.id);
      this.postMessage({
        type: 'session-created',
        payload: {...session, label: labelForSlot(slot), slot},
      });
    }
  }

  /**
   * Returns the terminal number assigned to a session, assigning one on first
   * use. The number decides which theme setting the session follows.
   */
  private getOrCreateSlot(sessionId: string): TerminalSlot {
    const existing = this.sessionSlots.get(sessionId);
    if (existing) {
      return existing;
    }
    const slot = this.findNextSlot();
    this.sessionSlots.set(sessionId, slot);
    return slot;
  }

  /** Lowest unused number from 1, so numbers freed by closed sessions are reused. */
  private findNextSlot(): TerminalSlot {
    const used = new Set(this.sessionSlots.values());
    return TERMINAL_SLOTS.find((slot) => !used.has(slot)) ?? TERMINAL_SLOTS[0];
  }

  /**
   * Opens a URL clicked in the terminal with the OS default browser.
   *
   * Terminal output is untrusted, so the scheme is restricted to http(s) and -
   * unless `aiTerminal.confirmOpenLink` is turned off - the full URL is shown
   * in a modal first. VS Code itself never prompts for `env.openExternal`
   * (microsoft/vscode#82277, as-designed), so the confirmation has to live here.
   *
   * The normalized URL is what gets shown and opened, so the host in the
   * prompt is always the host that opens.
   */
  private async handleOpenLink(uri: string): Promise<void> {
    const target = normalizeExternalUrl(uri);
    if (!target) {
      Logger.warn('Blocked link with unsupported scheme or malformed URL');
      return;
    }
    const confirm = vscode.workspace
      .getConfiguration('aiTerminal')
      .get<boolean>('confirmOpenLink', true);
    if (confirm) {
      const openLabel = vscode.l10n.t('Open');
      const choice = await vscode.window.showInformationMessage(
        vscode.l10n.t('Open this link in your browser?'),
        {modal: true, detail: target},
        openLabel,
      );
      if (choice !== openLabel) {
        return;
      }
    }
    await vscode.env.openExternal(vscode.Uri.parse(target));
  }

  /**
   * Copies a terminal link to the clipboard. The URL goes through the same
   * scheme check as opening one: an OSC 8 hyperlink can name any scheme, and
   * the webview is not the last word on what is safe to hand to the user.
   */
  private async handleCopyLink(uri: string): Promise<void> {
    const target = normalizeExternalUrl(uri);
    if (!target) {
      Logger.warn('Blocked copying a link with an unsupported scheme');
      return;
    }
    await vscode.env.clipboard.writeText(target);
  }

  /**
   * Types the paths of files dropped from the explorer into the session.
   *
   * Only `file:` URIs are used: a drop can name anything, and the point of this
   * is to hand an AI CLI a path it can open. Paths that cannot be quoted safely
   * are skipped rather than sent half-escaped.
   */
  private handleUriDrop(payload: {uriList: string; sessionId: string}): void {
    const paths: string[] = [];
    for (const raw of parseUriList(payload.uriList)) {
      if (paths.length >= SHARED_CONSTANTS.MAX_DROPPED_PATHS) {
        Logger.warn(
          `Dropped more than ${SHARED_CONSTANTS.MAX_DROPPED_PATHS} files; the rest were ignored`,
        );
        break;
      }
      let uri: vscode.Uri;
      try {
        uri = vscode.Uri.parse(raw, true);
      } catch {
        Logger.warn('Ignored a malformed URI in a drop');
        continue;
      }
      if (uri.scheme !== 'file') {
        Logger.warn(`Ignored a dropped ${uri.scheme}: URI; only files are typed`);
        continue;
      }
      try {
        paths.push(escapeShellPath(uri.fsPath));
      } catch (error) {
        Logger.warn('Skipped a dropped path that cannot be quoted', error);
      }
    }
    if (paths.length === 0) {
      return;
    }
    // 末尾の空白は続けて入力できるようにするため
    this.sessionManager.write(payload.sessionId, `${paths.join(' ')} `);
  }

  /** Stores the dropped image and types its escaped path into the session. */
  private async handleImageDrop(payload: {
    fileName: string;
    mimeType: string;
    data: string;
    sessionId: string;
  }) {
    try {
      const escapedPath = await this.imageManager.handleImageDrop(
        payload.fileName,
        payload.mimeType,
        payload.data,
        payload.sessionId,
      );
      this.sessionManager.write(payload.sessionId, escapedPath);
    } catch (error) {
      Logger.error('Failed to save image', error);

      let userMessage = vscode.l10n.t('Failed to save image.');
      if (error instanceof Error) {
        const errorMessage = error.message.toLowerCase();
        if (errorMessage.includes('too large')) {
          userMessage = error.message;
        } else if (errorMessage.includes('storage is full')) {
          userMessage = vscode.l10n.t(
            'Saved images have reached {0}MB. Run "Terminal For AI CLI: Delete saved images" to free space.',
            (
              SHARED_CONSTANTS.MAX_IMAGE_STORAGE_BYTES /
              (1024 * 1024)
            ).toFixed(0),
          );
        } else if (errorMessage.includes('invalid file type')) {
          userMessage = vscode.l10n.t('Only image files are supported.');
        } else if (errorMessage.includes('invalid base64')) {
          userMessage = vscode.l10n.t(
            'Invalid image data. Try dropping the image again.',
          );
        } else if (errorMessage.includes('invalid filename')) {
          userMessage = vscode.l10n.t('Invalid filename. Use a valid file name.');
        } else {
          userMessage = vscode.l10n.t(
            'Failed to save image: {0}',
            error.message,
          );
        }
      }

      vscode.window.showErrorMessage(
        vscode.l10n.t('Terminal For AI CLI: {0}', userMessage),
      );
    }
  }

  /** Builds the webview document: CSP nonce, theme values and resource URIs. */
  private getHtml(webview: vscode.Webview): string {
    const uri = (...segments: string[]) =>
      webview.asWebviewUri(
        vscode.Uri.joinPath(this.context.extensionUri, ...segments),
      );

    return buildWebviewHtml({
      webview,
      nonce: getNonce(),
      theme: this.getThemeValues(),
      iconUri: uri('media', 'icon-bit.png'),
      scriptUri: uri('media', 'webview.js'),
      xtermCssUri: uri('media', 'xterm.css'),
      rendererType: this.getRendererType(),
    });
  }
}
