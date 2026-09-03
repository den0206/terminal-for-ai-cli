import {describe, expect, it} from 'vitest';
import {formatRestoredScrollback} from './scrollback-restore';

const snapshot = {
  data: 'npm test\r\nok\r\n',
  cols: 80,
  rows: 24,
  savedAt: new Date('2026-09-03T09:41:00').getTime(),
  label: 'Terminal 1',
};

describe('formatRestoredScrollback', () => {
  it('keeps the stored output intact', () => {
    expect(formatRestoredScrollback(snapshot)).toContain(snapshot.data);
  });

  it('marks both ends so restored history cannot be read as live output', () => {
    const text = formatRestoredScrollback(snapshot);
    const banner = text.slice(0, text.indexOf(snapshot.data));

    expect(banner).toContain('Terminal 1');
    expect(banner).toContain('2026-09-03 09:41');
    expect(banner).toContain('history only');
    expect(text.slice(text.indexOf(snapshot.data))).toContain(
      'end of restored history'
    );
  });

  it('falls back to a generic label when none was stored', () => {
    const text = formatRestoredScrollback({...snapshot, label: undefined});
    expect(text).toContain('Previous session');
  });

  it('does not print an invalid date', () => {
    const text = formatRestoredScrollback({...snapshot, savedAt: Number.NaN});
    expect(text).toContain('an earlier session');
    expect(text).not.toContain('NaN');
  });
});
