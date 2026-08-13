import {randomBytes} from 'node:crypto';

/**
 * Generates a cryptographically secure random nonce for CSP
 * @param length The desired length of the nonce (default: 16)
 * @returns A base64url-encoded random string
 */
export function getNonce(length = 16): string {
  return randomBytes(Math.ceil((length * 3) / 4))
    .toString('base64url')
    .substring(0, length);
}
