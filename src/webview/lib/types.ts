import type {Terminal} from '@xterm/xterm';
import type {FitAddon} from '@xterm/addon-fit';

// ============================================================================
// VSCode API Types
// ============================================================================

export interface VSCodeApi<State = unknown> {
  postMessage<T = unknown>(message: T): void;
  setState(state: State): void;
  getState(): State | undefined;
}

// ============================================================================
// Theme Types
// ============================================================================

export type ThemePalette = {
  background: string;
  foreground: string;
  cursor: string;
  selection: string;
};

export type ThemePresetInfo = {
  key: string;
  label: string;
  description: string;
  preview: {background: string; foreground: string};
};

export type ThemeUpdatePayload = {
  presetKey: string;
  palette: ThemePalette;
  presets: ThemePresetInfo[];
};

// ============================================================================
// Session Types
// ============================================================================

export type SessionMeta = {shell: string; label: string};

// ============================================================================
// View Types
// ============================================================================

export type ViewMode = 'single' | 'split';
export type Pane = 'primary' | 'secondary';

export type ViewState = {
  activeSessionId?: string;
  totalSessions: number;
  sessionIds: string[];
  terminalHeight?: number;
  sessionMeta?: Record<string, SessionMeta>;
  viewMode?: ViewMode;
  splitRatio?: number;
};

export type PaneContext = {terminal: Terminal; fitAddon: FitAddon};

// ============================================================================
// Message Types
// ============================================================================

export type InboundMessage =
  | {type: 'session-count'; payload: {total: number}}
  | {
      type: 'session-created';
      payload: {
        id: string;
        shell: string;
        pid?: number;
        label?: string;
        restored?: boolean;
      };
    }
  | {type: 'session-data'; payload: {sessionId: string; data: string}}
  | {
      type: 'session-exited';
      payload: {sessionId: string; code: number | null; signal: string | null};
    }
  | {type: 'session-error'; payload: {message: string}}
  | {type: 'session-limit-reached'; payload: {max: number}}
  | {type: 'theme-update'; payload: ThemeUpdatePayload}
  | {type: 'all-sessions-cleared'};

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
