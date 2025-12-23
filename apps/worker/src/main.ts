/**
 * @file main.ts
 * @description Worker main entry point (Step 18)
 *
 * BullMQ worker that processes:
 * - ai:argument-analysis - Argument stance + embedding analysis
 *
 * @see docs/stage01/ai-worker.md
 * @see docs/stage01/steps/step18.md
 */

import process from 'node:process';
import http from 'node:http';
import { Worker, Queue, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { getPrisma } from '@epiphany/database';

import { getRedisConnection } from './lib/redis-connection.js';
import { createAIProvider } from './providers/provider-factory.js';
import { processArgumentAnalysis } from './processors/argument-analysis.js';
import { processTopicCluster, enqueueTopicClusterDebounced, type TopicClusterEngine } from './processors/topic-cluster.js';
import { createNodeTopicClusterEngine } from './clustering/node-topic-cluster-engine.js';
import { createPythonTopicClusterEngine } from './clustering/python-topic-cluster-engine.js';
import {
  processConsensusReport,
  type ConsensusReportProvider,
  type GenerateConsensusReportInput,
} from './processors/consensus-report.js';

// Queue names per docs/stage01/ai-worker.md (using underscore instead of colon for BullMQ compatibility)
const QUEUE_ARGUMENT_ANALYSIS = 'ai_argument-analysis';
const QUEUE_TOPIC_CLUSTER = 'ai_topic-cluster';
const QUEUE_CONSENSUS_REPORT = 'ai_consensus-report';

// Configuration
const port = Number(process.env.PORT ?? process.env.WORKER_PORT ?? 3002);
const connection = getRedisConnection();

function isAuthorizedDebugRequest(req: http.IncomingMessage): boolean {
  const token = process.env.WORKER_DEBUG_TOKEN;
  if (!token) return false;
  const header = req.headers['x-worker-debug-token'];
  if (typeof header !== 'string') return false;
  return header === token;
}

// Initialize dependencies
const prisma = getPrisma();
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
const aiProvider = createAIProvider();

// Create queues for health checks
const argumentAnalysisQueue = new Queue(QUEUE_ARGUMENT_ANALYSIS, { connection });
const topicClusterQueue = new Queue(QUEUE_TOPIC_CLUSTER, { connection });
const consensusReportQueue = new Queue(QUEUE_CONSENSUS_REPORT, { connection });

function getTopicClusterEngine(): TopicClusterEngine {
  const configured = (process.env.CLUSTER_ENGINE ?? 'node').toLowerCase();
  if (configured === 'python') {
    try {
      return createPythonTopicClusterEngine();
    } catch (err) {
      console.warn('[worker] CLUSTER_ENGINE=python misconfigured; falling back to node:', err);
      return createNodeTopicClusterEngine();
    }
  }

  return createNodeTopicClusterEngine();
}

const topicClusterEngine = getTopicClusterEngine();

const consensusReportProvider: ConsensusReportProvider = {
  async generate(input: GenerateConsensusReportInput) {
    const bulletLines = input.arguments
      .slice(0, 10)
      .map((arg) => {
        const title = arg.title?.trim() ? ` — ${arg.title.trim()}` : '';
        const excerpt = arg.body.trim().slice(0, 160).replaceAll('\n', ' ');
        return `- (${arg.totalVotes} votes) ${arg.id}${title}: ${excerpt}${arg.body.length > 160 ? '…' : ''}`;
      })
      .join('\n');

    const contentMd = [
      '# 共识报告',
      '',
      `Topic: ${input.topicTitle}`,
      '',
      '## 输入摘要（Top arguments）',
      '',
      bulletLines || '- (no arguments)',
      '',
      '## 结论（mock）',
      '',
      '- 这是 mock 报告内容；后续可替换为真实 LLM Prompt Chaining。',
    ].join('\n');

    return { contentMd, model: 'mock-report-model' };
  },
};

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

    // Trigger topic clustering debounce after analysis is completed (Step 19)
    if (result.topicId && !result.shortCircuited) {
      try {
        await enqueueTopicClusterDebounced(topicClusterQueue, result.topicId);
      } catch (err) {
        console.warn(
          `[worker] Failed to enqueue topic-cluster for topicId=${result.topicId}:`,
          err
        );
      }
    }

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

/**
 * Topic Cluster Job Payload
 */
interface TopicClusterJobData {
  topicId: string;
}

/**
 * Topic Cluster Worker
 */
const topicClusterWorker = new Worker<TopicClusterJobData>(
  QUEUE_TOPIC_CLUSTER,
  async (job: Job<TopicClusterJobData>) => {
    const { topicId } = job.data;

    console.log(`[worker] Processing topic-cluster job=${job.id} topicId=${topicId}`);

    const result = await processTopicCluster({
      topicId,
      prisma,
      redis,
      engine: topicClusterEngine,
    });

    if (!result.success) {
      console.warn(`[worker] Topic cluster job=${job.id} failed: ${result.error}`);
    }

    return result;
  },
  {
    connection,
    concurrency: 1, // CPU-heavy; keep low
  }
);

/**
 * Consensus Report Job Payload
 */
interface ConsensusReportJobData {
  topicId: string;
  reportId: string;
  trigger: 'auto' | 'host';
}

/**
 * Consensus Report Worker
 */
const consensusReportWorker = new Worker<ConsensusReportJobData>(
  QUEUE_CONSENSUS_REPORT,
  async (job: Job<ConsensusReportJobData>) => {
    const { topicId, reportId, trigger } = job.data;

    console.log(
      `[worker] Processing consensus-report job=${job.id} topicId=${topicId} reportId=${reportId} trigger=${trigger}`,
    );

    const result = await processConsensusReport({
      topicId,
      reportId,
      trigger,
      prisma,
      redis,
      provider: consensusReportProvider,
    });

    if (!result.success) {
      console.warn(`[worker] consensus-report job=${job.id} failed: ${result.error}`);
    }

    return result;
  },
  {
    connection,
    concurrency: 1,
  },
);

topicClusterWorker.on('ready', () => {
  console.log(
    `[worker] Topic cluster worker ready queue=${QUEUE_TOPIC_CLUSTER} redis=${connection.host}:${connection.port}`
  );
});

topicClusterWorker.on('completed', (job) => {
  console.log(`[worker] Completed job=${job.id} name=${job.name}`);
});

topicClusterWorker.on('failed', (job, err) => {
  console.error(
    `[worker] Failed job=${job?.id ?? 'unknown'} name=${job?.name ?? 'unknown'} err=${err?.message ?? err}`
  );
});

topicClusterWorker.on('error', (err) => {
  console.error(`[worker] Worker error: ${err?.message ?? err}`);
});

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

consensusReportWorker.on('ready', () => {
  console.log(
    `[worker] Consensus report worker ready queue=${QUEUE_CONSENSUS_REPORT} redis=${connection.host}:${connection.port}`,
  );
});

consensusReportWorker.on('completed', (job) => {
  console.log(`[worker] Completed job=${job.id} name=${job.name}`);
});

consensusReportWorker.on('failed', (job, err) => {
  console.error(
    `[worker] Failed job=${job?.id ?? 'unknown'} name=${job?.name ?? 'unknown'} err=${err?.message ?? err}`,
  );
});

consensusReportWorker.on('error', (err) => {
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
        const client1 = await argumentAnalysisQueue.client;
        await client1.ping();
        const client2 = await topicClusterQueue.client;
        await client2.ping();
        const client3 = await consensusReportQueue.client;
        await client3.ping();
        await prisma.$queryRaw`SELECT 1`;
        writeJson(res, 200, {
          ok: true,
          queues: [QUEUE_ARGUMENT_ANALYSIS, QUEUE_TOPIC_CLUSTER, QUEUE_CONSENSUS_REPORT],
        });
        return;
      } catch (err) {
        console.error('[worker] Health check failed:', err);
        writeJson(res, 503, { ok: false, error: 'Health check failed' });
        return;
      }
    }

    // Debug: Manually enqueue an argument for analysis
    if (path === '/enqueue-analysis' && req.method === 'POST') {
      // Disabled unless explicitly enabled via a secret token.
      // This endpoint must never be exposed unauthenticated on the public Internet.
      if (!isAuthorizedDebugRequest(req)) {
        res.writeHead(404);
        res.end();
        return;
      }

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
  await topicClusterWorker.close();
  await topicClusterQueue.close();
  await consensusReportWorker.close();
  await consensusReportQueue.close();
  await redis.quit();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
