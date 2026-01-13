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

import { loadEnv } from './env.js';
import { getRedisConnection } from './lib/redis-connection.js';
import { createAIProvider, getAIProviderType } from './providers/provider-factory.js';
import { processArgumentAnalysis } from './processors/argument-analysis.js';
import { processTopicCluster, enqueueTopicClusterDebounced, type TopicClusterEngine } from './processors/topic-cluster.js';
import { createNodeTopicClusterEngine } from './clustering/node-topic-cluster-engine.js';
import { createPythonTopicClusterEngine } from './clustering/python-topic-cluster-engine.js';
import {
  processConsensusReport,
} from './processors/consensus-report.js';
import { createConsensusReportProvider, getConsensusReportProviderDiagnostics } from './providers/consensus-report-provider.js';
import { processTranslation } from './processors/translation.js';
import { createTranslationProvider } from './providers/translation-provider.js';
import { startTranslationAutomation } from './translation/translation-automation.js';

// Queue names per docs/stage01/ai-worker.md (using underscore instead of colon for BullMQ compatibility)
const QUEUE_ARGUMENT_ANALYSIS = 'ai_argument-analysis';
const QUEUE_TOPIC_CLUSTER = 'ai_topic-cluster';
const QUEUE_CONSENSUS_REPORT = 'ai_consensus-report';
const QUEUE_TRANSLATION = 'ai_translation';

type WorkerHeartbeat = {
  readyAtMs: number | null;
  lastActiveAtMs: number | null;
  lastCompletedAtMs: number | null;
  lastFailedAtMs: number | null;
  lastError: string | null;
  paused: boolean;
  stalledCount: number;
  lockRenewalFailedCount: number;
};

function createWorkerHeartbeat(): WorkerHeartbeat {
  return {
    readyAtMs: null,
    lastActiveAtMs: null,
    lastCompletedAtMs: null,
    lastFailedAtMs: null,
    lastError: null,
    paused: false,
    stalledCount: 0,
    lockRenewalFailedCount: 0,
  };
}

// Configuration
loadEnv();
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
const translationQueue = new Queue(QUEUE_TRANSLATION, { connection });

const workerHeartbeats = {
  argumentAnalysis: createWorkerHeartbeat(),
  topicCluster: createWorkerHeartbeat(),
  consensusReport: createWorkerHeartbeat(),
  translation: createWorkerHeartbeat(),
};

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
const consensusReportProvider = createConsensusReportProvider();
const translationProvider = createTranslationProvider();
startTranslationAutomation({ prisma, redis, queue: translationQueue, provider: translationProvider });

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

/**
 * Translation Job Payload
 */
interface TranslationJobData {
  resourceType: 'topic_title' | 'argument' | 'consensus_report' | 'camp' | 'topic_profile_display_name';
  resourceId: string;
  targetLocale: 'zh' | 'en';
}

/**
 * Translation Worker
 */
const translationWorker = new Worker<TranslationJobData>(
  QUEUE_TRANSLATION,
  async (job: Job<TranslationJobData>) => {
    const { resourceType, resourceId, targetLocale } = job.data;

    console.log(
      `[worker] Processing translation job=${job.id} resourceType=${resourceType} resourceId=${resourceId} targetLocale=${targetLocale}`,
    );

    const result = await processTranslation({
      job: { resourceType, resourceId, targetLocale },
      prisma,
      redis,
      provider: translationProvider,
    });

    if (!result.success) {
      console.warn(`[worker] translation job=${job.id} failed: ${result.error}`);
    }

    return result;
  },
  {
    connection,
    concurrency: 2,
  },
);

topicClusterWorker.on('ready', () => {
  workerHeartbeats.topicCluster.readyAtMs = Date.now();
  console.log(
    `[worker] Topic cluster worker ready queue=${QUEUE_TOPIC_CLUSTER} redis=${connection.host}:${connection.port}`
  );
});

topicClusterWorker.on('active', () => {
  workerHeartbeats.topicCluster.lastActiveAtMs = Date.now();
});

topicClusterWorker.on('completed', (job) => {
  workerHeartbeats.topicCluster.lastCompletedAtMs = Date.now();
  console.log(`[worker] Completed job=${job.id} name=${job.name}`);
});

topicClusterWorker.on('failed', (job, err) => {
  workerHeartbeats.topicCluster.lastFailedAtMs = Date.now();
  workerHeartbeats.topicCluster.lastError = err?.message ?? String(err);
  console.error(
    `[worker] Failed job=${job?.id ?? 'unknown'} name=${job?.name ?? 'unknown'} err=${err?.message ?? err}`
  );
});

topicClusterWorker.on('stalled', (jobId) => {
  workerHeartbeats.topicCluster.stalledCount += 1;
  console.warn(`[worker] Stalled job=${jobId} queue=${QUEUE_TOPIC_CLUSTER}`);
});

