import { randomBytes } from 'crypto';

/**
 * Generates a cryptographically secure random nonce for CSP
 * @param length The desired length of the nonce (default: 16)
 * @returns A base64url-encoded random string
 */
export function getNonce(length = 16): string {
  // Generate cryptographically secure random bytes
  const bytes = randomBytes(Math.ceil(length * 3 / 4));

  // Convert to base64url (safe for use in URLs and HTML attributes)
  return bytes
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
    .substring(0, length);
}
