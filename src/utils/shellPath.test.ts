import {describe, expect, it} from 'vitest';
import {escapeShellPath, parseUriList} from './shellPath';

describe('escapeShellPath', () => {
  it('wraps a POSIX path in single quotes', () => {
    expect(escapeShellPath('/home/me/notes.md', 'darwin')).toBe(
      "'/home/me/notes.md'"
    );
  });

  it('keeps spaces and shell metacharacters literal', () => {
    expect(escapeShellPath('/tmp/a b/$(rm -rf ~);.txt', 'linux')).toBe(
      "'/tmp/a b/$(rm -rf ~);.txt'"
    );
  });

  it('breaks out of the quotes for an embedded single quote', () => {
    expect(escapeShellPath("/tmp/it's here.txt", 'darwin')).toBe(
      "'/tmp/it'\\''s here.txt'"
    );
  });

  it('wraps a Windows path in double quotes', () => {
    expect(escapeShellPath('C:\\Users\\me\\a b.txt', 'win32')).toBe(
      '"C:\\Users\\me\\a b.txt"'
    );
  });

  it.each([
    'C:\\a"b.txt',
    'C:\\%PATH%.txt',
    'C:\\a!b.txt',
    // PowerShell expands these inside double quotes, and it is a shell this
    // extension supports; a dropped file is named by whoever made it.
    'C:\\$(calc).txt',
    'C:\\$env:PATH.txt',
    'C:\\a`b.txt',
  ])('refuses %s on Windows rather than quoting it wrongly', (filePath) => {
    expect(() => escapeShellPath(filePath, 'win32')).toThrow();
  });

  it('quotes those same characters on POSIX, where they are harmless', () => {
    expect(escapeShellPath('/tmp/a"b%c!d$(e)`f.txt', 'linux')).toBe(
      '\'/tmp/a"b%c!d$(e)`f.txt\''
    );
  });
});

describe('parseUriList', () => {
  it('reads one URI per line', () => {
    expect(parseUriList('file:///a.txt\r\nfile:///b.txt\r\n')).toEqual([
      'file:///a.txt',
      'file:///b.txt',
    ]);
  });

  it('ignores comments and blank lines', () => {
    expect(
      parseUriList('# comment\n\nfile:///a.txt\n   \nfile:///b.txt')
    ).toEqual(['file:///a.txt', 'file:///b.txt']);
  });

  it('drops duplicates, which some drops repeat', () => {
    expect(parseUriList('file:///a.txt\nfile:///a.txt')).toEqual([
      'file:///a.txt',
    ]);
  });

  it('returns nothing for an empty payload', () => {
    expect(parseUriList('   \n\n')).toEqual([]);
  });
});