topicClusterWorker.on('lockRenewalFailed', (jobIds) => {
  workerHeartbeats.topicCluster.lockRenewalFailedCount += 1;
  console.warn(`[worker] Lock renewal failed queue=${QUEUE_TOPIC_CLUSTER} jobIds=${jobIds.join(',')}`);
});

topicClusterWorker.on('paused', () => {
  workerHeartbeats.topicCluster.paused = true;
  console.warn(`[worker] Queue paused queue=${QUEUE_TOPIC_CLUSTER}`);
});

topicClusterWorker.on('resumed', () => {
  workerHeartbeats.topicCluster.paused = false;
  console.log(`[worker] Queue resumed queue=${QUEUE_TOPIC_CLUSTER}`);
});

topicClusterWorker.on('error', (err) => {
  workerHeartbeats.topicCluster.lastError = err?.message ?? String(err);
  console.error(`[worker] Worker error: ${err?.message ?? err}`);
});

// Worker event handlers
argumentAnalysisWorker.on('ready', () => {
  workerHeartbeats.argumentAnalysis.readyAtMs = Date.now();
  console.log(
    `[worker] Argument analysis worker ready queue=${QUEUE_ARGUMENT_ANALYSIS} redis=${connection.host}:${connection.port}`
  );
});

argumentAnalysisWorker.on('active', () => {
  workerHeartbeats.argumentAnalysis.lastActiveAtMs = Date.now();
});

argumentAnalysisWorker.on('completed', (job) => {
  workerHeartbeats.argumentAnalysis.lastCompletedAtMs = Date.now();
  console.log(`[worker] Completed job=${job.id} name=${job.name}`);
});

argumentAnalysisWorker.on('failed', (job, err) => {
  workerHeartbeats.argumentAnalysis.lastFailedAtMs = Date.now();
  workerHeartbeats.argumentAnalysis.lastError = err?.message ?? String(err);
  console.error(
    `[worker] Failed job=${job?.id ?? 'unknown'} name=${job?.name ?? 'unknown'} err=${err?.message ?? err}`
  );
});

argumentAnalysisWorker.on('stalled', (jobId) => {
  workerHeartbeats.argumentAnalysis.stalledCount += 1;
  console.warn(`[worker] Stalled job=${jobId} queue=${QUEUE_ARGUMENT_ANALYSIS}`);
});

argumentAnalysisWorker.on('lockRenewalFailed', (jobIds) => {
  workerHeartbeats.argumentAnalysis.lockRenewalFailedCount += 1;
  console.warn(`[worker] Lock renewal failed queue=${QUEUE_ARGUMENT_ANALYSIS} jobIds=${jobIds.join(',')}`);
});

argumentAnalysisWorker.on('paused', () => {
  workerHeartbeats.argumentAnalysis.paused = true;
  console.warn(`[worker] Queue paused queue=${QUEUE_ARGUMENT_ANALYSIS}`);
});

argumentAnalysisWorker.on('resumed', () => {
  workerHeartbeats.argumentAnalysis.paused = false;
  console.log(`[worker] Queue resumed queue=${QUEUE_ARGUMENT_ANALYSIS}`);
});

argumentAnalysisWorker.on('error', (err) => {
  workerHeartbeats.argumentAnalysis.lastError = err?.message ?? String(err);
  console.error(`[worker] Worker error: ${err?.message ?? err}`);
});

consensusReportWorker.on('ready', () => {
  workerHeartbeats.consensusReport.readyAtMs = Date.now();
  console.log(
    `[worker] Consensus report worker ready queue=${QUEUE_CONSENSUS_REPORT} redis=${connection.host}:${connection.port}`,
  );
});

consensusReportWorker.on('active', () => {
  workerHeartbeats.consensusReport.lastActiveAtMs = Date.now();
});

consensusReportWorker.on('completed', (job) => {
  workerHeartbeats.consensusReport.lastCompletedAtMs = Date.now();
  console.log(`[worker] Completed job=${job.id} name=${job.name}`);
});

consensusReportWorker.on('failed', (job, err) => {
  workerHeartbeats.consensusReport.lastFailedAtMs = Date.now();
  workerHeartbeats.consensusReport.lastError = err?.message ?? String(err);
  console.error(
    `[worker] Failed job=${job?.id ?? 'unknown'} name=${job?.name ?? 'unknown'} err=${err?.message ?? err}`,
  );
});

consensusReportWorker.on('stalled', (jobId) => {
  workerHeartbeats.consensusReport.stalledCount += 1;
  console.warn(`[worker] Stalled job=${jobId} queue=${QUEUE_CONSENSUS_REPORT}`);
});

consensusReportWorker.on('lockRenewalFailed', (jobIds) => {
  workerHeartbeats.consensusReport.lockRenewalFailedCount += 1;
  console.warn(`[worker] Lock renewal failed queue=${QUEUE_CONSENSUS_REPORT} jobIds=${jobIds.join(',')}`);
});

