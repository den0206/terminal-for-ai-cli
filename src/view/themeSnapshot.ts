import type {ThemePresetKey, ThemeSnapshot} from '../shared/types';
import {THEME_PRESETS, isValidPresetKey} from '../theming/themePresets';
import {Logger} from '../utils/logger';

/** Minimal shape of vscode.WorkspaceConfiguration used here. */
export type ConfigReader = {get(key: string): unknown};

/**
 * Builds a theme snapshot for the webview.
 * Validates the configured preset and falls back to "modern" when invalid.
 */
export function getThemeSnapshot(config: ConfigReader): ThemeSnapshot {
  const rawPresetKey = config.get('themePreset') as string | undefined;

  let presetKey: ThemePresetKey = 'modern';
  if (rawPresetKey && isValidPresetKey(rawPresetKey)) {
    presetKey = rawPresetKey;
  } else if (rawPresetKey) {
    Logger.warn(
      `Invalid theme preset configured: "${rawPresetKey}". Using default "modern" theme instead. ` +
        `Valid options: ${Object.keys(THEME_PRESETS).join(', ')}`
    );
  }

  return {
    presetKey,
    palette: THEME_PRESETS[presetKey].palette,
    presets: Object.entries(THEME_PRESETS).map(([key, value]) => ({
      key: key as ThemePresetKey,
      label: value.label,
      description: value.description,
      preview: value.preview,
    })),
  };
}
