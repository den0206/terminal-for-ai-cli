import {describe, expect, it, vi} from 'vitest';
import {getThemeSnapshot} from './themeSnapshot';

describe('themeSnapshot', () => {
  it('returns modern preset when config returns valid preset key', () => {
    const getConfig = vi.fn((key: string) =>
      key === 'themePreset' ? 'ocean' : undefined
    );
    const snapshot = getThemeSnapshot(getConfig);
    expect(snapshot.presetKey).toBe('ocean');
    expect(snapshot.palette).toBeDefined();
    expect(snapshot.presets.length).toBeGreaterThan(0);
  });

  it('falls back to modern when preset is invalid', () => {
    const getConfig = vi.fn((key: string) =>
      key === 'themePreset' ? 'invalid-preset' : undefined
    );
    const logWarning = vi.fn();
    const snapshot = getThemeSnapshot(getConfig, {logWarning});
    expect(snapshot.presetKey).toBe('modern');
    expect(logWarning).toHaveBeenCalledWith(
      expect.stringContaining('Invalid theme preset configured')
    );
  });

  it('falls back to modern when preset is empty and does not log', () => {
    const getConfig = vi.fn((key: string) =>
      key === 'themePreset' ? '' : undefined
    );
    const logWarning = vi.fn();
    const snapshot = getThemeSnapshot(getConfig, {logWarning});
    expect(snapshot.presetKey).toBe('modern');
    expect(logWarning).not.toHaveBeenCalled();
  });

  it('includes all preset keys in presets array', () => {
    const getConfig = vi.fn((key: string) =>
      key === 'themePreset' ? 'modern' : undefined
    );
    const snapshot = getThemeSnapshot(getConfig);
    const keys = snapshot.presets.map((p) => p.key);
    expect(keys).toContain('modern');
    expect(keys).toContain('ocean');
    expect(keys.length).toBeGreaterThanOrEqual(5);
  });
});