consensusReportWorker.on('paused', () => {
  workerHeartbeats.consensusReport.paused = true;
  console.warn(`[worker] Queue paused queue=${QUEUE_CONSENSUS_REPORT}`);
});

consensusReportWorker.on('resumed', () => {
  workerHeartbeats.consensusReport.paused = false;
  console.log(`[worker] Queue resumed queue=${QUEUE_CONSENSUS_REPORT}`);
});

consensusReportWorker.on('error', (err) => {
  workerHeartbeats.consensusReport.lastError = err?.message ?? String(err);
  console.error(`[worker] Worker error: ${err?.message ?? err}`);
});

translationWorker.on('ready', () => {
  workerHeartbeats.translation.readyAtMs = Date.now();
  console.log(
    `[worker] Translation worker ready queue=${QUEUE_TRANSLATION} redis=${connection.host}:${connection.port}`,
  );
});

translationWorker.on('active', () => {
  workerHeartbeats.translation.lastActiveAtMs = Date.now();
});

translationWorker.on('completed', (job) => {
  workerHeartbeats.translation.lastCompletedAtMs = Date.now();
  console.log(`[worker] Completed job=${job.id} name=${job.name}`);
});

translationWorker.on('failed', (job, err) => {
  workerHeartbeats.translation.lastFailedAtMs = Date.now();
  workerHeartbeats.translation.lastError = err?.message ?? String(err);
  console.error(
    `[worker] Failed job=${job?.id ?? 'unknown'} name=${job?.name ?? 'unknown'} err=${err?.message ?? err}`,
  );
});

translationWorker.on('stalled', (jobId) => {
  workerHeartbeats.translation.stalledCount += 1;
  console.warn(`[worker] Stalled job=${jobId} queue=${QUEUE_TRANSLATION}`);
});

translationWorker.on('lockRenewalFailed', (jobIds) => {
  workerHeartbeats.translation.lockRenewalFailedCount += 1;
  console.warn(`[worker] Lock renewal failed queue=${QUEUE_TRANSLATION} jobIds=${jobIds.join(',')}`);
});

translationWorker.on('paused', () => {
  workerHeartbeats.translation.paused = true;
  console.warn(`[worker] Queue paused queue=${QUEUE_TRANSLATION}`);
});

translationWorker.on('resumed', () => {
  workerHeartbeats.translation.paused = false;
  console.log(`[worker] Queue resumed queue=${QUEUE_TRANSLATION}`);
});

translationWorker.on('error', (err) => {
  workerHeartbeats.translation.lastError = err?.message ?? String(err);
  console.error(`[worker] Worker error: ${err?.message ?? err}`);
});

// HTTP response helper
function writeJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function getTranslationBudgetTokensPerMonth(): number | null {
  const fallback = 200_000;
  const raw = process.env.TRANSLATION_BUDGET_TOKENS_PER_MONTH;
  if (!raw) return fallback;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < 0) return null; // unlimited
  return parsed; // 0 disables external calls
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
        const client4 = await translationQueue.client;
        await client4.ping();
        await prisma.$queryRaw`SELECT 1`;

        const [argumentAnalysisCounts, topicClusterCounts, consensusReportCounts, translationCounts] = await Promise.all([
          argumentAnalysisQueue.getJobCounts('waiting', 'active', 'delayed', 'failed'),
          topicClusterQueue.getJobCounts('waiting', 'active', 'delayed', 'failed'),
          consensusReportQueue.getJobCounts('waiting', 'active', 'delayed', 'failed'),
          translationQueue.getJobCounts('waiting', 'active', 'delayed', 'failed'),
        ]);

        writeJson(res, 200, {
          ok: true,
          queues: [QUEUE_ARGUMENT_ANALYSIS, QUEUE_TOPIC_CLUSTER, QUEUE_CONSENSUS_REPORT, QUEUE_TRANSLATION],
          queueCounts: {
            [QUEUE_ARGUMENT_ANALYSIS]: argumentAnalysisCounts,
            [QUEUE_TOPIC_CLUSTER]: topicClusterCounts,
            [QUEUE_CONSENSUS_REPORT]: consensusReportCounts,
            [QUEUE_TRANSLATION]: translationCounts,
          },
          workerHeartbeats,
          providers: {
            ai: getAIProviderType(),
            consensusReport: getConsensusReportProviderDiagnostics(),
            translation: translationProvider.provider,
          },
          translation: {
            model: process.env.TRANSLATION_MODEL ?? 'z-ai/glm-4.7',
            budgetTokensPerMonth: getTranslationBudgetTokensPerMonth(),
          },
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
  await translationWorker.close();
  await translationQueue.close();
  await redis.quit();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
