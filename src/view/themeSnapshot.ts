import type {
  TerminalSlot,
  ThemePresetKey,
  ThemeSlotSnapshot,
  ThemeSnapshot,
} from '../shared/types';
import {THEME_PRESETS, isValidPresetKey} from '../theming/themePresets';
import {Logger} from '../utils/logger';

/** Minimal shape of vscode.WorkspaceConfiguration used here. */
export type ConfigReader = {get(key: string): unknown};

/** Terminal 1 / Terminal 2 のテーマを保持する設定キー */
export const THEME_CONFIG_KEYS: Record<TerminalSlot, string> = {
  1: 'themePreset',
  2: 'themePresetSecondary',
};

const DEFAULT_PRESET_KEY: ThemePresetKey = 'modern';

/**
 * 設定値を検証してプリセットキーに変換する。
 * 未設定なら undefined、無効な値なら警告して undefined を返す。
 */
function readPresetKey(
  config: ConfigReader,
  configKey: string
): ThemePresetKey | undefined {
  const raw = config.get(configKey) as string | undefined;
  if (!raw) {
    return undefined;
  }
  if (isValidPresetKey(raw)) {
    return raw;
  }
  Logger.warn(
    `Invalid theme preset configured for "aiTerminal.${configKey}": "${raw}". ` +
      `Falling back to the default theme. ` +
      `Valid options: ${Object.keys(THEME_PRESETS).join(', ')}`
  );
  return undefined;
}

function toSlotSnapshot(
  presetKey: ThemePresetKey,
  inherited: boolean
): ThemeSlotSnapshot {
  return {presetKey, palette: THEME_PRESETS[presetKey].palette, inherited};
}

/**
 * Builds a theme snapshot for the webview.
 *
 * Terminal 1 は `aiTerminal.themePreset`、Terminal 2 は
 * `aiTerminal.themePresetSecondary` を使う。Terminal 2 が未設定の場合は
 * Terminal 1 のテーマを引き継ぐ。無効な値は既定の "modern" にフォールバックする。
 */
export function getThemeSnapshot(config: ConfigReader): ThemeSnapshot {
  const primaryKey = readPresetKey(config, THEME_CONFIG_KEYS[1]);
  const secondaryKey = readPresetKey(config, THEME_CONFIG_KEYS[2]);

  const resolvedPrimary = primaryKey ?? DEFAULT_PRESET_KEY;

  return {
    slots: {
      1: toSlotSnapshot(resolvedPrimary, false),
      2: toSlotSnapshot(secondaryKey ?? resolvedPrimary, !secondaryKey),
    },
    presets: Object.entries(THEME_PRESETS).map(([key, value]) => ({
      key: key as ThemePresetKey,
      label: value.label,
      description: value.description,
      preview: value.preview,
    })),
  };
}
