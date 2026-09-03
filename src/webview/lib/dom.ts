import type {Pane} from './types';

const $ = <T extends Element>(selector: string) =>
  document.querySelector<T>(selector);

const byPane = <T extends Element>(attribute: string) => ({
  primary: $<T>(`[${attribute}="primary"]`),
  secondary: $<T>(`[${attribute}="secondary"]`),
});

/**
 * DOM Elements Manager
 * Provides strongly-typed access to all DOM elements used in the webview
 */
export class DOMElements {
  readonly status = $<HTMLSpanElement>('[data-session-status]');
  readonly usage = $<HTMLSpanElement>('[data-usage]');
  readonly addSessionButton = $<HTMLButtonElement>('[data-session-add]');
  readonly viewToggleButton = $<HTMLButtonElement>('[data-view-toggle]');
  readonly viewToggleIcon = $<HTMLSpanElement>('[data-view-toggle-icon]');
  readonly removeSessionButton = $<HTMLButtonElement>('[data-session-remove]');
  readonly terminalShell = $<HTMLDivElement>('[data-terminal-shell]');
  readonly terminalStack = $<HTMLDivElement>('[data-terminal-stack]');
  readonly splitResizer = $<HTMLDivElement>('[data-split-resizer]');
  readonly resizer = $<HTMLDivElement>('[data-terminal-resizer]');
  readonly sessionSelect = $<HTMLSelectElement>('[data-session-select]');
  readonly themeSelect = $<HTMLSelectElement>('[data-theme-select]');
  readonly themeScopeLabel = $<HTMLSpanElement>('[data-theme-scope]');
  readonly themePreviewSwatch = $<HTMLSpanElement>('[data-theme-swatch]');
  readonly searchBar = $<HTMLDivElement>('[data-search-bar]');
  readonly searchInput = $<HTMLInputElement>('[data-search-input]');
  readonly searchSummary = $<HTMLSpanElement>('[data-search-summary]');
  readonly searchScope = $<HTMLSpanElement>('[data-search-scope]');
  readonly searchCaseToggle = $<HTMLButtonElement>('[data-search-case]');
  readonly searchRegexToggle = $<HTMLButtonElement>('[data-search-regex]');
  readonly searchPrevButton = $<HTMLButtonElement>('[data-search-prev]');
  readonly searchNextButton = $<HTMLButtonElement>('[data-search-next]');
  readonly searchCloseButton = $<HTMLButtonElement>('[data-search-close]');
  readonly linkPopover = $<HTMLDivElement>('[data-link-popover]');
  readonly linkPopoverUrl = $<HTMLSpanElement>('[data-link-popover-url]');
  readonly linkPopoverOpen = $<HTMLButtonElement>('[data-link-popover-open]');
  readonly linkPopoverCopy = $<HTMLButtonElement>('[data-link-popover-copy]');
  readonly clearAllButton = $<HTMLButtonElement>('[data-session-clear-all]');
  readonly clearAllConfirm = $<HTMLDivElement>('[data-clear-all-confirm]');
  readonly clearAllConfirmAccept = $<HTMLButtonElement>(
    '[data-clear-all-confirm-accept]'
  );
  readonly clearAllConfirmCancel = $<HTMLButtonElement>(
    '[data-clear-all-confirm-cancel]'
  );

  readonly paneElements: Record<Pane, HTMLDivElement | null> =
    byPane<HTMLDivElement>('data-terminal-pane');
  readonly paneLabels: Record<Pane, HTMLSpanElement | null> =
    byPane<HTMLSpanElement>('data-pane-label');
  readonly paneRoots: Record<Pane, HTMLDivElement | null> =
    byPane<HTMLDivElement>('data-terminal-root');
}
