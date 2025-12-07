/**
 * Shared theme type definitions
 */

export type ThemePalette = {
  background: string;
  foreground: string;
  cursor: string;
  selection: string;
};

export type ThemePreview = {
  background: string;
  foreground: string;
};

export type ThemePreset = {
  label: string;
  description: string;
  palette: ThemePalette;
  preview: ThemePreview;
};

export type ThemePresetKey =
  | 'modern'
  | 'basic'
  | 'clearDark'
  | 'clearLight'
  | 'grass'
  | 'homebrew'
  | 'manPage'
  | 'ocean'
  | 'pro';
