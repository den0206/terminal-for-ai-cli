import type {FitAddon} from '@xterm/addon-fit';
import type {Terminal} from '@xterm/xterm';
import {SessionMeta} from '../../shared/types';

// Re-export shared types
export type {
  InboundMessage,
  OutboundMessage,
  RendererType,
  SessionMeta,
  TerminalSlot,
  ThemePalette,
  ThemePresetInfo,
  ThemeSlotSnapshot,
  ThemeUpdatePayload,
} from '../../shared/types';

// ============================================================================
// VSCode API Types
// ============================================================================

export interface VSCodeApi<State = unknown> {
  postMessage<T = unknown>(message: T): void;
  setState(state: State): void;
  getState(): State | undefined;
}

// ============================================================================
// View Types
// ============================================================================

export type ViewMode = 'single' | 'split';

export const PANES = ['primary', 'secondary'] as const;
export type Pane = (typeof PANES)[number];

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
