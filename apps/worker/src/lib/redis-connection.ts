/**
 * @file redis-connection.ts
 * @description Redis connection helper for BullMQ
 */

import type { RedisOptions } from 'ioredis';

export function getRedisConnection(): RedisOptions {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.error('[worker] REDIS_URL is required');
    process.exit(1);
  }

  const url = new URL(redisUrl);
  if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
    throw new Error(`Unsupported REDIS_URL protocol: ${url.protocol}`);
  }

  const port = url.port ? Number(url.port) : 6379;
  const db = url.pathname?.length > 1 ? Number(url.pathname.slice(1)) : 0;
  const username = url.username ? decodeURIComponent(url.username) : undefined;
  const password = url.password ? decodeURIComponent(url.password) : undefined;

  return {
    host: url.hostname,
    port,
    db: Number.isFinite(db) ? db : 0,
    username,
    password,
    tls: url.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null, // Required for BullMQ
  };
}
