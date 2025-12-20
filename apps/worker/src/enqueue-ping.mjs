import process from 'node:process';
import { Queue } from 'bullmq';

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
const queue = new Queue(queueName, { connection: getRedisConnection() });

const job = await queue.add('ping', { hello: 'world' }, { removeOnComplete: 100 });
console.log(`[enqueue] queued ${queueName} jobId=${job.id}`);
await queue.close();
