import {describe, expect, it} from 'vitest';
import type {ISearchOptions} from '@xterm/addon-search';
import {
  SearchController,
  formatSearchSummary,
  hexColorOr,
} from './search-controller';
import type {SearchAddonLike, SearchView} from './search-controller';
import type {Pane} from './types';

type Call = {
  method: 'findNext' | 'findPrevious';
  term: string;
  options?: ISearchOptions;
};

class FakeAddon implements SearchAddonLike {
  readonly calls: Call[] = [];
  cleared = 0;
  found = true;

  findNext(term: string, options?: ISearchOptions): boolean {
    this.calls.push({method: 'findNext', term, options});
    return this.found;
  }

  findPrevious(term: string, options?: ISearchOptions): boolean {
    this.calls.push({method: 'findPrevious', term, options});
    return this.found;
  }

  clearDecorations(): void {
    this.cleared += 1;
  }
}

class FakeView implements SearchView {
  visible = false;
  summary = '';
  scopeLabel = '';
  toggles: Record<'caseSensitive' | 'regex', boolean> = {
    caseSensitive: false,
    regex: false,
  };
  inputFocusCount = 0;
  terminalFocusCount = 0;

  setVisible(visible: boolean): void {
    this.visible = visible;
  }

  setSummary(text: string): void {
    this.summary = text;
  }

  setScopeLabel(label: string): void {
    this.scopeLabel = label;
  }

  setToggleState(toggle: 'caseSensitive' | 'regex', enabled: boolean): void {
    this.toggles[toggle] = enabled;
  }

  focusQueryInput(): void {
    this.inputFocusCount += 1;
  }

  focusTerminal(): void {
    this.terminalFocusCount += 1;
  }
}

function createHarness() {
  const addons: Record<Pane, FakeAddon> = {
    primary: new FakeAddon(),
    secondary: new FakeAddon(),
  };
  const view = new FakeView();
  let activePane: Pane = 'primary';
  const controller = new SearchController({
    getAddon: (pane) => addons[pane],
    getActivePane: () => activePane,
    getScopeLabel: (pane) => (pane === 'primary' ? 'Terminal 1' : 'Terminal 2'),
    getDecorations: () => ({
      matchBackground: '#613214',
      activeMatchBackground: '#9e6a03',
      matchOverviewRuler: '#d18616',
      activeMatchColorOverviewRuler: '#a0a0a0',
    }),
    view,
  });
  return {
    controller,
    addons,
    view,
    setActivePane: (pane: Pane) => {
      activePane = pane;
    },
  };
}

describe('formatSearchSummary', () => {
  it('shows nothing for an empty query', () => {
    expect(formatSearchSummary('', {resultIndex: -1, resultCount: 0})).toBe('');
  });

  it('reports when nothing matched', () => {
    expect(formatSearchSummary('npm', {resultIndex: -1, resultCount: 0})).toBe(
      'No results'
    );
  });

  it('shows the position within the matches', () => {
    expect(formatSearchSummary('npm', {resultIndex: 2, resultCount: 9})).toBe(
      '3/9'
    );
  });

  it('drops the position when the highlight limit was exceeded', () => {
    expect(
      formatSearchSummary('npm', {resultIndex: -1, resultCount: 1000})
    ).toBe('1000 matches');
  });
});

describe('hexColorOr', () => {
  it('keeps a #RRGGBB value', () => {
    expect(hexColorOr('#ABCDEF', '#000000')).toBe('#ABCDEF');
  });

  it('trims surrounding whitespace from CSS variables', () => {
    expect(hexColorOr('  #123456 ', '#000000')).toBe('#123456');
  });

  it.each(['rgba(255, 0, 0, 0.3)', '#abc', '', undefined])(
    'falls back for %s',
    (value) => {
      expect(hexColorOr(value, '#613214')).toBe('#613214');
    }
  );
});

