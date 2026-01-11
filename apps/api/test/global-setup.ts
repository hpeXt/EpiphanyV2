import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { spawnSync } from 'node:child_process';

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
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ??
    'postgresql://postgres:postgres@localhost:5432/epiphany_test';
  process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379/1';

  const dbName = getDatabaseName(process.env.DATABASE_URL);
  if (!dbName || (!dbName.endsWith('_test') && !dbName.endsWith('_e2e'))) {
    throw new Error(
      `Refusing to run e2e global setup against DATABASE_URL=${process.env.DATABASE_URL} (expected db name to end with _test or _e2e).`,
    );
  }

  const redisDb = getRedisDbIndex(process.env.REDIS_URL ?? '');
  if (redisDb === null || redisDb === 0) {
    throw new Error(
      `Refusing to run e2e global setup against REDIS_URL=${process.env.REDIS_URL} (expected redis db index != 0, e.g. redis://localhost:6379/1).`,
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

function runMigrations() {
  const deploy = spawnSync('pnpm', ['--filter', '@epiphany/database', 'db:migrate:deploy'], {
    env: process.env,
    encoding: 'utf8',
  });

  if (deploy.stdout) process.stdout.write(deploy.stdout);
  if (deploy.stderr) process.stderr.write(deploy.stderr);

  if (deploy.status === 0) return;

  const output = `${deploy.stdout ?? ''}\n${deploy.stderr ?? ''}`;
  if (output.includes('P3005')) {
    const reset = spawnSync(
      'pnpm',
      ['--filter', '@epiphany/database', 'prisma', 'migrate', 'reset', '--force', '--skip-seed', '--skip-generate'],
      { env: process.env, encoding: 'utf8' },
    );

    if (reset.stdout) process.stdout.write(reset.stdout);
    if (reset.stderr) process.stderr.write(reset.stderr);

    if (reset.status === 0) return;
  }

  throw new Error('Failed to prepare test database schema for e2e tests.');
}

export default async function globalSetup() {
  assertSafeE2eEnv();
  runMigrations();
  await resetDatabase();
  await resetRedis();
}
