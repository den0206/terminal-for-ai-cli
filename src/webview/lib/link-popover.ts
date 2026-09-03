/** 画面内に収めるときにポップオーバーと端との間に空ける余白（px）。 */
const VIEWPORT_MARGIN = 8;

export type Point = {x: number; y: number};
export type Size = {width: number; height: number};

/** ポップオーバーの表示を差し替えるための口。DOM は main.ts 側が持つ。 */
export type LinkPopoverView = {
  setUrl(text: string): void;
  show(position: Point): void;
  hide(): void;
  /** 位置決めに使う実寸。まだ描画されていなければ概算値でよい。 */
  getSize(): Size;
};

export type LinkPopoverDeps = {
  view: LinkPopoverView;
  getViewportSize(): Size;
  openLink(uri: string): void;
  copyLink(uri: string): void;
};

/**
 * ポップオーバーを出してよいクリックか。
 *
 * プレーンクリックを奪うとテキスト選択と衝突する。押してから離すまでに指が動いた、
 * あるいは選択範囲が残っているなら、それはリンクを開く操作ではなく選択操作。
 */
export function isPlainClickActivation(params: {
  travelledPx: number;
  hasSelection: boolean;
}): boolean {
  return params.travelledPx <= 4 && !params.hasSelection;
}

export function distanceBetween(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * OSC 8 のハイパーリンクは任意のスキームを名乗れるので、Webview 側でも
 * http(s) 以外は扱わない（拡張ホスト側でも同じ検証をしている）。
 */
export function isSupportedLinkScheme(uri: string): boolean {
  return /^https?:\/\//i.test(uri.trim());
}

/** 長い URL は真ん中を省いて表示する。サイドバーは狭い。 */
export function truncateUrl(uri: string, maxLength = 48): string {
  if (uri.length <= maxLength) {
    return uri;
  }
  const head = Math.ceil((maxLength - 1) / 2);
  const tail = Math.floor((maxLength - 1) / 2);
  return `${uri.slice(0, head)}…${uri.slice(uri.length - tail)}`;
}

/**
 * クリック位置の少し下にポップオーバーを置き、画面外にはみ出すなら折り返す。
 * サイドバーは狭いので、右端・下端どちらもすぐ当たる。
 */
export function computePopoverPosition(
  anchor: Point,
  size: Size,
  viewport: Size
): Point {
  const maxLeft = Math.max(
    VIEWPORT_MARGIN,
    viewport.width - size.width - VIEWPORT_MARGIN
  );
  const belowTop = anchor.y + VIEWPORT_MARGIN;
  const fitsBelow = belowTop + size.height + VIEWPORT_MARGIN <= viewport.height;
  const top = fitsBelow
    ? belowTop
    : Math.max(VIEWPORT_MARGIN, anchor.y - size.height - VIEWPORT_MARGIN);
  return {
    x: Math.min(Math.max(VIEWPORT_MARGIN, anchor.x), maxLeft),
    y: Math.min(Math.max(VIEWPORT_MARGIN, top), Math.max(VIEWPORT_MARGIN, viewport.height - size.height - VIEWPORT_MARGIN)),
  };
}

/**
 * ターミナル内のリンクをプレーンクリックしたときに出るアクション選択。
 *
 * `Cmd` / `Ctrl` + クリックは従来どおり即座に開く。ダウンロードは提供しない
 * （この拡張はネットワークにアクセスしない）。
 */
export class LinkPopoverController {
  private uri: string | undefined;

  constructor(private readonly deps: LinkPopoverDeps) {}

  get isOpen(): boolean {
    return this.uri !== undefined;
  }

  get currentUri(): string | undefined {
    return this.uri;
  }

  present(uri: string, anchor: Point): void {
    if (!isSupportedLinkScheme(uri)) {
      this.dismiss();
      return;
    }
    this.uri = uri;
    this.deps.view.setUrl(truncateUrl(uri));
    this.deps.view.show(
      computePopoverPosition(
        anchor,
        this.deps.view.getSize(),
        this.deps.getViewportSize()
      )
    );
  }

  dismiss(): void {
    if (this.uri === undefined) {
      return;
    }
    this.uri = undefined;
    this.deps.view.hide();
  }

  confirmOpen(): void {
    const uri = this.uri;
    this.dismiss();
    if (uri) {
      this.deps.openLink(uri);
    }
  }

  confirmCopy(): void {
    const uri = this.uri;
    this.dismiss();
    if (uri) {
      this.deps.copyLink(uri);
    }
  }
}
