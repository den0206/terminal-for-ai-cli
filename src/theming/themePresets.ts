import type {
  ThemePalette,
  ThemePreview,
  ThemePreset,
  ThemePresetKey,
} from '../shared/types';

// Re-export types for backward compatibility
export type {ThemePalette, ThemePreview, ThemePreset, ThemePresetKey};

export const THEME_PRESETS: Record<ThemePresetKey, ThemePreset> = {
  modern: {
    label: 'Modern',
    description: 'A subdued palette that blends with VS Code themes',
    palette: {
      background: `color-mix(in srgb, var(--vscode-editor-background) 85%, transparent)`,
      foreground: `var(--vscode-foreground)`,
      cursor: `var(--vscode-terminalCursor-foreground, #ffffff)`,
      selection: `color-mix(in srgb, var(--vscode-editor-selectionBackground, rgba(255,255,255,0.15)) 80%, transparent)`,
    },
    preview: {background: '#1f1f1f', foreground: '#f0f0f0'},
  },
  basic: {
    label: 'Basic',
    description: 'Classic black background with white text',
    palette: {
      background: '#050505',
      foreground: '#f8f8f2',
      cursor: '#fefefe',
      selection: 'rgba(255,255,255,0.2)',
    },
    preview: {background: '#050505', foreground: '#f8f8f2'},
  },
  clearDark: {
    label: 'Clear Dark',
    description: 'Dark gray background with soft cyan accents',
    palette: {
      background: '#2b303b',
      foreground: '#c0c5ce',
      cursor: '#8fa1b3',
      selection: 'rgba(143,161,179,0.45)',
    },
    preview: {background: '#2b303b', foreground: '#c0c5ce'},
  },
  clearLight: {
    label: 'Clear Light',
    description: 'Light background with gentle dark text',
    palette: {
      background: '#f4f4f2',
      foreground: '#2b2b2b',
      cursor: '#000000',
      selection: 'rgba(0,0,0,0.2)',
    },
    preview: {background: '#f4f4f2', foreground: '#2b2b2b'},
  },
  grass: {
    label: 'Grass',
    description: 'Green retro terminal aesthetic',
    palette: {
      background: '#253120',
      foreground: '#d4fcbc',
      cursor: '#c8ff91',
      selection: 'rgba(212,252,188,0.35)',
    },
    preview: {background: '#2c3a27', foreground: '#d4fcbc'},
  },
  homebrew: {
    label: 'Homebrew',
    description: 'Neo green, Homebrew-inspired glow',
    palette: {
      background: '#000000',
      foreground: '#39ff14',
      cursor: '#39ff14',
      selection: 'rgba(57,255,20,0.35)',
    },
    preview: {background: '#000000', foreground: '#39ff14'},
  },
  manPage: {
    label: 'Man Page',
    description: 'Muted, paper-like tones reminiscent of man pages',
    palette: {
      background: '#fdf6e3',
      foreground: '#584b24',
      cursor: '#657b83',
      selection: 'rgba(60,60,60,0.25)',
    },
    preview: {background: '#fdf6e3', foreground: '#584b24'},
  },
  ocean: {
    label: 'Ocean',
    description: 'High-contrast blue and white palette',
    palette: {
      background: '#001f3f',
      foreground: '#d0ebff',
      cursor: '#7fdbff',
      selection: 'rgba(127,219,255,0.35)',
    },
    preview: {background: '#001f3f', foreground: '#d0ebff'},
  },
  pro: {
    label: 'Pro',
    description: 'Dark gray inspired by silver hardware accents',
    palette: {
      background: '#262626',
      foreground: '#e5e5e5',
      cursor: '#ffffff',
      selection: 'rgba(229,229,229,0.3)',
    },
    preview: {background: '#262626', foreground: '#e5e5e5'},
  },
};

export function isValidPresetKey(key: string): key is ThemePresetKey {
  return Object.prototype.hasOwnProperty.call(THEME_PRESETS, key);
}
