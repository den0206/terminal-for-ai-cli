import {describe, expect, it} from 'vitest';
import {SessionStateManager, ThemeStateManager} from './state-managers';
import type {ViewState} from './types';

const emptyState: ViewState = {totalSessions: 0, sessionIds: []};

describe('SessionStateManager terminal slots', () => {
  it('keeps the slot sent by the extension', () => {
    const state = new SessionStateManager(emptyState);
    state.addSession('a', 'zsh', 'Terminal 2', 2);
    expect(state.getSessionSlot('a')).toBe(2);
  });

  it('falls back to the position when no slot is provided', () => {
    const state = new SessionStateManager(emptyState);
    state.addSession('a', 'zsh');
    state.addSession('b', 'zsh');
    expect(state.getSessionSlot('a')).toBe(1);
    expect(state.getSessionSlot('b')).toBe(2);
  });

  it('restores slots from persisted state', () => {
    const state = new SessionStateManager({
      totalSessions: 2,
      sessionIds: ['a', 'b'],
      sessionMeta: {
        a: {shell: 'zsh', label: 'Terminal 1', slot: 1},
        b: {shell: 'zsh', label: 'Terminal 2', slot: 2},
      },
    });
    expect(state.getSessionSlot('a')).toBe(1);
    expect(state.getSessionSlot('b')).toBe(2);
  });

  it('derives slots for state persisted before slots existed', () => {
    const state = new SessionStateManager({
      totalSessions: 2,
      sessionIds: ['a', 'b'],
      sessionMeta: {
        a: {shell: 'zsh', label: 'Terminal 1'},
        b: {shell: 'zsh', label: 'Terminal 2'},
      },
    });
    expect(state.getSessionSlot('a')).toBe(1);
    expect(state.getSessionSlot('b')).toBe(2);
  });

  it('returns undefined for unknown sessions', () => {
    const state = new SessionStateManager(emptyState);
    expect(state.getSessionSlot('missing')).toBeUndefined();
    expect(state.getSessionSlot(undefined)).toBeUndefined();
  });
});

describe('ThemeStateManager', () => {
  const palette = {
    background: '#000',
    foreground: '#fff',
    cursor: '#fff',
    selection: 'rgba(255,255,255,0.2)',
  };

  it('resolves the theme of each terminal', () => {
    const theme = new ThemeStateManager();
    theme.slotThemes = {
      1: {presetKey: 'ocean', palette, inherited: false},
      2: {presetKey: 'homebrew', palette, inherited: false},
    };
    expect(theme.getSlotTheme(1)?.presetKey).toBe('ocean');
    expect(theme.getSlotTheme(2)?.presetKey).toBe('homebrew');
    expect(theme.getSlotTheme(undefined)).toBeUndefined();
    expect(theme.getBaseTheme()?.presetKey).toBe('ocean');
  });

  it('looks up preset info by key', () => {
    const theme = new ThemeStateManager();
    theme.availablePresets = [
      {
        key: 'ocean',
        label: 'Ocean',
        description: 'blue',
        preview: {background: '#001f3f', foreground: '#d0ebff'},
      },
    ];
    expect(theme.getPresetInfo('ocean')?.label).toBe('Ocean');
    expect(theme.getPresetInfo('missing')).toBeUndefined();
    expect(theme.getPresetInfo(undefined)).toBeUndefined();
  });
});
