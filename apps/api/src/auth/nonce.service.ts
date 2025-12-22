/**
 * @file nonce.service.ts
 * @description Nonce deduplication service using Redis
 * @see docs/stage01/api-contract.md#1.4
 */
import { Injectable, Inject, Optional } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';

const NONCE_TTL_SECONDS = 60;
const NONCE_KEY_PREFIX = 'nonce:';

@Injectable()
export class NonceService {
  constructor(
    @Optional()
    @InjectRedis()
    private readonly redis?: Redis,
  ) {}

  /**
   * Check if a nonce has been used before and mark it as used.
   *
   * @param nonce - The nonce to check
   * @returns true if nonce is new (not seen before), false if it's a replay
   */
  async checkAndMarkNonce(nonce: string): Promise<boolean> {
    if (!this.redis) {
      // If Redis is not available, allow all requests (for testing without Redis)
      return true;
    }

    const key = `${NONCE_KEY_PREFIX}${nonce}`;

    // Use SET with NX (only set if not exists) and EX (expiry)
    // Returns 'OK' if the key was set, null if it already exists
    const result = await this.redis.set(key, '1', 'EX', NONCE_TTL_SECONDS, 'NX');

    return result === 'OK';
  }
}
