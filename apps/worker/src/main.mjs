import process from 'node:process';
import http from 'node:http';
import { Worker } from 'bullmq';
import { Queue } from 'bullmq';

function getRedisConnection() {
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
  };
}

const queueName = process.env.WORKER_QUEUE_NAME ?? 'dev-ping';
const port = Number(process.env.PORT ?? process.env.WORKER_PORT ?? 3002);
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

const queue = new Queue(queueName, { connection });

function writeJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;

    if (path === '/' || path === '/health') {
      try {
        const client = await queue.client;
        await client.ping();
        writeJson(res, 200, { ok: true });
        return;
      } catch {
        writeJson(res, 503, { ok: false });
        return;
      }
    }

    if (path === '/enqueue-ping') {
      if (req.method !== 'POST') {
        res.writeHead(405);
        res.end();
        return;
      }

      const job = await queue.add('ping', {}, { removeOnComplete: 100, removeOnFail: 100 });
      writeJson(res, 202, { queued: true, jobId: job.id });
      return;
    }

    res.writeHead(404);
    res.end();
  } catch {
    res.writeHead(500);
    res.end();
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`[worker] http listening port=${port}`);
});

async function shutdown(signal) {
  console.log(`[worker] shutting down (${signal})...`);
  server.close();
  await worker.close();
  await queue.close();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
