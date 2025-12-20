import process from 'node:process';
import { Worker } from 'bullmq';

function getRedisConnection() {
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
  const url = new URL(redisUrl);
  if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
    throw new Error(`Unsupported REDIS_URL protocol: ${url.protocol}`);
  }

  const port = url.port ? Number(url.port) : 6379;
  const db = url.pathname?.length > 1 ? Number(url.pathname.slice(1)) : 0;
  const password = url.password ? decodeURIComponent(url.password) : undefined;

  return {
    host: url.hostname,
    port,
    db: Number.isFinite(db) ? db : 0,
    password,
    tls: url.protocol === 'rediss:' ? {} : undefined,
  };
}

const queueName = process.env.WORKER_QUEUE_NAME ?? 'dev-ping';
const connection = getRedisConnection();

const worker = new Worker(
  queueName,
  async (job) => {
    if (job.name === 'ping') {
      return { ok: true, ts: Date.now() };
    }
    return { ok: true };
  },
  { connection },
);

worker.on('ready', () => {
  console.log(
    `[worker] ready queue=${queueName} redis=${connection.host}:${connection.port}`,
  );
});

worker.on('completed', (job) => {
  console.log(`[worker] completed id=${job.id} name=${job.name}`);
});

worker.on('failed', (job, err) => {
  console.error(
    `[worker] failed id=${job?.id ?? 'unknown'} name=${job?.name ?? 'unknown'} err=${err?.message ?? err}`,
  );
});

worker.on('error', (err) => {
  console.error(`[worker] error ${err?.message ?? err}`);
});

async function shutdown(signal) {
  console.log(`[worker] shutting down (${signal})...`);
  await worker.close();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
