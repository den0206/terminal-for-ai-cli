import type {DOMElements} from './dom';
import type {ThemeStateManager} from './state-managers';
import type {OutboundMessage, ThemePalette, ThemePresetInfo} from './types';

/**
 * Manages theme selection, rendering, and application.
 *
 * Extracted from AppController to reduce class size and isolate
 * theme-related concerns.
 */
export class ThemeController {
  constructor(
    private readonly dom: DOMElements,
    private readonly themeState: ThemeStateManager,
    private readonly refreshTheme: () => void,
    private readonly postMessage: (msg: OutboundMessage) => void,
    private readonly addEventListener: (
      target: EventTarget,
      event: string,
      handler: EventListener
    ) => void
  ) {}

  setupThemeSelect(): void {
    if (this.dom.themeSelect) {
      this.addEventListener(this.dom.themeSelect, 'change', () => {
        const presetKey = this.dom.themeSelect?.value;
        if (!presetKey || presetKey === this.themeState.currentThemeKey) {
          return;
        }
        this.postMessage({
          type: 'theme-select',
          payload: {presetKey},
        });
      });
    }
  }

  applyTheme(palette: ThemePalette): void {
    const root = document.documentElement;
    root.style.setProperty('--terminal-bg', palette.background);
    root.style.setProperty('--terminal-fg', palette.foreground);
    root.style.setProperty('--terminal-cursor', palette.cursor);
    root.style.setProperty('--terminal-selection', palette.selection);
    this.refreshTheme();
  }

  renderThemeDropdown(): void {
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
    if (this.themeState.currentThemeKey) {
      this.dom.themeSelect.value = this.themeState.currentThemeKey;
    }
    const active = this.themeState.getActivePreset();
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
