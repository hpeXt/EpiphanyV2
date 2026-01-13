/**
 * @file translation-automation.ts
 * @description Backfill + sweeper for zh/en translations (topics/arguments/displayName).
 */

import type { PrismaClient } from '@epiphany/database';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { createHash } from 'node:crypto';

import type { TranslationLocale, TranslationProvider, TranslationResourceType } from '../providers/translation-provider.js';

type TranslationJobData = {
  resourceType: TranslationResourceType;
  resourceId: string;
  targetLocale: TranslationLocale;
};

type BackfillMode = 'auto' | 'force' | 'disabled';

type EnqueueStats = {
  created: number;
  alreadyQueued: number;
};

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_BATCH_SIZE = 200;
const DEFAULT_ENQUEUE_CONCURRENCY = 10;

const DEFAULT_RETRY_PENDING_AFTER_MS = 20 * 60 * 1000;
const DEFAULT_RETRY_FAILED_AFTER_MS = 30 * 60 * 1000;

const LOCK_KEY = 'translation:automation:lock:v1';
const LOCK_TTL_MS = 4 * 60 * 1000;

const BACKFILL_DONE_KEY = 'translation:backfill:done:v1';

const CURSOR_TOPICS_KEY = 'translation:sweeper:cursor:topics:v1';
const CURSOR_ARGUMENTS_KEY = 'translation:sweeper:cursor:arguments:v1';
const CURSOR_PROFILES_KEY = 'translation:sweeper:cursor:profiles:v1';

export function startTranslationAutomation(params: {
  prisma: PrismaClient;
  redis: Redis;
  queue: Queue;
  provider: TranslationProvider;
}): void {
  const enabled = getAutomationEnabled();
  if (!enabled) {
    console.log('[worker] Translation automation disabled (TRANSLATION_AUTOMATION_ENABLED=0).');
    return;
  }

  if (params.provider.provider === 'mock' && !getAllowMockAutomation()) {
    console.log(
      '[worker] Translation automation skipped because provider=mock (set TRANSLATION_AUTOMATION_ALLOW_MOCK=1 to force).',
    );
    return;
  }

  const intervalMs = getIntervalMs();
  const backfillMode = getBackfillMode();

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await withRedisLock(params.redis, LOCK_KEY, LOCK_TTL_MS, async () => {
        if (backfillMode !== 'disabled') {
          await maybeRunBackfillOnce({
            prisma: params.prisma,
            redis: params.redis,
            queue: params.queue,
            mode: backfillMode,
          });
        }

        await runSweepOnce({
          prisma: params.prisma,
          redis: params.redis,
          queue: params.queue,
        });
      });
    } catch (err) {
      console.warn('[worker] Translation automation tick failed:', err);
    } finally {
      running = false;
    }
  };

  void tick();
  setInterval(() => void tick(), intervalMs);

  console.log(`[worker] Translation automation started intervalMs=${intervalMs} backfillMode=${backfillMode}`);
}

function zeroStats(): EnqueueStats {
  return { created: 0, alreadyQueued: 0 };
}

function getAutomationEnabled(): boolean {
  const raw = process.env.TRANSLATION_AUTOMATION_ENABLED;
  if (!raw) return true;
  return raw !== '0' && raw.toLowerCase() !== 'false';
}

function getAllowMockAutomation(): boolean {
  const raw = process.env.TRANSLATION_AUTOMATION_ALLOW_MOCK;
  return raw === '1' || raw?.toLowerCase() === 'true';
}

function getBackfillMode(): BackfillMode {
  const raw = (process.env.TRANSLATION_BACKFILL_MODE ?? 'auto').toLowerCase();
  if (raw === 'disabled' || raw === 'off' || raw === '0' || raw === 'false') return 'disabled';
  if (raw === 'force' || raw === 'on') return 'force';
  return 'auto';
}

function getIntervalMs(): number {
  const raw = process.env.TRANSLATION_SWEEPER_INTERVAL_MS;
  if (!raw) return DEFAULT_INTERVAL_MS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1000) return DEFAULT_INTERVAL_MS;
  return parsed;
}

