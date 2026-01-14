/**
 * @file argument-analysis-automation.ts
 * @description Backfill + sweeper for argument stance/embeddings.
 *
 * Purpose:
 * - Ensure old arguments get analyzed even if they predate enqueue logic.
 * - Optionally re-embed when EMBEDDING_MODEL changes (auto/force modes).
 *
 * This module only enqueues jobs; processing happens in the BullMQ worker.
 */

import type { PrismaClient } from '@epiphany/database';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { createHash } from 'node:crypto';

type BackfillMode = 'auto' | 'force' | 'disabled';

type EnqueueStats = {
  scanned: number;
  created: number;
  alreadyQueued: number;
};

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_BATCH_SIZE = 200;
const DEFAULT_ENQUEUE_CONCURRENCY = 10;

const DEFAULT_RETRY_FAILED_AFTER_MS = 30 * 60 * 1000;

const LOCK_KEY = 'argument-analysis:automation:lock:v1';
const LOCK_TTL_MS = 4 * 60 * 1000;

const BACKFILL_DONE_KEY = 'argument-analysis:backfill:done:v1';

export function startArgumentAnalysisAutomation(params: {
  prisma: PrismaClient;
  redis: Redis;
  queue: Queue;
  providerType: 'mock' | 'openrouter';
  embeddingModel: string;
}): void {
  const enabled = getAutomationEnabled();
  if (!enabled) {
    console.log('[worker] Argument analysis automation disabled (ARGUMENT_ANALYSIS_AUTOMATION_ENABLED=0).');
    return;
  }

  const intervalMs = getIntervalMs();
  const batchSize = getBatchSize();
  const enqueueConcurrency = getEnqueueConcurrency();
  const retryFailedAfterMs = getRetryFailedAfterMs();
  const backfillMode = getBackfillMode();

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await withRedisLock(params.redis, LOCK_KEY, LOCK_TTL_MS, async () => {
        const includeMismatch = await shouldIncludeModelMismatch({
          redis: params.redis,
          providerType: params.providerType,
          embeddingModel: params.embeddingModel,
          backfillMode,
        });

        const stats = await enqueueMissingAnalysis({
          prisma: params.prisma,
          queue: params.queue,
          embeddingModel: params.embeddingModel,
          includeMismatch,
          batchSize,
          enqueueConcurrency,
          retryFailedAfterMs,
        });

        if (stats.created) {
          console.log(
            `[worker] Argument analysis sweep enqueued created=${stats.created} deduped=${stats.alreadyQueued} scanned=${stats.scanned} includeMismatch=${includeMismatch}`,
          );
        }

        if (backfillMode === 'auto' && includeMismatch) {
          const mismatchRemaining = await hasAnyModelMismatch({
            prisma: params.prisma,
            embeddingModel: params.embeddingModel,
          });
          if (!mismatchRemaining) {
            await markBackfillDone(params.redis, params.embeddingModel);
            console.log(`[worker] Argument analysis backfill done embeddingModel=${params.embeddingModel}`);
          }
        }
      });
    } catch (err) {
      console.warn('[worker] Argument analysis automation tick failed:', err);
    } finally {
      running = false;
    }
  };

  void tick();
  setInterval(() => void tick(), intervalMs);

  console.log(
    `[worker] Argument analysis automation started intervalMs=${intervalMs} batchSize=${batchSize} backfillMode=${backfillMode} provider=${params.providerType} embeddingModel=${params.embeddingModel}`,
  );
}

function getAutomationEnabled(): boolean {
  const raw = process.env.ARGUMENT_ANALYSIS_AUTOMATION_ENABLED;
  if (!raw) return true;
  return raw !== '0' && raw.toLowerCase() !== 'false';
}

function getBackfillMode(): BackfillMode {
  const raw = (process.env.ARGUMENT_ANALYSIS_BACKFILL_MODE ?? 'auto').toLowerCase();
  if (raw === 'disabled' || raw === 'off' || raw === '0' || raw === 'false') return 'disabled';
  if (raw === 'force' || raw === 'on') return 'force';
  return 'auto';
}

function getIntervalMs(): number {
  const raw = process.env.ARGUMENT_ANALYSIS_SWEEPER_INTERVAL_MS;
  if (!raw) return DEFAULT_INTERVAL_MS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1000) return DEFAULT_INTERVAL_MS;
  return parsed;
}

function getBatchSize(): number {
  const raw = process.env.ARGUMENT_ANALYSIS_SWEEPER_BATCH_SIZE;
  if (!raw) return DEFAULT_BATCH_SIZE;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_BATCH_SIZE;
  return Math.min(parsed, 5000);
}

function getEnqueueConcurrency(): number {
  const raw = process.env.ARGUMENT_ANALYSIS_SWEEPER_ENQUEUE_CONCURRENCY;
  if (!raw) return DEFAULT_ENQUEUE_CONCURRENCY;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_ENQUEUE_CONCURRENCY;
  return Math.min(parsed, 100);
}

