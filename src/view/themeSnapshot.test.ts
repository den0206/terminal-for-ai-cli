import {describe, expect, it, vi} from 'vitest';
import {Logger} from '../utils/logger';
import {getThemeSnapshot} from './themeSnapshot';

vi.mock('../utils/logger', () => ({
  Logger: {info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn()},
}));

const config = (themePreset: unknown, themePresetSecondary?: unknown) => ({
  get: (key: string) =>
    key === 'themePresetSecondary' ? themePresetSecondary : themePreset,
});

describe('themeSnapshot', () => {
  it('returns the configured preset when the key is valid', () => {
    const snapshot = getThemeSnapshot(config('ocean'));
    expect(snapshot.slots[1].presetKey).toBe('ocean');
    expect(snapshot.slots[1].palette).toBeDefined();
    expect(snapshot.presets.length).toBeGreaterThan(0);
  });

  it('falls back to modern and warns when the preset is invalid', () => {
    const snapshot = getThemeSnapshot(config('invalid-preset'));
    expect(snapshot.slots[1].presetKey).toBe('modern');
    expect(Logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Invalid theme preset configured')
    );
  });

  it('falls back to modern without warning when unset', () => {
    vi.mocked(Logger.warn).mockClear();
    const snapshot = getThemeSnapshot(config(''));
    expect(snapshot.slots[1].presetKey).toBe('modern');
    expect(Logger.warn).not.toHaveBeenCalled();
  });

  it('includes every preset key', () => {
    const keys = getThemeSnapshot(config('modern')).presets.map((p) => p.key);
    expect(keys).toContain('modern');
    expect(keys).toContain('ocean');
    expect(keys.length).toBeGreaterThanOrEqual(5);
  });

  describe('per-terminal themes', () => {
    it('gives each terminal its own preset when both are configured', () => {
      const snapshot = getThemeSnapshot(config('ocean', 'homebrew'));
      expect(snapshot.slots[1].presetKey).toBe('ocean');
      expect(snapshot.slots[2].presetKey).toBe('homebrew');
      expect(snapshot.slots[1].palette).not.toEqual(snapshot.slots[2].palette);
      expect(snapshot.slots[2].inherited).toBe(false);
    });

    it('inherits the Terminal 1 theme when Terminal 2 is unset', () => {
      const snapshot = getThemeSnapshot(config('grass'));
      expect(snapshot.slots[2].presetKey).toBe('grass');
      expect(snapshot.slots[2].inherited).toBe(true);
      expect(snapshot.slots[1].inherited).toBe(false);
    });

    it('falls back to the Terminal 1 theme when Terminal 2 is invalid', () => {
      vi.mocked(Logger.warn).mockClear();
      const snapshot = getThemeSnapshot(config('ocean', 'nope'));
      expect(snapshot.slots[2].presetKey).toBe('ocean');
      expect(Logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('themePresetSecondary')
      );
    });
  });
});
