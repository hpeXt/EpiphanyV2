/**
 * @file crypto.util.ts
 * @description Crypto utilities for signature verification using Node.js native crypto
 * @see docs/crypto.md
 */
import { createHash, createPublicKey, verify } from 'crypto';

/**
 * Compute SHA256 hash of a UTF-8 string, returned as lowercase hex.
 */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Build canonical message for signature verification (v1 format).
 *
 * Format: v1|METHOD|PATH|TIMESTAMP|NONCE|BODY_HASH
 *
 * @see docs/api-contract.md#1.3
 */
export function buildCanonicalMessage(opts: {
  method: string;
  path: string;
  timestamp: string | number;
  nonce: string;
  rawBody?: string | Buffer | null;
}): string {
  let bodyHash = '';

  if (opts.rawBody) {
    const bodyString =
      typeof opts.rawBody === 'string'
        ? opts.rawBody
        : opts.rawBody.toString('utf8');
    bodyHash = sha256Hex(bodyString);
  }

  return `v1|${opts.method.toUpperCase()}|${opts.path}|${opts.timestamp}|${opts.nonce}|${bodyHash}`;
}

/**
 * Verify Ed25519 signature using Node.js native crypto.
 *
 * @param pubkeyHex - Public key as 64-char hex string (32 bytes)
 * @param message - The canonical message that was signed
 * @param signatureHex - Signature as 128-char hex string (64 bytes)
 * @returns true if signature is valid
 */
export function verifySignature(
  pubkeyHex: string,
  message: string,
  signatureHex: string,
): boolean {
  try {
    const pubkeyBytes = Buffer.from(pubkeyHex, 'hex');
    const signatureBytes = Buffer.from(signatureHex, 'hex');
    const messageBytes = Buffer.from(message, 'utf8');

    // Create a public key object from the raw Ed25519 public key bytes
    const publicKey = createPublicKey({
      key: Buffer.concat([
        // Ed25519 public key DER prefix
        Buffer.from('302a300506032b6570032100', 'hex'),
        pubkeyBytes,
      ]),
      format: 'der',
      type: 'spki',
    });

    return verify(null, messageBytes, publicKey, signatureBytes);
  } catch {
    return false;
  }
}

/**
 * Validate hex string format.
 *
 * @param hex - String to validate
 * @param expectedLength - Expected length in characters (not bytes)
 * @returns true if valid hex of expected length
 */
export function isValidHex(hex: string, expectedLength: number): boolean {
  if (hex.length !== expectedLength) return false;
  return /^[0-9a-f]+$/i.test(hex);
}