function getRetryFailedAfterMs(): number {
  const raw = process.env.ARGUMENT_ANALYSIS_SWEEPER_RETRY_FAILED_AFTER_MS;
  if (!raw) return DEFAULT_RETRY_FAILED_AFTER_MS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_RETRY_FAILED_AFTER_MS;
  return parsed;
}

function allowMockRefresh(): boolean {
  const raw = process.env.ARGUMENT_ANALYSIS_ALLOW_MOCK_REFRESH;
  return raw === '1' || raw?.toLowerCase() === 'true';
}

async function shouldIncludeModelMismatch(params: {
  redis: Redis;
  providerType: 'mock' | 'openrouter';
  embeddingModel: string;
  backfillMode: BackfillMode;
}): Promise<boolean> {
  if (params.backfillMode === 'disabled') return false;

  // Avoid accidentally overwriting real embeddings by starting the worker in mock mode.
  if (params.providerType === 'mock' && !allowMockRefresh()) return false;

  if (params.backfillMode === 'force') return true;

  const done = await isBackfillDoneForModel(params.redis, params.embeddingModel);
  return !done;
}

async function isBackfillDoneForModel(redis: Redis, embeddingModel: string): Promise<boolean> {
  const raw = await redis.get(BACKFILL_DONE_KEY);
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as { embeddingModel?: unknown };
    return parsed?.embeddingModel === embeddingModel;
  } catch {
    return false;
  }
}

async function markBackfillDone(redis: Redis, embeddingModel: string): Promise<void> {
  await redis.set(BACKFILL_DONE_KEY, JSON.stringify({ embeddingModel, doneAt: new Date().toISOString() }));
}

async function hasAnyModelMismatch(params: { prisma: PrismaClient; embeddingModel: string }): Promise<boolean> {
  const row = await params.prisma.argument.findFirst({
    where: {
      prunedAt: null,
      analysisStatus: 'ready',
      OR: [{ embeddingModel: null }, { embeddingModel: { not: params.embeddingModel } }],
    },
    select: { id: true },
  });
  return Boolean(row);
}

async function enqueueMissingAnalysis(params: {
  prisma: PrismaClient;
  queue: Queue;
  embeddingModel: string;
  includeMismatch: boolean;
  batchSize: number;
  enqueueConcurrency: number;
  retryFailedAfterMs: number;
}): Promise<EnqueueStats> {
  const retryFailedBefore =
    params.retryFailedAfterMs > 0 ? new Date(Date.now() - params.retryFailedAfterMs) : null;

  const or: Array<Record<string, unknown>> = [
    { analysisStatus: 'pending_analysis' },
    retryFailedBefore ? { analysisStatus: 'failed', updatedAt: { lt: retryFailedBefore } } : { analysisStatus: 'failed' },
    { analysisStatus: 'ready', embeddingModel: null },
  ];

  if (params.includeMismatch) {
    or.push({ analysisStatus: 'ready', embeddingModel: { not: params.embeddingModel } });
  }

  const rows = await params.prisma.argument.findMany({
    where: { prunedAt: null, OR: or as any },
    orderBy: { updatedAt: 'asc' },
    take: params.batchSize,
    select: { id: true },
  });

  const stats: EnqueueStats = { scanned: rows.length, created: 0, alreadyQueued: 0 };
  if (rows.length === 0) return stats;

  await mapLimit(rows, params.enqueueConcurrency, async (row) => {
    const result = await enqueueArgumentAnalysisJob(params.queue, row.id);
    if (result.created) stats.created += 1;
    else stats.alreadyQueued += 1;
  });

  return stats;
}

async function enqueueArgumentAnalysisJob(
  queue: Queue,
  argumentId: string,
): Promise<{ jobId: string; created: boolean }> {
  const jobId = `arg_${argumentId}`;
  try {
    const created = await queue.add('analysis', { argumentId }, { jobId, removeOnComplete: 100, removeOnFail: 100 });
    return { jobId: created.id ?? jobId, created: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('already exists')) return { jobId, created: false };
    throw err;
  }
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  if (items.length === 0) return;
  const workers = Math.min(limit, items.length);
  let idx = 0;
  await Promise.all(
    Array.from({ length: workers }, async () => {
      for (;;) {
        const current = idx;
        idx += 1;
        if (current >= items.length) return;
        await fn(items[current]!);
      }
    }),
  );
}

async function withRedisLock<T>(
  redis: Redis,
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T | null> {
  const token = createHash('sha256').update(String(Math.random()) + Date.now()).digest('hex');
  const ok = await redis.set(key, token, 'PX', ttlMs, 'NX');
  if (ok !== 'OK') return null;

  try {
    return await fn();
  } finally {
    const lua = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;
    try {
      await redis.eval(lua, 1, key, token);
    } catch {
      // ignore
    }
  }
}

