/**
 * @file auth.service.ts
 * @description Authentication service for Ed25519 signature verification
 */
import { Injectable } from '@nestjs/common';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { RedisService } from '../infrastructure/redis.module.js';

export interface VerifySignatureParams {
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  rawBody: string;
  pubkey: string;
  signature: string;
  allowNonceReplay?: boolean;
}

export interface VerifyResult {
  valid: boolean;
  errorCode?: 'INVALID_SIGNATURE' | 'TIMESTAMP_OUT_OF_RANGE' | 'NONCE_REPLAY' | 'BAD_REQUEST';
  message?: string;
  nonceReplay?: boolean;
}

@Injectable()
export class AuthService {
  private readonly TIMESTAMP_WINDOW_MS = 60_000; // 60 seconds

  constructor(private readonly redis: RedisService) {}

  /**
   * Verify Ed25519 signature using Node.js crypto
   */
  async verifySignature(params: VerifySignatureParams): Promise<VerifyResult> {
    const { method, path, timestamp, nonce, rawBody, pubkey, signature, allowNonceReplay } = params;

    // Validate header format
    if (!this.isValidHex(pubkey, 64)) {
      return { valid: false, errorCode: 'INVALID_SIGNATURE', message: 'Invalid pubkey format' };
    }

    if (!this.isValidHex(signature, 128)) {
      return { valid: false, errorCode: 'INVALID_SIGNATURE', message: 'Invalid signature format' };
    }

    if (nonce.includes('|')) {
      return { valid: false, errorCode: 'BAD_REQUEST', message: 'Nonce cannot contain |' };
    }

    // Check timestamp window
    const ts = parseInt(timestamp, 10);
    if (isNaN(ts)) {
      return { valid: false, errorCode: 'INVALID_SIGNATURE', message: 'Invalid timestamp' };
    }

    const now = Date.now();
    if (Math.abs(now - ts) >= this.TIMESTAMP_WINDOW_MS) {
      return { valid: false, errorCode: 'TIMESTAMP_OUT_OF_RANGE', message: 'Timestamp out of range' };
    }

    // Check nonce replay
    const nonceOk = await this.redis.checkAndSetNonce(pubkey, nonce);
    if (!nonceOk && !allowNonceReplay) {
      return { valid: false, errorCode: 'NONCE_REPLAY', message: 'Nonce already used' };
    }
    const nonceReplay = !nonceOk;

    // Calculate body hash
    const bodyHash = rawBody
      ? createHash('sha256').update(rawBody).digest('hex')
      : '';

    // Build canonical message (PATH without query string)
    const pathWithoutQuery = path.split('?')[0];
    const canonical = `v1|${method}|${pathWithoutQuery}|${timestamp}|${nonce}|${bodyHash}`;

    try {
      const pubkeyBytes = Buffer.from(pubkey, 'hex');
      const signatureBytes = Buffer.from(signature, 'hex');

      // Create Ed25519 public key object
      const keyObject = createPublicKey({
        key: Buffer.concat([
          // Ed25519 public key DER header
          Buffer.from('302a300506032b6570032100', 'hex'),
          pubkeyBytes,
        ]),
        format: 'der',
        type: 'spki',
      });

      // Verify the signature
      const isValid = verify(
        null, // Ed25519 doesn't use a digest algorithm
        Buffer.from(canonical, 'utf8'),
        keyObject,
        signatureBytes,
      );

      if (!isValid) {
        return { valid: false, errorCode: 'INVALID_SIGNATURE', message: 'Signature verification failed' };
      }

      return { valid: true, nonceReplay };
    } catch {
      return { valid: false, errorCode: 'INVALID_SIGNATURE', message: 'Signature verification error' };
    }
  }

  private isValidHex(str: string, expectedLength: number): boolean {
    if (str.length !== expectedLength) return false;
    return /^[0-9a-f]+$/i.test(str);
  }
}
