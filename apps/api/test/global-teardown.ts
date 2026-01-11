import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';

function getDatabaseName(databaseUrl: string): string | null {
  try {
    const url = new URL(databaseUrl);
    const name = url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname;
    return name || null;
  } catch {
    const match = databaseUrl.match(/\/([^/?#]+)(?:[?#]|$)/);
    return match?.[1] ?? null;
  }
}

function getRedisDbIndex(redisUrl: string): number | null {
  try {
    const url = new URL(redisUrl);
    const raw = url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname;
    if (!raw) return 0;
    const num = Number.parseInt(raw, 10);
    return Number.isFinite(num) ? num : 0;
  } catch {
    return null;
  }
}

function assertSafeE2eEnv() {
  const dbName = process.env.DATABASE_URL ? getDatabaseName(process.env.DATABASE_URL) : null;
  if (!dbName || (!dbName.endsWith('_test') && !dbName.endsWith('_e2e'))) {
    throw new Error(
      `Refusing to run e2e global teardown against DATABASE_URL=${process.env.DATABASE_URL} (expected db name to end with _test or _e2e).`,
    );
  }

  const redisDb = process.env.REDIS_URL ? getRedisDbIndex(process.env.REDIS_URL) : null;
  if (redisDb === null || redisDb === 0) {
    throw new Error(
      `Refusing to run e2e global teardown against REDIS_URL=${process.env.REDIS_URL} (expected redis db index != 0, e.g. redis://localhost:6379/1).`,
    );
  }
}

async function resetDatabase() {
  const prisma = new PrismaClient();
  await prisma.$connect();
  try {
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        topic_identity_profiles,
        topic_pubkey_blacklist,
        consensus_reports,
        cluster_data,
        camps,
        stakes,
        ledgers,
        set_votes_idempotency,
        arguments,
        topics
      CASCADE;
    `);
  } finally {
    await prisma.$disconnect();
  }
}

async function resetRedis() {
  const redis = new Redis(process.env.REDIS_URL);
  try {
    await redis.flushdb();
  } finally {
    await redis.quit();
  }
}

export default async function globalTeardown() {
  assertSafeE2eEnv();
  await resetDatabase();
  await resetRedis();
}

