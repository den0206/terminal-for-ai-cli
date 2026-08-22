import type {DOMElements} from './dom';
import type {ThemeStateManager} from './state-managers';
import {PANES} from './types';
import type {
  OutboundMessage,
  Pane,
  TerminalSlot,
  ThemePalette,
  ThemePresetInfo,
  ThemeUpdatePayload,
} from './types';

/**
 * Manages theme selection, rendering, and application.
 *
 * テーマはターミナル番号（Terminal 1 / Terminal 2）ごとに保持され、
 * そのターミナルを表示しているペインに個別に適用される。
 * ドロップダウンはフォーカス中のターミナルを対象に動作する。
 */
export class ThemeController {
  constructor(
    private readonly dom: DOMElements,
    private readonly themeState: ThemeStateManager,
    /** ペインの CSS 変数を更新したあと xterm 側のテーマを追従させる */
    private readonly refreshPaneTheme: (pane: Pane) => void,
    private readonly postMessage: (msg: OutboundMessage) => void,
    private readonly addEventListener: (
      target: EventTarget,
      event: string,
      handler: EventListener
    ) => void,
    /** ペインに表示中のターミナル番号（セッション未割り当てなら undefined） */
    private readonly getPaneSlot: (pane: Pane) => TerminalSlot | undefined,
    /** ドロップダウンの操作対象（フォーカス中のターミナル） */
    private readonly getActiveSlot: () => TerminalSlot | undefined
  ) {}

  setupThemeSelect(): void {
    if (this.dom.themeSelect) {
      this.addEventListener(this.dom.themeSelect, 'change', () => {
        const presetKey = this.dom.themeSelect?.value;
        const slot = this.getActiveSlot() ?? 1;
        if (!presetKey) {
          return;
        }
        const current = this.themeState.getSlotTheme(slot);
        // 継承中（個別設定なし）の場合は同じキーでも送信し、そのターミナルに固定する
        if (current && !current.inherited && current.presetKey === presetKey) {
          return;
        }
        this.postMessage({
          type: 'theme-select',
          payload: {presetKey, slot},
        });
      });
    }
  }

  /** Extension から届いたスナップショットを保持して全ペインに反映する */
  applyThemeUpdate(payload: ThemeUpdatePayload): void {
    this.themeState.slotThemes = payload.slots;
    this.themeState.availablePresets = payload.presets;
    this.applyPaneThemes();
    this.renderThemeDropdown();
  }

  /** ペインとセッションの対応が変わったときに配色を貼り直す */
  applyPaneThemes(): void {
    const base = this.themeState.getBaseTheme();
    if (base) {
      // ビュー全体の枠線・文字色は Terminal 1 のテーマを基準にする
      this.writePalette(document.documentElement, base.palette);
    }
    PANES.forEach((pane) => {
      const paneTheme =
        this.themeState.getSlotTheme(this.getPaneSlot(pane)) ?? base;
      const element = this.dom.paneElements[pane];
      if (element && paneTheme) {
        this.writePalette(element, paneTheme.palette);
      }
      this.refreshPaneTheme(pane);
    });
  }

  private writePalette(element: HTMLElement, palette: ThemePalette): void {
    element.style.setProperty('--terminal-bg', palette.background);
    element.style.setProperty('--terminal-fg', palette.foreground);
    element.style.setProperty('--terminal-cursor', palette.cursor);
    element.style.setProperty('--terminal-selection', palette.selection);
  }

  /** ドロップダウンの選択値・説明・プレビューをフォーカス中のターミナルに合わせる */
  renderThemeDropdown(): void {
    const slot = this.getActiveSlot() ?? 1;
    if (this.dom.themeScopeLabel) {
      this.dom.themeScopeLabel.textContent = `Terminal ${slot}`;
    }
    if (!this.dom.themeSelect) {
      return;
    }
    this.dom.themeSelect.innerHTML = '';
    this.themeState.availablePresets.forEach((preset) => {
      const option = document.createElement('option');
      option.value = preset.key;
      option.textContent = preset.label;
      this.dom.themeSelect?.appendChild(option);
    });
    const currentKey = this.themeState.getSlotTheme(slot)?.presetKey;
    if (currentKey) {
      this.dom.themeSelect.value = currentKey;
    }
    const active = this.themeState.getPresetInfo(currentKey);
    if (this.dom.themeActiveLabel) {
      this.dom.themeActiveLabel.textContent = active ? active.description : '―';
    }
    this.updateThemePreview(active ?? null);
  }

  private updateThemePreview(preset: ThemePresetInfo | null): void {
    if (!this.dom.themePreviewText || !this.dom.themePreviewSwatch) {
      return;
    }
    if (preset) {
      this.dom.themePreviewText.textContent = preset.label;
      this.dom.themePreviewSwatch.style.background = preset.preview.background;
      this.dom.themePreviewSwatch.style.color = preset.preview.foreground;
    } else {
      this.dom.themePreviewText.textContent = 'Preview';
      this.dom.themePreviewSwatch.style.background = '';
    }
  }
}