describe('SearchController', () => {
  it('opens the bar, labels the target terminal and focuses the input', () => {
    const {controller, view} = createHarness();
    controller.openSearch();

    expect(controller.isOpen).toBe(true);
    expect(view.visible).toBe(true);
    expect(view.scopeLabel).toBe('Terminal 1');
    expect(view.inputFocusCount).toBe(1);
  });

  it('searches the active pane as the query is typed', () => {
    const {controller, addons} = createHarness();
    controller.openSearch();
    controller.setQuery('error');

    expect(addons.primary.calls).toHaveLength(1);
    expect(addons.primary.calls[0].method).toBe('findNext');
    expect(addons.primary.calls[0].term).toBe('error');
    expect(addons.primary.calls[0].options?.incremental).toBe(true);
    expect(addons.secondary.calls).toHaveLength(0);
  });

  it('does not search while the bar is closed', () => {
    const {controller, addons} = createHarness();
    controller.setQuery('error');
    controller.findNext();

    expect(addons.primary.calls).toHaveLength(0);
  });

  it('clears the highlights when the query is emptied', () => {
    const {controller, addons, view} = createHarness();
    controller.openSearch();
    controller.setQuery('error');
    controller.setQuery('');

    expect(addons.primary.cleared).toBeGreaterThan(0);
    expect(view.summary).toBe('');
  });

  it('steps through matches without the incremental flag', () => {
    const {controller, addons} = createHarness();
    controller.openSearch();
    controller.setQuery('error');
    controller.findNext();
    controller.findPrevious();

    const [, next, previous] = addons.primary.calls;
    expect(next.options?.incremental).toBe(false);
    expect(previous.method).toBe('findPrevious');
    expect(previous.options?.incremental).toBe(false);
  });

  it('re-runs the search when the toggles change', () => {
    const {controller, addons, view} = createHarness();
    controller.openSearch();
    controller.setQuery('error');
    controller.toggleCaseSensitive();
    controller.toggleRegex();

    const last = addons.primary.calls[addons.primary.calls.length - 1];
    expect(last.options?.caseSensitive).toBe(true);
    expect(last.options?.regex).toBe(true);
    expect(view.toggles).toEqual({caseSensitive: true, regex: true});
  });

  it('reports no results when the addon finds nothing', () => {
    const {controller, addons, view} = createHarness();
    addons.primary.found = false;
    controller.openSearch();
    controller.setQuery('nothing-here');

    expect(view.summary).toBe('No results');
  });

  it('shows result counts reported by the addon for the active pane only', () => {
    const {controller, view} = createHarness();
    controller.openSearch();
    controller.setQuery('error');

    controller.reportResults('secondary', {resultIndex: 0, resultCount: 5});
    expect(view.summary).not.toBe('1/5');

    controller.reportResults('primary', {resultIndex: 0, resultCount: 5});
    expect(view.summary).toBe('1/5');
  });

  it('moves the search to the pane that took focus', () => {
    const {controller, addons, view, setActivePane} = createHarness();
    controller.openSearch();
    controller.setQuery('error');

    setActivePane('secondary');
    controller.retarget();

    expect(addons.primary.cleared).toBeGreaterThan(0);
    expect(addons.secondary.calls).toHaveLength(1);
    expect(view.scopeLabel).toBe('Terminal 2');
  });

  it('ignores retargeting while the bar is closed', () => {
    const {controller, addons} = createHarness();
    controller.retarget();

    expect(addons.primary.calls).toHaveLength(0);
    expect(addons.primary.cleared).toBe(0);
  });

  it('clears every pane and returns focus to the terminal on close', () => {
    const {controller, addons, view} = createHarness();
    controller.openSearch();
    controller.setQuery('error');
    controller.closeSearch();

    expect(controller.isOpen).toBe(false);
    expect(view.visible).toBe(false);
    expect(view.summary).toBe('');
    expect(view.terminalFocusCount).toBe(1);
    expect(addons.primary.cleared).toBeGreaterThan(0);
    expect(addons.secondary.cleared).toBeGreaterThan(0);
  });

  it('keeps the query when reopened', () => {
    const {controller, addons} = createHarness();
    controller.openSearch();
    controller.setQuery('error');
    controller.closeSearch();
    controller.openSearch();

    const last = addons.primary.calls[addons.primary.calls.length - 1];
    expect(last.term).toBe('error');
  });
});
