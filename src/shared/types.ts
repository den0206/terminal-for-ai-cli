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

/**
 * ターミナルの通し番号（Terminal 1 / Terminal 2）。
 * セッション ID は起動ごとに変わるため、テーマはこのスロット単位で保持する。
 */
export type TerminalSlot = 1 | 2;

export const TERMINAL_SLOTS: readonly TerminalSlot[] = [1, 2];

export function isTerminalSlot(value: unknown): value is TerminalSlot {
  return value === 1 || value === 2;
}

/** 1 つのターミナルに適用されるテーマ */
export type ThemeSlotSnapshot = {
  presetKey: ThemePresetKey;
  palette: ThemePalette;
  /** true の場合は Terminal 1 のテーマを引き継いでいる（個別設定なし） */
  inherited: boolean;
};

/** Webview に渡すテーマのスナップショット（ターミナルごとの配色・プリセット一覧） */
export type ThemeSnapshot = {
  slots: Record<TerminalSlot, ThemeSlotSnapshot>;
  presets: ThemePresetInfo[];
};

// ============================================================================
// Renderer Types
// ============================================================================

/**
 * xterm.js の描画方式。
 * - `auto`: WebGL を試し、使えなければ DOM レンダラに落とす（既定）
 * - `webgl`: WebGL を明示的に要求する（失敗時はやはり DOM に落ちる）
 * - `dom`: 常に DOM レンダラ
 */
export type RendererType = 'auto' | 'webgl' | 'dom';

export function isRendererType(value: unknown): value is RendererType {
  return value === 'auto' || value === 'webgl' || value === 'dom';
}

// ============================================================================
// Session Types
// ============================================================================

export type SessionMeta = {
  shell: string;
  label: string;
  slot?: TerminalSlot;
};

// ============================================================================
// Message Types (Extension <-> Webview Communication)
// ============================================================================

/** Payload for the theme-update message (Extension → Webview) */
export type ThemeUpdatePayload = ThemeSnapshot;

/**
 * Messages sent from Extension to Webview.
 * (Extension が Webview に送るメッセージ。Webview から見ると Inbound)
 */
export type InboundMessage =
  | {type: 'session-count'; payload: {total: number}}
  | {
      type: 'session-created';
      payload: {id: string; shell: string; label?: string; slot?: TerminalSlot};
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
  | {type: 'renderer-update'; payload: {rendererType: RendererType}}
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
  | {type: 'theme-select'; payload: {presetKey: string; slot?: number}}
  | {type: 'open-link'; payload: {uri: string}}
  | {type: 'copy-link'; payload: {uri: string}}
  | {
      type: 'image-drop';
      payload: {
        fileName: string;
        mimeType: string;
        data: string;
        sessionId: string;
      };
    };
