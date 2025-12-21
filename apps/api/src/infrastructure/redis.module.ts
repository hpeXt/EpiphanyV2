/**
 * @file redis.module.ts
 * @description Redis module for NestJS
 */
import { Global, Module, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

export class RedisService extends Redis implements OnModuleDestroy {
  constructor() {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    super(redisUrl);
  }

  onModuleDestroy() {
    this.disconnect();
  }

  /**
   * Store claim token with TTL
   * @param topicId - Topic ID
   * @param token - Claim token value
   * @param ttlSeconds - TTL in seconds (default 300 = 5 minutes)
   */
  async setClaimToken(topicId: string, token: string, ttlSeconds = 300): Promise<void> {
    const key = `claim:${topicId}`;
    await this.set(key, token, 'EX', ttlSeconds);
  }

  /**
   * Validate and consume claim token (one-time use)
   * @param topicId - Topic ID
   * @param token - Token to validate
   * @returns 'valid' | 'invalid' | 'expired'
   */
  async consumeClaimToken(topicId: string, token: string): Promise<'valid' | 'invalid' | 'expired'> {
    const key = `claim:${topicId}`;
    const consumedKey = `claim:consumed:${topicId}`;
    const storedToken = await this.get(key);

    if (storedToken === null) {
      // Token either expired or never existed
      const wasConsumed = await this.get(consumedKey);
      return wasConsumed ? 'invalid' : 'expired';
    }

    if (storedToken !== token) {
      return 'invalid';
    }

    const ttl = await this.ttl(key);
    const consumedTtlSeconds = ttl > 0 ? ttl : 600;

    // Consume token and mark as used (so reuse is INVALID, not EXPIRED).
    await this.multi()
      .del(key)
      .set(consumedKey, '1', 'EX', consumedTtlSeconds)
      .exec();
    return 'valid';
  }

  /**
   * Check nonce for replay protection
   * @param pubkey - User pubkey (hex)
   * @param nonce - Request nonce
   * @param ttlSeconds - TTL in seconds (default 60)
   * @returns true if nonce is new, false if already used
   */
  async checkAndSetNonce(pubkey: string, nonce: string, ttlSeconds = 60): Promise<boolean> {
    const key = `nonce:${pubkey}:${nonce}`;
    const result = await this.set(key, '1', 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }
}

@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
