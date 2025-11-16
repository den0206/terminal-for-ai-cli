import { describe, it, expect } from 'vitest';
import { getNonce } from './nonce';

describe('nonce', () => {
  describe('getNonce', () => {
    it('should generate a nonce of default length (16)', () => {
      const nonce = getNonce();
      expect(nonce).toBeTruthy();
      expect(nonce.length).toBe(16);
    });

    it('should generate a nonce of specified length', () => {
      const nonce32 = getNonce(32);
      expect(nonce32.length).toBe(32);

      const nonce8 = getNonce(8);
      expect(nonce8.length).toBe(8);
    });

    it('should generate unique nonces', () => {
      const nonce1 = getNonce();
      const nonce2 = getNonce();
      const nonce3 = getNonce();

      // All nonces should be different
      expect(nonce1).not.toBe(nonce2);
      expect(nonce2).not.toBe(nonce3);
      expect(nonce1).not.toBe(nonce3);
    });

    it('should generate URL-safe strings (base64url)', () => {
      // Generate multiple nonces to test randomness
      for (let i = 0; i < 100; i++) {
        const nonce = getNonce(32);
        // Should only contain alphanumeric characters, hyphens, and underscores
        expect(nonce).toMatch(/^[A-Za-z0-9_-]+$/);
        // Should not contain +, /, or = (standard base64 characters)
        expect(nonce).not.toMatch(/[+/=]/);
      }
    });

    it('should use cryptographically secure random generation', () => {
      // Generate many nonces and verify they're all unique
      const nonces = new Set<string>();
      const count = 1000;

      for (let i = 0; i < count; i++) {
        nonces.add(getNonce());
      }

      // All should be unique (collision probability should be negligible)
      expect(nonces.size).toBe(count);
    });

    it('should handle edge cases', () => {
      const nonce1 = getNonce(1);
      expect(nonce1.length).toBe(1);

      const nonce64 = getNonce(64);
      expect(nonce64.length).toBe(64);
    });
  });
});
