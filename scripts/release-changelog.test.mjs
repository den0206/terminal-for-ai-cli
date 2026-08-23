import {describe, expect, it} from 'vitest';
import {cutRelease} from './release-changelog.mjs';

const BASE = 'https://github.com/den0206/terminal-for-ai-cli';

const sample = [
  '# Change Log',
  '',
  '## [Unreleased]',
  '',
  '### Added',
  '',
  '- A new thing',
  '',
  '## [0.1.0] - 2026-08-15',
  '',
  '### Added',
  '',
  '- The old thing',
  '',
  `[Unreleased]: ${BASE}/compare/Ver_0.1.0...HEAD`,
  `[0.1.0]: ${BASE}/releases/tag/Ver_0.1.0`,
  '',
].join('\n');

describe('cutRelease', () => {
  it('moves the Unreleased body under a dated version heading', () => {
    const {changed, text} = cutRelease(sample, '0.2.0', '2026-08-23');

    expect(changed).toBe(true);
    expect(text).toContain('## [0.2.0] - 2026-08-23');
    // Unreleased stays, and stays empty, ready for the next cycle
    const between = text.slice(
      text.indexOf('## [Unreleased]') + '## [Unreleased]'.length,
      text.indexOf('## [0.2.0]')
    );
    expect(between.trim()).toBe('');
    expect(text.indexOf('- A new thing')).toBeGreaterThan(text.indexOf('## [0.2.0]'));
    expect(text.indexOf('- A new thing')).toBeLessThan(text.indexOf('## [0.1.0]'));
  });

  it('rewrites the compare links', () => {
    const {text} = cutRelease(sample, '0.2.0', '2026-08-23');

    expect(text).toContain(`[Unreleased]: ${BASE}/compare/Ver_0.2.0...HEAD`);
    expect(text).toContain(`[0.2.0]: ${BASE}/compare/Ver_0.1.0...Ver_0.2.0`);
  });

  it('is a no-op when the version was already cut', () => {
    const once = cutRelease(sample, '0.2.0', '2026-08-23').text;
    const twice = cutRelease(once, '0.2.0', '2026-08-24');

    expect(twice.changed).toBe(false);
    expect(twice.text).toBe(once);
    expect(twice.reason).toContain('既に切り出し済み');
  });

  it('refuses to create an empty heading', () => {
    const empty = sample.replace('### Added\n\n- A new thing\n\n', '');
    const result = cutRelease(empty, '0.2.0', '2026-08-23');

    expect(result.changed).toBe(false);
    expect(result.reason).toContain('項目が無い');
  });

  it('leaves a changelog without compare links intact', () => {
    const noLinks = sample.split(`[Unreleased]: ${BASE}`)[0];
    const {changed, text} = cutRelease(noLinks, '0.2.0', '2026-08-23');

    expect(changed).toBe(true);
    expect(text).toContain('## [0.2.0] - 2026-08-23');
    expect(text).not.toContain('compare/');
  });

  it('links to the tag when there is no previous version', () => {
    const first = ['# Change Log', '', '## [Unreleased]', '', '- First release', '', `[Unreleased]: ${BASE}/compare/Ver_0.0.1...HEAD`, ''].join('\n');
    const {text} = cutRelease(first, '0.1.0', '2026-08-23');

    expect(text).toContain(`[0.1.0]: ${BASE}/releases/tag/Ver_0.1.0`);
  });

  it('rejects malformed input', () => {
    expect(() => cutRelease(sample, '1.2', '2026-08-23')).toThrow('X.Y.Z');
    expect(() => cutRelease(sample, '1.2.3', '2026/08/23')).toThrow('YYYY-MM-DD');
    expect(() => cutRelease('# Change Log\n', '1.2.3', '2026-08-23')).toThrow('Unreleased');
  });
});
