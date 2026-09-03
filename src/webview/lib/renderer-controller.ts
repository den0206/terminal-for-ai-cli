import type {ITerminalAddon, Terminal} from '@xterm/xterm';

import type {RendererType} from '../../shared/types';
import {PANES} from './types';
import type {Pane} from './types';
import {webviewLog} from './utils';

/**
 * WebGL アドオンのうち、このコントローラが触る部分だけを写した型。
 * テストでは本物の GL コンテキストを作らずに差し替える。
 */
export type RendererAddon = ITerminalAddon & {
  onContextLoss(listener: () => void): {dispose(): void};
  clearTextureAtlas(): void;
};

/** Terminal のうちレンダラ切り替えに必要なメソッドだけ。 */
export type RendererTerminal = Pick<Terminal, 'loadAddon' | 'clearTextureAtlas'>;

export type RendererControllerDeps = {
  /** ペインの Terminal。まだ生成されていなければ undefined。 */
  getTerminal(pane: Pane): RendererTerminal | undefined;
  /** WebGL アドオンを生成する。WebGL2 が使えない環境では例外を投げる。 */
  createWebglAddon(): RendererAddon;
};

type Attachment = {
  addon: RendererAddon;
  contextLoss: {dispose(): void};
};

/**
 * ペインごとに WebGL レンダラを着脱する。
 *
 * xterm.js は既定で DOM レンダラを使う。WebGL アドオンを載せると罫線・ブロック文字を
 * フォントではなく自前で描く（`customGlyphs`）ため線が繋がり、大量出力時の描画も軽くなる。
 * ただし GPU が無効な環境では初期化が例外になり、GL コンテキストはいつでも失われうるので、
 * **失敗したら黙って DOM レンダラに戻す**のがこのクラスの責務。
 */
export class RendererController {
  private readonly attachments = new Map<Pane, Attachment>();
  private rendererType: RendererType;
  /**
   * 一度でも WebGL の初期化に失敗した / コンテキストを失った環境では、
   * 設定が明示的に変わるまで再挑戦しない（失敗を繰り返して点滅させないため）。
   */
  private webglUnavailable = false;

  constructor(
    private readonly deps: RendererControllerDeps,
    rendererType: RendererType = 'auto'
  ) {
    this.rendererType = rendererType;
  }

  /** 設定変更。全ペインに即時反映し、WebGL の再挑戦も許可する。 */
  setRendererType(rendererType: RendererType): void {
    if (this.rendererType === rendererType) {
      return;
    }
    this.rendererType = rendererType;
    this.webglUnavailable = false;
    PANES.forEach((pane) => this.applyToPane(pane));
  }

  /** ペインの Terminal を作った直後（`terminal.open()` の後）に呼ぶ。 */
  applyToPane(pane: Pane): void {
    if (this.wantsWebgl()) {
      this.enableWebgl(pane);
    } else {
      this.disableWebgl(pane);
    }
  }

  isWebglActive(pane: Pane): boolean {
    return this.attachments.has(pane);
  }

  /**
   * テーマを貼り替えたあとに呼ぶ。WebGL レンダラはグリフをテクスチャアトラスに
   * キャッシュしているので、色だけ変えても古い色のまま残ることがある。
   */
  refreshTextureAtlas(pane: Pane): void {
    if (!this.attachments.has(pane)) {
      return;
    }
    this.deps.getTerminal(pane)?.clearTextureAtlas();
  }

  dispose(): void {
    PANES.forEach((pane) => this.disableWebgl(pane));
  }

  private wantsWebgl(): boolean {
    return this.rendererType !== 'dom' && !this.webglUnavailable;
  }

  private enableWebgl(pane: Pane): void {
    if (this.attachments.has(pane)) {
      return;
    }
    const terminal = this.deps.getTerminal(pane);
    if (!terminal) {
      return;
    }
    try {
      const addon = this.deps.createWebglAddon();
      terminal.loadAddon(addon);
      const contextLoss = addon.onContextLoss(() => {
        this.handleContextLoss(pane);
      });
      this.attachments.set(pane, {addon, contextLoss});
    } catch (error) {
      // GPU アクセラレーション無効、WebGL2 非対応など。DOM レンダラのまま続行する。
      this.webglUnavailable = true;
      const detail =
        this.rendererType === 'webgl'
          ? 'WebGL renderer was requested but could not be initialized; falling back to the DOM renderer.'
          : 'WebGL renderer is unavailable; using the DOM renderer.';
      webviewLog.warn(detail, error);
      this.disableWebgl(pane);
    }
  }

  private disableWebgl(pane: Pane): void {
    const attachment = this.attachments.get(pane);
    if (!attachment) {
      return;
    }
    this.attachments.delete(pane);
    attachment.contextLoss.dispose();
    attachment.addon.dispose();
  }

  /**
   * コンテキストロスは再取得を試みず、そのセッションの間は DOM レンダラに退避する。
   * 片方のペインで起きた時点で GPU 側の事情なので、両ペインまとめて戻す。
   */
  private handleContextLoss(pane: Pane): void {
    webviewLog.warn(
      `WebGL context was lost on the ${pane} pane; falling back to the DOM renderer.`
    );
    this.webglUnavailable = true;
    PANES.forEach((target) => this.disableWebgl(target));
  }
}
