import type {ISearchOptions} from '@xterm/addon-search';

import {PANES} from './types';
import type {Pane} from './types';

export type SearchResults = {resultIndex: number; resultCount: number};

/** 検索アドオンのうち、このコントローラが触る部分だけを写した型。 */
export type SearchAddonLike = {
  findNext(term: string, options?: ISearchOptions): boolean;
  findPrevious(term: string, options?: ISearchOptions): boolean;
  clearDecorations(): void;
};

/** 検索バーの表示を書き換える口。DOM は main.ts 側が持つ。 */
export type SearchView = {
  setVisible(visible: boolean): void;
  setSummary(text: string): void;
  setScopeLabel(label: string): void;
  setToggleState(toggle: 'caseSensitive' | 'regex', enabled: boolean): void;
  focusQueryInput(): void;
  /** 検索バーを閉じたあとにターミナルへフォーカスを戻す */
  focusTerminal(): void;
};

export type SearchControllerDeps = {
  getAddon(pane: Pane): SearchAddonLike | undefined;
  getActivePane(): Pane;
  /** 検索対象のターミナル名（`Terminal 1` など）。どちらを検索しているか示す。 */
  getScopeLabel(pane: Pane): string;
  /** ハイライトの色。テーマが変わるので検索のたびに読み直す。 */
  getDecorations(): ISearchOptions['decorations'];
  view: SearchView;
};

/**
 * 検索アドオンのハイライト色は `#RRGGBB` しか受け付けない。
 * VS Code のテーマ変数は `rgba(...)` を返すことがあるので、形式が違えば既定色に落とす。
 */
export function hexColorOr(value: string | undefined, fallback: string): string {
  return value !== undefined && /^#[0-9a-fA-F]{6}$/.test(value.trim())
    ? value.trim()
    : fallback;
}

/**
 * ヒット件数の表示。
 *
 * `resultIndex` はハイライト上限を超えると -1 になるので、その場合は
 * 「何件目」を出さずに総数だけ見せる。
 */
export function formatSearchSummary(
  query: string,
  results: SearchResults
): string {
  if (query.length === 0) {
    return '';
  }
  if (results.resultCount === 0) {
    return 'No results';
  }
  if (results.resultIndex < 0) {
    return `${results.resultCount} matches`;
  }
  return `${results.resultIndex + 1}/${results.resultCount}`;
}

/**
 * スクロールバック内検索。
 *
 * 検索はフォーカス中のペイン 1 つだけを対象にする（テーマと同じ考え方）。
 * ペインが切り替わったら前のペインのハイライトは消す。
 */
export class SearchController {
  private open = false;
  private query = '';
  private caseSensitive = false;
  private regex = false;
  private results: SearchResults = {resultIndex: -1, resultCount: 0};

  constructor(private readonly deps: SearchControllerDeps) {}

  get isOpen(): boolean {
    return this.open;
  }

  /** 検索バーを開く。開いている状態で呼ばれたら入力欄を選び直すだけ。 */
  openSearch(): void {
    this.open = true;
    this.deps.view.setVisible(true);
    this.deps.view.setScopeLabel(
      this.deps.getScopeLabel(this.deps.getActivePane())
    );
    this.deps.view.focusQueryInput();
    if (this.query.length > 0) {
      this.run('next');
    }
  }

  closeSearch(): void {
    if (!this.open) {
      return;
    }
    this.open = false;
    this.clearAllDecorations();
    this.results = {resultIndex: -1, resultCount: 0};
    this.deps.view.setSummary('');
    this.deps.view.setVisible(false);
    this.deps.view.focusTerminal();
  }

  setQuery(query: string): void {
    this.query = query;
    if (query.length === 0) {
      this.clearAllDecorations();
      this.results = {resultIndex: -1, resultCount: 0};
      this.deps.view.setSummary('');
      return;
    }
    // 入力中は incremental。いま合っている選択を伸ばすだけなので飛ばない。
    this.run('next', true);
  }

  findNext(): void {
    this.run('next');
  }

  findPrevious(): void {
    this.run('previous');
  }

  toggleCaseSensitive(): void {
    this.caseSensitive = !this.caseSensitive;
    this.deps.view.setToggleState('caseSensitive', this.caseSensitive);
    this.run('next');
  }

  toggleRegex(): void {
    this.regex = !this.regex;
    this.deps.view.setToggleState('regex', this.regex);
    this.run('next');
  }

  /**
   * フォーカスが別のペインに移ったとき。前のペインのハイライトを消し、
   * 新しいペインで同じ語を引き直す。
   */
  retarget(): void {
    if (!this.open) {
      return;
    }
    this.clearAllDecorations();
    this.deps.view.setScopeLabel(
      this.deps.getScopeLabel(this.deps.getActivePane())
    );
    if (this.query.length > 0) {
      this.run('next');
    } else {
      this.deps.view.setSummary('');
    }
  }

  /** アドオンの `onDidChangeResults` から呼ぶ。 */
  reportResults(pane: Pane, results: SearchResults): void {
    if (!this.open || pane !== this.deps.getActivePane()) {
      return;
    }
    this.results = results;
    this.deps.view.setSummary(formatSearchSummary(this.query, results));
  }

  private run(direction: 'next' | 'previous', incremental = false): void {
    if (!this.open || this.query.length === 0) {
      return;
    }
    const addon = this.deps.getAddon(this.deps.getActivePane());
    if (!addon) {
      return;
    }
    const options: ISearchOptions = {
      caseSensitive: this.caseSensitive,
      regex: this.regex,
      // incremental は findNext にしか効かない（アドオンの仕様）
      incremental: direction === 'next' && incremental,
      decorations: this.deps.getDecorations(),
    };
    const found =
      direction === 'next'
        ? addon.findNext(this.query, options)
        : addon.findPrevious(this.query, options);
    if (!found) {
      // 見つからないときは onDidChangeResults が来ないことがあるので自前で出す
      this.results = {resultIndex: -1, resultCount: 0};
      this.deps.view.setSummary(formatSearchSummary(this.query, this.results));
    }
  }

  private clearAllDecorations(): void {
    PANES.forEach((pane) => this.deps.getAddon(pane)?.clearDecorations());
  }
}