function getBatchSize(): number {
  const raw = process.env.TRANSLATION_SWEEPER_BATCH_SIZE;
  if (!raw) return DEFAULT_BATCH_SIZE;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_BATCH_SIZE;
  return Math.min(parsed, 5000);
}

function getEnqueueConcurrency(): number {
  const raw = process.env.TRANSLATION_SWEEPER_ENQUEUE_CONCURRENCY;
  if (!raw) return DEFAULT_ENQUEUE_CONCURRENCY;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_ENQUEUE_CONCURRENCY;
  return Math.min(parsed, 100);
}

function getRetryPendingAfterMs(): number {
  const raw = process.env.TRANSLATION_SWEEPER_RETRY_PENDING_AFTER_MS;
  if (!raw) return DEFAULT_RETRY_PENDING_AFTER_MS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_RETRY_PENDING_AFTER_MS;
  return parsed;
}

function getRetryFailedAfterMs(): number {
  const raw = process.env.TRANSLATION_SWEEPER_RETRY_FAILED_AFTER_MS;
  if (!raw) return DEFAULT_RETRY_FAILED_AFTER_MS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_RETRY_FAILED_AFTER_MS;
  return parsed;
}

async function maybeRunBackfillOnce(params: {
  prisma: PrismaClient;
  redis: Redis;
  queue: Queue;
  mode: BackfillMode;
}): Promise<void> {
  if (params.mode === 'disabled') return;

  if (params.mode === 'auto') {
    const alreadyDone = await params.redis.get(BACKFILL_DONE_KEY);
    if (alreadyDone) return;
  }

  console.log('[worker] Translation backfill starting...');

  const startedAt = Date.now();
  const batchSize = getBatchSize();
  const enqueueConcurrency = getEnqueueConcurrency();

  const topicsEnqueued = await backfillTopics({
    prisma: params.prisma,
    redis: params.redis,
    queue: params.queue,
    batchSize,
    enqueueConcurrency,
  });
  const argumentsEnqueued = await backfillArguments({
    prisma: params.prisma,
    redis: params.redis,
    queue: params.queue,
    batchSize,
    enqueueConcurrency,
  });
  const profilesEnqueued = await backfillProfiles({
    prisma: params.prisma,
    redis: params.redis,
    queue: params.queue,
    batchSize,
    enqueueConcurrency,
  });

  await params.redis.set(BACKFILL_DONE_KEY, new Date().toISOString());

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[worker] Translation backfill done topics=${topicsEnqueued} arguments=${argumentsEnqueued} profiles=${profilesEnqueued} elapsedMs=${elapsedMs}`,
  );
}

async function runSweepOnce(params: { prisma: PrismaClient; redis: Redis; queue: Queue }): Promise<void> {
  const batchSize = getBatchSize();
  const enqueueConcurrency = getEnqueueConcurrency();

  const topicsEnqueued = await sweepTopics({
    prisma: params.prisma,
    redis: params.redis,
    queue: params.queue,
    batchSize,
    enqueueConcurrency,
  });
  const argumentsEnqueued = await sweepArguments({
    prisma: params.prisma,
    redis: params.redis,
    queue: params.queue,
    batchSize,
    enqueueConcurrency,
  });
  const profilesEnqueued = await sweepProfiles({
    prisma: params.prisma,
    redis: params.redis,
    queue: params.queue,
    batchSize,
    enqueueConcurrency,
  });

  if (topicsEnqueued || argumentsEnqueued || profilesEnqueued) {
    console.log(
      `[worker] Translation sweep enqueued topics=${topicsEnqueued} arguments=${argumentsEnqueued} profiles=${profilesEnqueued}`,
    );
  }
}

function hasCjk(text: string): boolean {
  return /[\u4E00-\u9FFF]/.test(text);
}

function hasTranslatableChars(text: string): boolean {
  return /[A-Za-z\u4E00-\u9FFF]/.test(text);
}

function guessLocaleFromText(text: string): TranslationLocale {
  return hasCjk(text) ? 'zh' : 'en';
}

function otherLocale(locale: TranslationLocale): TranslationLocale {
  return locale === 'zh' ? 'en' : 'zh';
}

function sha256Json(value: unknown): Buffer {
  return createHash('sha256').update(JSON.stringify(value)).digest();
}

function computeSourceHash(
  task:
    | { resourceType: 'topic_title'; source: { title: string } }
    | { resourceType: 'argument'; source: { title: string | null; body: string } }
    | { resourceType: 'topic_profile_display_name'; source: { displayName: string } },
): Buffer {
  switch (task.resourceType) {
    case 'topic_title':
      return sha256Json({ title: task.source.title.trim() });
    case 'argument':
      return sha256Json({
        title: task.source.title === null ? null : task.source.title.trim(),
        body: task.source.body.trim(),
      });
    case 'topic_profile_display_name':
      return sha256Json({ displayName: task.source.displayName.trim() });
    default:
      return assertNever(task);
  }
}

function toBuffer(bytes: Uint8Array | null): Buffer | null {
  return bytes ? Buffer.from(bytes) : null;
}

function getUtcMonthKey(now: Date): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function isSameUtcMonth(a: Date, b: Date): boolean {
  return getUtcMonthKey(a) === getUtcMonthKey(b);
}

async function backfillTopics(params: {
  prisma: PrismaClient;
  redis: Redis;
  queue: Queue;
  batchSize: number;
  enqueueConcurrency: number;
}): Promise<number> {
  await params.redis.del(CURSOR_TOPICS_KEY);
  let totalEnqueued = 0;

  for (;;) {
    const enqueued = await sweepTopics(params);
    totalEnqueued += enqueued;

    const cursor = await params.redis.get(CURSOR_TOPICS_KEY);
    if (!cursor) break;
  }

  return totalEnqueued;
}

async function backfillArguments(params: {
  prisma: PrismaClient;
  redis: Redis;
  queue: Queue;
  batchSize: number;
  enqueueConcurrency: number;
}): Promise<number> {
  await params.redis.del(CURSOR_ARGUMENTS_KEY);
  let totalEnqueued = 0;

  for (;;) {
    const enqueued = await sweepArguments(params);
    totalEnqueued += enqueued;

    const cursor = await params.redis.get(CURSOR_ARGUMENTS_KEY);
    if (!cursor) break;
  }

  return totalEnqueued;
}

async function backfillProfiles(params: {
  prisma: PrismaClient;
  redis: Redis;
  queue: Queue;
  batchSize: number;
  enqueueConcurrency: number;
}): Promise<number> {
  await params.redis.del(CURSOR_PROFILES_KEY);
  let totalEnqueued = 0;

  for (;;) {
    const enqueued = await sweepProfiles(params);
    totalEnqueued += enqueued;

    const cursor = await params.redis.get(CURSOR_PROFILES_KEY);
    if (!cursor) break;
  }

  return totalEnqueued;
}

async function sweepTopics(params: {
  prisma: PrismaClient;
  redis: Redis;
  queue: Queue;
  batchSize: number;
  enqueueConcurrency: number;
}): Promise<number> {
  const cursorId = await params.redis.get(CURSOR_TOPICS_KEY);

  let rows: Array<{ id: string; title: string }> = [];
  try {
    rows = await params.prisma.topic.findMany({
      take: params.batchSize,
      ...(cursorId
        ? {
            skip: 1,
            cursor: { id: cursorId },
          }
        : {}),
      orderBy: { id: 'asc' },
      select: { id: true, title: true },
    });
  } catch (err) {
    if (cursorId && isCursorNotFound(err)) {
      await params.redis.del(CURSOR_TOPICS_KEY);
      return sweepTopics(params);
    }
    throw err;
  }

  if (!rows.length) {
    await params.redis.del(CURSOR_TOPICS_KEY);
    return 0;
  }

  const nextCursor = rows[rows.length - 1]!.id;
  await params.redis.set(CURSOR_TOPICS_KEY, nextCursor);

  const items = rows
    .map((row) => ({ id: row.id, title: row.title.trim() }))
    .filter((row) => row.title && hasTranslatableChars(row.title));

  return enqueueIfNeeded({
    prisma: params.prisma,
    queue: params.queue,
    enqueueConcurrency: params.enqueueConcurrency,
    resourceType: 'topic_title',
    items: items.map((row) => {
      const sourceLocale = guessLocaleFromText(row.title);
      const targetLocale = otherLocale(sourceLocale);
      return {
        resourceId: row.id,
        targetLocale,
        sourceHash: computeSourceHash({ resourceType: 'topic_title', source: { title: row.title } }),
      };
    }),
  });
}

async function sweepArguments(params: {
  prisma: PrismaClient;
  redis: Redis;
  queue: Queue;
  batchSize: number;
  enqueueConcurrency: number;
}): Promise<number> {
  const cursorId = await params.redis.get(CURSOR_ARGUMENTS_KEY);

  let rows: Array<{ id: string; title: string | null; body: string; prunedAt: Date | null }> = [];
  try {
    rows = await params.prisma.argument.findMany({
      take: params.batchSize,
      ...(cursorId
        ? {
            skip: 1,
            cursor: { id: cursorId },
          }
        : {}),
      orderBy: { id: 'asc' },
      select: { id: true, title: true, body: true, prunedAt: true },
    });
  } catch (err) {
    if (cursorId && isCursorNotFound(err)) {
      await params.redis.del(CURSOR_ARGUMENTS_KEY);
      return sweepArguments(params);
    }
    throw err;
  }

  if (!rows.length) {
    await params.redis.del(CURSOR_ARGUMENTS_KEY);
    return 0;
  }

  const nextCursor = rows[rows.length - 1]!.id;
  await params.redis.set(CURSOR_ARGUMENTS_KEY, nextCursor);

  const items = rows
    .filter((row) => !row.prunedAt)
    .map((row) => ({
      id: row.id,
      title: row.title === null ? null : row.title.trim(),
      body: row.body.trim(),
    }))
    .filter((row) => row.body && hasTranslatableChars(`${row.title ?? ''}\n${row.body}`.trim()));

  return enqueueIfNeeded({
    prisma: params.prisma,
    queue: params.queue,
    enqueueConcurrency: params.enqueueConcurrency,
    resourceType: 'argument',
    items: items.map((row) => {
      const combined = `${row.title ?? ''}\n${row.body}`.trim();
      const sourceLocale = guessLocaleFromText(combined);
      const targetLocale = otherLocale(sourceLocale);
      return {
        resourceId: row.id,
        targetLocale,
        sourceHash: computeSourceHash({ resourceType: 'argument', source: { title: row.title, body: row.body } }),
      };
    }),
  });
}

async function sweepProfiles(params: {
  prisma: PrismaClient;
  redis: Redis;
  queue: Queue;
  batchSize: number;
  enqueueConcurrency: number;
}): Promise<number> {
  const cursorRaw = await params.redis.get(CURSOR_PROFILES_KEY);
  const cursor = cursorRaw ? parseCursor(cursorRaw) : null;

  let rows: Array<{ topicId: string; pubkey: Uint8Array; displayName: string | null }> = [];
  try {
    rows = await params.prisma.topicIdentityProfile.findMany({
      take: params.batchSize,
      ...(cursor
        ? {
            skip: 1,
            cursor: {
              topicId_pubkey: {
                topicId: cursor.topicId,
                pubkey: Buffer.from(cursor.pubkeyHex, 'hex'),
              },
            },
          }
        : {}),
      orderBy: [{ topicId: 'asc' }, { pubkey: 'asc' }],
      select: { topicId: true, pubkey: true, displayName: true },
    });
  } catch (err) {
    if (cursor && isCursorNotFound(err)) {
      await params.redis.del(CURSOR_PROFILES_KEY);
      return sweepProfiles(params);
    }
    throw err;
  }

  if (!rows.length) {
    await params.redis.del(CURSOR_PROFILES_KEY);
    return 0;
  }

  const last = rows[rows.length - 1]!;
  await params.redis.set(
    CURSOR_PROFILES_KEY,
    JSON.stringify({ topicId: last.topicId, pubkeyHex: Buffer.from(last.pubkey).toString('hex') }),
  );

  const items = rows
    .map((row) => ({
      topicId: row.topicId,
      pubkeyHex: Buffer.from(row.pubkey).toString('hex'),
      displayName: row.displayName?.trim() ?? '',
    }))
    .filter((row) => row.displayName && hasTranslatableChars(row.displayName));

  return enqueueIfNeeded({
    prisma: params.prisma,
    queue: params.queue,
    enqueueConcurrency: params.enqueueConcurrency,
    resourceType: 'topic_profile_display_name',
    items: items.map((row) => {
      const sourceLocale = guessLocaleFromText(row.displayName);
      const targetLocale = otherLocale(sourceLocale);
      return {
        resourceId: `${row.topicId}:${row.pubkeyHex}`,
        targetLocale,
        sourceHash: computeSourceHash({
          resourceType: 'topic_profile_display_name',
          source: { displayName: row.displayName },
        }),
      };
    }),
  });
}

async function enqueueIfNeeded(params: {
  prisma: PrismaClient;
  queue: Queue;
  enqueueConcurrency: number;
  resourceType: TranslationResourceType;
  items: Array<{ resourceId: string; targetLocale: TranslationLocale; sourceHash: Buffer }>;
}): Promise<number> {
  if (!params.items.length) return 0;

  const grouped = new Map<TranslationLocale, Array<{ resourceId: string; sourceHash: Buffer }>>();
  for (const item of params.items) {
    const list = grouped.get(item.targetLocale) ?? [];
    list.push({ resourceId: item.resourceId, sourceHash: item.sourceHash });
    grouped.set(item.targetLocale, list);
  }

  const now = new Date();
  const toEnqueue: TranslationJobData[] = [];

  for (const [targetLocale, group] of grouped.entries()) {
    const resourceIds = group.map((g) => g.resourceId);
    const existing = await params.prisma.translation.findMany({
      where: { resourceType: params.resourceType, targetLocale, resourceId: { in: resourceIds } },
      select: { resourceId: true, status: true, sourceHash: true, data: true, updatedAt: true },
    });

    const byId = new Map(
      existing.map((row) => [
        row.resourceId,
        {
          status: row.status,
          sourceHash: toBuffer(row.sourceHash),
          data: row.data,
          updatedAt: row.updatedAt,
        },
      ] as const),
    );

    for (const item of group) {
      const row = byId.get(item.resourceId);
      if (!row) {
        toEnqueue.push({ resourceType: params.resourceType, resourceId: item.resourceId, targetLocale });
        continue;
      }

      const sameHash = row.sourceHash?.equals(item.sourceHash) ?? false;
      const hasData = row.data !== null;

      if (row.status === 'ready' && sameHash && hasData) continue;

      if (row.status === 'skipped_budget' && sameHash && isSameUtcMonth(row.updatedAt, now)) {
        continue;
      }

      toEnqueue.push({ resourceType: params.resourceType, resourceId: item.resourceId, targetLocale });
    }
  }

  if (!toEnqueue.length) return 0;

  await mapLimit(toEnqueue, params.enqueueConcurrency, async (job) => {
    await enqueueTranslationJob(params.queue, job);
  });

  return toEnqueue.length;
}

function translationJobId(job: TranslationJobData): string {
  const key = `${job.resourceType}|${job.resourceId}|${job.targetLocale}`;
  return `tr_${createHash('sha256').update(key).digest('hex').slice(0, 24)}`;
}

async function enqueueTranslationJob(queue: Queue, job: TranslationJobData): Promise<string> {
  const jobId = translationJobId(job);
  try {
    const created = await queue.add('translate', job, {
      jobId,
      removeOnComplete: true,
      removeOnFail: true,
    });
    return created.id ?? jobId;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('already exists')) return jobId;
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
    }
  }
}

function parseCursor(value: string): { topicId: string; pubkeyHex: string } | null {
  try {
    const parsed = JSON.parse(value) as { topicId?: unknown; pubkeyHex?: unknown };
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.topicId !== 'string' || !parsed.topicId) return null;
    if (typeof parsed.pubkeyHex !== 'string' || !/^[0-9a-f]{64}$/i.test(parsed.pubkeyHex)) return null;
    return { topicId: parsed.topicId, pubkeyHex: parsed.pubkeyHex.toLowerCase() };
  } catch {
    return null;
  }
}

function isCursorNotFound(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && code === 'P2025') return true;

  const msg = err instanceof Error ? err.message : String(err);
  return msg.toLowerCase().includes('cursor') && msg.toLowerCase().includes('not found');
}

function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}
