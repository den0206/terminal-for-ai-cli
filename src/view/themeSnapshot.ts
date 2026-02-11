import type {ThemePresetKey, ThemePresetInfo, ThemeSnapshot} from '../shared/types';
import {THEME_PRESETS, isValidPresetKey} from '../theming/themePresets';

export type GetConfig = (key: string) => unknown;

export type ThemeSnapshotOptions = {
  logWarning?: (message: string) => void;
};

/**
 * Builds a theme snapshot for the webview from the given config getter.
 * Validates theme preset and falls back to "modern" when invalid.
 *
 * @param getConfig - Function that returns config value for a key (e.g. config.get)
 * @param options - Optional logger for invalid preset warnings
 * @returns Theme snapshot with preset key, palette, and available presets
 */
export function getThemeSnapshot(
  getConfig: GetConfig,
  options?: ThemeSnapshotOptions
): ThemeSnapshot {
  const rawPresetKey = getConfig('themePreset') as string | undefined;
  const logWarning = options?.logWarning;

  let presetKey: ThemePresetKey = 'modern';
  if (rawPresetKey && isValidPresetKey(rawPresetKey)) {
    presetKey = rawPresetKey;
  } else if (rawPresetKey) {
    logWarning?.(
      `Invalid theme preset configured: "${rawPresetKey}". Using default "modern" theme instead. ` +
        `Valid options: ${Object.keys(THEME_PRESETS).join(', ')}`
    );
  }

  const activePreset = THEME_PRESETS[presetKey] ?? THEME_PRESETS.modern;
  const palette = activePreset.palette;
  const presets: ThemePresetInfo[] = Object.entries(THEME_PRESETS)
    .filter(
      (
        entry
      ): entry is [ThemePresetKey, (typeof THEME_PRESETS)[ThemePresetKey]] => {
        const [key] = entry;
        return isValidPresetKey(key);
      }
    )
    .map(([key, value]) => ({
      key,
      label: value.label,
      description: value.description,
      preview: value.preview,
    }));

  return {presetKey, palette, presets};
}
