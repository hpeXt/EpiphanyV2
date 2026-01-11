process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5432/epiphany_test';

process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379/1';

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

const dbName = getDatabaseName(process.env.DATABASE_URL);
if (!dbName || (!dbName.endsWith('_test') && !dbName.endsWith('_e2e'))) {
  throw new Error(
    `Refusing to run e2e tests against DATABASE_URL=${process.env.DATABASE_URL} (expected db name to end with _test or _e2e).`,
  );
}

const redisDb = getRedisDbIndex(process.env.REDIS_URL ?? '');
if (redisDb === null || redisDb === 0) {
  throw new Error(
    `Refusing to run e2e tests against REDIS_URL=${process.env.REDIS_URL} (expected redis db index != 0, e.g. redis://localhost:6379/1).`,
  );
}

// E2E tests create many topics quickly; disable topic-creation rate limit unless explicitly set.
process.env.RISK_RL_CREATE_TOPIC_IP_LIMIT = process.env.RISK_RL_CREATE_TOPIC_IP_LIMIT ?? '0';
