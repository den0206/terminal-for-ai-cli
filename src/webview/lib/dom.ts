import type {Pane} from './types';

/**
 * DOM Elements Manager
 * Provides strongly-typed access to all DOM elements used in the webview
 */
export class DOMElements {
  readonly status = document.querySelector(
    '[data-session-status]'
  ) as HTMLSpanElement | null;
  readonly addSessionButton = document.querySelector(
    '[data-session-add]'
  ) as HTMLButtonElement | null;
  readonly viewToggleButton = document.querySelector(
    '[data-view-toggle]'
  ) as HTMLButtonElement | null;
  readonly viewToggleIcon = document.querySelector(
    '[data-view-toggle-icon]'
  ) as HTMLSpanElement | null;
  readonly removeSessionButton = document.querySelector(
    '[data-session-remove]'
  ) as HTMLButtonElement | null;
  readonly terminalShell = document.querySelector(
    '[data-terminal-shell]'
  ) as HTMLDivElement | null;
  readonly terminalStack = document.querySelector(
    '[data-terminal-stack]'
  ) as HTMLDivElement | null;
  readonly splitResizer = document.querySelector(
    '[data-split-resizer]'
  ) as HTMLDivElement | null;
  readonly resizer = document.querySelector(
    '[data-terminal-resizer]'
  ) as HTMLDivElement | null;
  readonly sessionSelect = document.querySelector(
    '[data-session-select]'
  ) as HTMLSelectElement | null;
  readonly themeSelect = document.querySelector(
    '[data-theme-select]'
  ) as HTMLSelectElement | null;
  readonly themeActiveLabel = document.querySelector(
    '[data-theme-active-label]'
  ) as HTMLSpanElement | null;
  readonly themePreviewText = document.querySelector(
    '[data-theme-preview-text]'
  ) as HTMLSpanElement | null;
  readonly themePreviewSwatch = document.querySelector(
    '[data-theme-swatch]'
  ) as HTMLSpanElement | null;
  readonly clearAllButton = document.querySelector(
    '[data-session-clear-all]'
  ) as HTMLButtonElement | null;
  readonly clearAllConfirm = document.querySelector(
    '[data-clear-all-confirm]'
  ) as HTMLDivElement | null;
  readonly clearAllConfirmAccept = document.querySelector(
    '[data-clear-all-confirm-accept]'
  ) as HTMLButtonElement | null;
  readonly clearAllConfirmCancel = document.querySelector(
    '[data-clear-all-confirm-cancel]'
  ) as HTMLButtonElement | null;

  readonly paneElements: Record<Pane, HTMLDivElement | null> = {
    primary: document.querySelector(
      '[data-terminal-pane="primary"]'
    ) as HTMLDivElement | null,
    secondary: document.querySelector(
      '[data-terminal-pane="secondary"]'
    ) as HTMLDivElement | null,
  };

  readonly paneLabels: Record<Pane, HTMLSpanElement | null> = {
    primary: document.querySelector(
      '[data-pane-label="primary"]'
    ) as HTMLSpanElement | null,
    secondary: document.querySelector(
      '[data-pane-label="secondary"]'
    ) as HTMLSpanElement | null,
  };

  readonly paneRoots: Record<Pane, HTMLDivElement | null> = {
    primary: document.querySelector(
      '[data-terminal-root="primary"]'
    ) as HTMLDivElement | null,
    secondary: document.querySelector(
      '[data-terminal-root="secondary"]'
    ) as HTMLDivElement | null,
  };
}
