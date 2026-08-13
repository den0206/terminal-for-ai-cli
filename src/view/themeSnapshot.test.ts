import {describe, expect, it, vi} from 'vitest';
import {Logger} from '../utils/logger';
import {getThemeSnapshot} from './themeSnapshot';

vi.mock('../utils/logger', () => ({
  Logger: {info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn()},
}));

const config = (themePreset: unknown) => ({get: () => themePreset});

describe('themeSnapshot', () => {
  it('returns the configured preset when the key is valid', () => {
    const snapshot = getThemeSnapshot(config('ocean'));
    expect(snapshot.presetKey).toBe('ocean');
    expect(snapshot.palette).toBeDefined();
    expect(snapshot.presets.length).toBeGreaterThan(0);
  });

  it('falls back to modern and warns when the preset is invalid', () => {
    const snapshot = getThemeSnapshot(config('invalid-preset'));
    expect(snapshot.presetKey).toBe('modern');
    expect(Logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Invalid theme preset configured')
    );
  });

  it('falls back to modern without warning when unset', () => {
    vi.mocked(Logger.warn).mockClear();
    const snapshot = getThemeSnapshot(config(''));
    expect(snapshot.presetKey).toBe('modern');
    expect(Logger.warn).not.toHaveBeenCalled();
  });

  it('includes every preset key', () => {
    const keys = getThemeSnapshot(config('modern')).presets.map((p) => p.key);
    expect(keys).toContain('modern');
    expect(keys).toContain('ocean');
    expect(keys.length).toBeGreaterThanOrEqual(5);
  });
});
