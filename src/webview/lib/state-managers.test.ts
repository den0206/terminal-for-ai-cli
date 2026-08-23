import {describe, expect, it} from 'vitest';
import {SHARED_CONSTANTS} from '../../shared/constants';
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

describe('SessionStateManager output buffer', () => {
  it('returns the chunks in order', () => {
    const state = new SessionStateManager(emptyState);
    state.addSession('a', 'zsh');
    state.appendToBuffer('a', 'one ');
    state.appendToBuffer('a', 'two ');
    state.appendToBuffer('a', 'three');
    expect(state.getBuffer('a')).toBe('one two three');
  });

  it('starts a buffer for a session it has not seen', () => {
    const state = new SessionStateManager(emptyState);
    state.appendToBuffer('ghost', 'hello');
    expect(state.getBuffer('ghost')).toBe('hello');
  });

  it('ignores empty chunks', () => {
    const state = new SessionStateManager(emptyState);
    state.addSession('a', 'zsh');
    state.appendToBuffer('a', '');
    expect(state.getBuffer('a')).toBe('');
  });

  it('keeps the newest output once the cap is passed', () => {
    const state = new SessionStateManager(emptyState);
    state.addSession('a', 'zsh');
    const chunk = 'x'.repeat(100_000);
    // 25 chunks = 2.5M chars against a 2M cap
    for (let i = 0; i < 25; i++) {
      state.appendToBuffer('a', chunk);
    }
    state.appendToBuffer('a', 'TAIL');

    const buffer = state.getBuffer('a') ?? '';
    expect(buffer.endsWith('TAIL')).toBe(true);
    // Hard cap: trimming slices into the head chunk rather than overshooting
    expect(buffer.length).toBe(SHARED_CONSTANTS.MAX_BUFFER_SIZE);
  });

  it('trims a single chunk that is larger than the cap on its own', () => {
    const state = new SessionStateManager(emptyState);
    state.addSession('a', 'zsh');
    state.appendToBuffer(
      'a',
      'y'.repeat(SHARED_CONSTANTS.MAX_BUFFER_SIZE + 500) + 'END'
    );

    const buffer = state.getBuffer('a') ?? '';
    expect(buffer.length).toBe(SHARED_CONSTANTS.MAX_BUFFER_SIZE);
    expect(buffer.endsWith('END')).toBe(true);
  });

  it('drops the buffer when the session goes away', () => {
    const state = new SessionStateManager(emptyState);
    state.addSession('a', 'zsh');
    state.appendToBuffer('a', 'data');
    state.removeSession('a');
    expect(state.getBuffer('a')).toBeUndefined();
  });
});
