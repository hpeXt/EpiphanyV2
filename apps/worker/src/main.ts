/**
 * @file main.ts
 * @description Worker main entry point (Step 18)
 *
 * BullMQ worker that processes:
 * - ai:argument-analysis - Argument stance + embedding analysis
 *
 * @see docs/ai-worker.md
 * @see docs/steps/step18.md
 */

import process from 'node:process';
import http from 'node:http';
import { Worker, Queue, type Job } from 'bullmq';
import Redis from 'ioredis';
import { getPrisma } from '@epiphany/database';

import { getRedisConnection } from './lib/redis-connection.js';
import { createAIProvider } from './providers/provider-factory.js';
import { processArgumentAnalysis } from './processors/argument-analysis.js';

// Queue names per docs/ai-worker.md (using underscore instead of colon for BullMQ compatibility)
const QUEUE_ARGUMENT_ANALYSIS = 'ai_argument-analysis';

// Configuration
const port = Number(process.env.PORT ?? process.env.WORKER_PORT ?? 3002);
const connection = getRedisConnection();

// Initialize dependencies
const prisma = getPrisma();
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
const aiProvider = createAIProvider();

// Create queues for health checks
const argumentAnalysisQueue = new Queue(QUEUE_ARGUMENT_ANALYSIS, { connection });

/**
 * Argument Analysis Job Payload
 */
interface ArgumentAnalysisJobData {
  argumentId: string;
}

/**
 * Argument Analysis Worker
 */
const argumentAnalysisWorker = new Worker<ArgumentAnalysisJobData>(
  QUEUE_ARGUMENT_ANALYSIS,
  async (job: Job<ArgumentAnalysisJobData>) => {
    const { argumentId } = job.data;

    console.log(`[worker] Processing argument-analysis job=${job.id} argumentId=${argumentId}`);

    const result = await processArgumentAnalysis({
      argumentId,
      prisma,
      redis,
      aiProvider,
    });

    if (!result.success) {
      // Log but don't throw - we've already handled the failure in the processor
      console.warn(`[worker] Job ${job.id} completed with failure: ${result.error}`);
    }

    return result;
  },
  {
    connection,
    concurrency: 5, // Process up to 5 jobs concurrently
  }
);

// Worker event handlers
argumentAnalysisWorker.on('ready', () => {
  console.log(
    `[worker] Argument analysis worker ready queue=${QUEUE_ARGUMENT_ANALYSIS} redis=${connection.host}:${connection.port}`
  );
});

argumentAnalysisWorker.on('completed', (job) => {
  console.log(`[worker] Completed job=${job.id} name=${job.name}`);
});

argumentAnalysisWorker.on('failed', (job, err) => {
  console.error(
    `[worker] Failed job=${job?.id ?? 'unknown'} name=${job?.name ?? 'unknown'} err=${err?.message ?? err}`
  );
});

argumentAnalysisWorker.on('error', (err) => {
  console.error(`[worker] Worker error: ${err?.message ?? err}`);
});

// HTTP response helper
function writeJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

/**
 * HTTP server for health checks and debugging
 */
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;

    // Health check endpoint
    if (path === '/' || path === '/health') {
      try {
        const client = await argumentAnalysisQueue.client;
        await client.ping();
        await prisma.$queryRaw`SELECT 1`;
        writeJson(res, 200, { ok: true, queues: [QUEUE_ARGUMENT_ANALYSIS] });
        return;
      } catch (err) {
        console.error('[worker] Health check failed:', err);
        writeJson(res, 503, { ok: false, error: 'Health check failed' });
        return;
      }
    }

    // Debug: Manually enqueue an argument for analysis
    if (path === '/enqueue-analysis' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
      }

      try {
        const data = JSON.parse(body) as { argumentId?: string };
        if (!data.argumentId) {
          writeJson(res, 400, { error: 'argumentId required' });
          return;
        }

        const job = await argumentAnalysisQueue.add(
          'analysis',
          { argumentId: data.argumentId },
          {
            jobId: `arg_${data.argumentId}`,
            removeOnComplete: 100,
            removeOnFail: 100,
          }
        );

        writeJson(res, 202, { queued: true, jobId: job.id });
        return;
      } catch (err) {
        console.error('[worker] Enqueue failed:', err);
        writeJson(res, 500, { error: 'Failed to enqueue' });
        return;
      }
    }

    res.writeHead(404);
    res.end();
  } catch {
    res.writeHead(500);
    res.end();
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`[worker] HTTP listening port=${port}`);
});

/**
 * Graceful shutdown
 */
async function shutdown(signal: string): Promise<void> {
  console.log(`[worker] Shutting down (${signal})...`);
  server.close();
  await argumentAnalysisWorker.close();
  await argumentAnalysisQueue.close();
  await redis.quit();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
