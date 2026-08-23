import {describe, expect, it} from 'vitest';
import {isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {
  getDefaultShell,
  normalizeExternalUrl,
  validateShellPath,
  validateStartupCommands,
  validateWorkingDirectory,
} from './validation';

describe('validation', () => {
  describe('validateShellPath', () => {
    it('should reject undefined or empty paths', () => {
      expect(validateShellPath(undefined)).toBe(false);
      expect(validateShellPath('')).toBe(false);
      expect(validateShellPath('   ')).toBe(false);
    });

    it('should reject relative paths', () => {
      expect(validateShellPath('bin/bash')).toBe(false);
      expect(validateShellPath('./bash')).toBe(false);
      expect(validateShellPath('../bash')).toBe(false);
    });

    it('should reject non-existent paths', () => {
      expect(validateShellPath('/nonexistent/shell')).toBe(false);
    });

    it('should accept valid shell paths', () => {
      const shell = getDefaultShell();
      expect(validateShellPath(shell)).toBe(true);
    });

    it('should reject path traversal attempts', () => {
      expect(validateShellPath('/bin/../../../etc/passwd')).toBe(false);
    });
  });

  describe('getDefaultShell', () => {
    it('should return a valid shell path', () => {
      const shell = getDefaultShell();
      expect(shell).toBeTruthy();
      expect(typeof shell).toBe('string');
      expect(shell.length).toBeGreaterThan(0);
    });

    it('should return an absolute path', () => {
      const shell = getDefaultShell();
      // Use Node's path.isAbsolute to check for absolute paths on any platform
      expect(isAbsolute(shell)).toBe(true);
    });
  });

  describe('validateStartupCommands', () => {
    it('should return empty array for non-array input', () => {
      expect(validateStartupCommands(null)).toEqual([]);
      expect(validateStartupCommands(undefined)).toEqual([]);
      expect(validateStartupCommands('not an array')).toEqual([]);
      expect(validateStartupCommands(123)).toEqual([]);
    });

    it('should filter out non-string elements', () => {
      const input = ['echo hello', 123, null, 'ls', undefined];
      const result = validateStartupCommands(input);
      expect(result).toEqual(['echo hello', 'ls']);
    });

    it('should trim commands and filter empty strings', () => {
      const input = ['  echo hello  ', '', '   ', 'ls'];
      const result = validateStartupCommands(input);
      expect(result).toEqual(['echo hello', 'ls']);
    });

    it('should accept safe commands', () => {
      const input = ['echo "Hello, World!"', 'ls -la', 'pwd'];
      const result = validateStartupCommands(input);
      expect(result).toEqual(input);
    });

    it('should warn about dangerous commands but not block them', () => {
      // This test verifies that dangerous commands are still allowed
      // (users have control), but warnings are logged
      const input = ['rm -rf /tmp/test', 'ls'];
      const result = validateStartupCommands(input);
      expect(result).toEqual(input);
    });
  });

  describe('validateWorkingDirectory', () => {
    it('should return undefined for invalid input', () => {
      expect(validateWorkingDirectory(undefined)).toBeUndefined();
      expect(validateWorkingDirectory('')).toBeUndefined();
      expect(validateWorkingDirectory('   ')).toBeUndefined();
    });

    it('should return undefined for non-existent paths', () => {
      expect(
        validateWorkingDirectory('/nonexistent/directory')
      ).toBeUndefined();
    });

    it('should return absolute path for valid directories', () => {
      // Use os.tmpdir() which works on all platforms (Unix: /tmp, Windows: C:\Users\...\Temp)
      const result = validateWorkingDirectory(tmpdir());
      expect(result).toBeTruthy();
      expect(isAbsolute(result!)).toBe(true);
    });

    it('should reject files (only directories allowed)', () => {
      // This test assumes /etc/hosts exists as a file
      const result = validateWorkingDirectory('/etc/hosts');
      expect(result).toBeUndefined();
    });
  });

  describe('normalizeExternalUrl', () => {
    it('should accept http and https URLs', () => {
      expect(
        normalizeExternalUrl('https://auth.openai.com/codex/device')
      ).toBe('https://auth.openai.com/codex/device');
      expect(normalizeExternalUrl('http://localhost:3000/callback')).toBe(
        'http://localhost:3000/callback'
      );
    });

    it('should reject other schemes and malformed input', () => {
      expect(normalizeExternalUrl('file:///etc/passwd')).toBeUndefined();
      expect(normalizeExternalUrl('vscode://install')).toBeUndefined();
      expect(normalizeExternalUrl('javascript:alert(1)')).toBeUndefined();
      expect(normalizeExternalUrl('not a url')).toBeUndefined();
      expect(normalizeExternalUrl(undefined)).toBeUndefined();
    });

    it('should reject absurdly long URLs', () => {
      expect(
        normalizeExternalUrl(`https://example.com/${'a'.repeat(2048)}`)
      ).toBeUndefined();
    });

    // The URL parser silently drops these, so the string shown in the confirm
    // prompt would name a different host than the one that actually opens.
    it.each([
      ['tab', '\t'],
      ['newline', '\n'],
      ['carriage return', '\r'],
    ])('should reject a %s hiding a different host', (_name, control) => {
      expect(
        normalizeExternalUrl(`https://good.example.com${control}@evil.example`)
      ).toBeUndefined();
    });

    it('should normalize so the returned host is the host that opens', () => {
      expect(normalizeExternalUrl('https://good.example.com@evil.example')).toBe(
        'https://good.example.com@evil.example/'
      );
    });
  });
});
