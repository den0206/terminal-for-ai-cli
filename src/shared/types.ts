/**
 * Shared type definitions used by both Extension and Webview
 *
 * Keep this file pure (no vscode/node imports) so it can be safely
 * bundled into both extension and webview contexts.
 */

// ============================================================================
// Theme Types
// ============================================================================

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

export type ThemePresetInfo = {
  key: ThemePresetKey;
  label: string;
  description: string;
  preview: ThemePreview;
};

/** Webview に渡すテーマのスナップショット（プリセットキー・パレット・一覧） */
export type ThemeSnapshot = {
  presetKey: ThemePresetKey;
  palette: ThemePalette;
  presets: ThemePresetInfo[];
};

// ============================================================================
// Session Types
// ============================================================================

export type SessionMeta = {
  shell: string;
  label: string;
};

// ============================================================================
// Message Types (Extension <-> Webview Communication)
// ============================================================================

/** Payload for the theme-update message (Extension → Webview) */
export type ThemeUpdatePayload = {
  presetKey: ThemePresetKey;
  palette: ThemePalette;
  presets: ThemePresetInfo[];
};

/**
 * Messages sent from Extension to Webview.
 * (Extension が Webview に送るメッセージ。Webview から見ると Inbound)
 */
export type InboundMessage =
  | {type: 'session-count'; payload: {total: number}}
  | {
      type: 'session-created';
      payload: {id: string; shell: string; label?: string};
    }
  | {type: 'session-data'; payload: {sessionId: string; data: string}}
  | {
      type: 'session-exited';
      payload: {sessionId: string; code: number | null; signal: string | null};
    }
  | {type: 'session-error'; payload: {message: string}}
  | {type: 'session-limit-reached'; payload: {max: number}}
  | {type: 'theme-update'; payload: ThemeUpdatePayload}
  | {type: 'usage-update'; payload: {text: string}}
  | {type: 'all-sessions-cleared'};

/**
 * Messages sent from Webview to Extension.
 * (Webview が Extension に送るメッセージ。Webview から見ると Outbound)
 */
export type OutboundMessage =
  | {type: 'webview-ready'}
  | {type: 'request-new-session'; payload?: {cols: number; rows: number}}
  | {type: 'terminal-input'; payload: {sessionId: string; data: string}}
  | {
      type: 'terminal-resize';
      payload: {sessionId: string; cols: number; rows: number};
    }
  | {type: 'dispose-session'; payload: {sessionId: string}}
  | {type: 'dispose-all-sessions'}
  | {type: 'theme-select'; payload: {presetKey: string}}
  | {
      type: 'image-drop';
      payload: {
        fileName: string;
        mimeType: string;
        data: string;
        sessionId: string;
      };
    };
