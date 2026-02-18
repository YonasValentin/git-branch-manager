import * as crypto from 'crypto';

/**
 * Generates a cryptographic nonce for Content Security Policy.
 * @returns A 32-character hex string
 */
export function getNonce(): string {
  return crypto.randomBytes(16).toString('hex');
}
