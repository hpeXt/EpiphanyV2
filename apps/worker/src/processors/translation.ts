/**
 * @file translation.ts
 * @description Async translation processor for zh/en content (Topic / Argument / displayName / report).
 */

import { Prisma, type PrismaClient } from '@epiphany/database';
import type { Redis } from 'ioredis';
import { createHash } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';

import type {
  TranslationLocale,
  TranslationProvider,
  TranslationResourceType,
  TranslationTask,
} from '../providers/translation-provider.js';

const TOPIC_EVENTS_MAXLEN = 1000;
const BUDGET_KEY_PREFIX = 'translation:budget:';

const LUA_BUDGET_CONSUME = `
local current = tonumber(redis.call("GET", KEYS[1]) or "0")
local limit = tonumber(ARGV[1])
local delta = tonumber(ARGV[2])
if (not current) then current = 0 end
if (not limit) then limit = 0 end
if (not delta) then delta = 0 end
if limit > 0 and (current + delta) > limit then
  return {0, current}
end
local next = redis.call("INCRBY", KEYS[1], delta)
redis.call("EXPIRE", KEYS[1], 3456000) -- 40 days
return {1, next}
`;

export interface TranslationJobData {
  resourceType: TranslationResourceType;
  resourceId: string;
  targetLocale: TranslationLocale;
}

export interface ProcessTranslationParams {
  job: TranslationJobData;
  prisma: PrismaClient;
  redis: Redis;
  provider: TranslationProvider;
}

export interface ProcessTranslationResult {
  success: boolean;
  shortCircuited?: boolean;
  topicId?: string;
  resourceType?: TranslationResourceType;
  resourceId?: string;
  targetLocale?: TranslationLocale;
  error?: string;
}

export async function processTranslation(params: ProcessTranslationParams): Promise<ProcessTranslationResult> {
  const { prisma, redis, provider } = params;
  const { resourceType, resourceId, targetLocale } = params.job;

  let topicId: string | undefined;

  try {
    const source = await loadSource(prisma, resourceType, resourceId);
    if (!source) {
      await upsertFailure(prisma, { resourceType, resourceId, targetLocale }, 'Source not found');
      return { success: false, error: 'Source not found', resourceType, resourceId, targetLocale };
    }

    topicId = source.topicId;
    const task = source.task;
    const sourceLocale = source.sourceLocale;
    const sourceHash = computeSourceHash(task);

    const existing = await prisma.translation.findUnique({
      where: {
        resourceType_resourceId_targetLocale: {
          resourceType,
          resourceId,
          targetLocale,
        },
      },
      select: { id: true, status: true, sourceHash: true, data: true },
    });

    const existingHash = existing?.sourceHash ? Buffer.from(existing.sourceHash) : null;
    const isReadyWithSameHash =
      existing?.status === 'ready' &&
      existingHash &&
      existingHash.length === 32 &&
      existingHash.equals(sourceHash) &&
      existing.data !== null;

    if (isReadyWithSameHash) {
      return { success: true, shortCircuited: true, topicId, resourceType, resourceId, targetLocale };
    }

    await prisma.translation.upsert({
      where: {
        resourceType_resourceId_targetLocale: {
          resourceType,
          resourceId,
          targetLocale,
        },
      },
      create: {
        id: uuidv7(),
        resourceType,
        resourceId,
        targetLocale,
        status: 'pending',
        sourceLocale,
        sourceHash: toPrismaBytes(sourceHash),
        data: Prisma.DbNull,
        model: null,
        provider: null,
        error: null,
      },
      update: {
        status: 'pending',
        sourceLocale,
        sourceHash: toPrismaBytes(sourceHash),
        data: Prisma.DbNull,
        model: null,
        provider: null,
        error: null,
      },
    });

    const budgetLimit = getMonthlyBudgetTokens();
    const estimate = estimateTokens(task);

    if (provider.provider === 'openrouter' && budgetLimit !== null) {
      const monthKey = `${BUDGET_KEY_PREFIX}${getUtcMonthKey(new Date())}`;
      const allowed = budgetLimit > 0 ? await consumeBudget(redis, monthKey, budgetLimit, estimate) : false;

      if (!allowed) {
        await prisma.translation.update({
          where: {
            resourceType_resourceId_targetLocale: {
              resourceType,
              resourceId,
              targetLocale,
            },
          },
          data: {
            status: 'skipped_budget',
            provider: provider.provider,
            model: provider.provider === 'openrouter' ? (process.env.TRANSLATION_MODEL ?? null) : 'mock-translation',
            error: `Budget exceeded (limit=${budgetLimit} tokens/month)`,
            data: Prisma.DbNull,
          },
        });

        await publishTranslationUpdatedEvent(redis, topicId, resourceType, resourceId, targetLocale);
        return { success: true, shortCircuited: true, topicId, resourceType, resourceId, targetLocale };
      }
    }

    const translated = await provider.translate(task, targetLocale);
    if (provider.provider === 'openrouter' && translated.usage) {
      const { promptTokens, completionTokens, totalTokens } = translated.usage;
      console.log(
        `[worker] OpenRouter translation usage resourceType=${resourceType} targetLocale=${targetLocale} prompt=${promptTokens ?? '?'} completion=${completionTokens ?? '?'} total=${totalTokens ?? '?'}`,
      );
    }

    await prisma.translation.update({
      where: {
        resourceType_resourceId_targetLocale: {
          resourceType,
          resourceId,
          targetLocale,
        },
      },
      data: {
        status: 'ready',
        sourceLocale,
        sourceHash: toPrismaBytes(sourceHash),
        data: translated.data as unknown as Prisma.InputJsonValue,
        model: translated.model,
        provider: provider.provider,
        error: null,
      },
    });

    await publishTranslationUpdatedEvent(redis, topicId, resourceType, resourceId, targetLocale);
    return { success: true, topicId, resourceType, resourceId, targetLocale };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try {
      await upsertFailure(prisma, { resourceType, resourceId, targetLocale }, msg, provider.provider);
      if (topicId) {
        await publishTranslationUpdatedEvent(redis, topicId, resourceType, resourceId, targetLocale);
      }
    } catch {
      // ignore secondary errors
    }
    return { success: false, error: msg, topicId, resourceType, resourceId, targetLocale };
  }
}

async function upsertFailure(
  prisma: PrismaClient,
  key: { resourceType: TranslationResourceType; resourceId: string; targetLocale: TranslationLocale },
  error: string,
  provider?: string,
): Promise<void> {
  await prisma.translation.upsert({
    where: {
      resourceType_resourceId_targetLocale: {
        resourceType: key.resourceType,
        resourceId: key.resourceId,
        targetLocale: key.targetLocale,
      },
    },
    create: {
      id: uuidv7(),
      resourceType: key.resourceType,
      resourceId: key.resourceId,
      targetLocale: key.targetLocale,
      status: 'failed',
      sourceLocale: null,
      sourceHash: null,
      data: Prisma.DbNull,
      model: null,
      provider: provider ?? null,
      error: truncate(error, 800),
    },
    update: {
      status: 'failed',
      data: Prisma.DbNull,
      model: null,
      provider: provider ?? null,
      error: truncate(error, 800),
    },
  });
}

async function loadSource(
  prisma: PrismaClient,
  resourceType: TranslationResourceType,
  resourceId: string,
): Promise<{ topicId: string; task: TranslationTask; sourceLocale: TranslationLocale } | null> {
  switch (resourceType) {
    case 'topic_title': {
      const topic = await prisma.topic.findUnique({
        where: { id: resourceId },
        select: { id: true, title: true },
      });
      if (!topic?.title?.trim()) return null;
      const title = topic.title.trim();
      return {
        topicId: topic.id,
        task: { resourceType: 'topic_title', source: { title } },
        sourceLocale: guessLocale(title),
      };
    }

    case 'argument': {
      const arg = await prisma.argument.findUnique({
        where: { id: resourceId },
        select: { id: true, topicId: true, title: true, body: true, prunedAt: true },
      });
      if (!arg || arg.prunedAt) return null;
      const title = arg.title === null ? null : arg.title.trim();
      const body = arg.body.trim();
      if (!body) return null;
      const combined = `${title ?? ''}\n${body}`.trim();
      return {
        topicId: arg.topicId,
        task: { resourceType: 'argument', source: { title, body } },
        sourceLocale: guessLocale(combined),
      };
    }

    case 'topic_profile_display_name': {
      const parsed = parseTopicProfileDisplayNameResourceId(resourceId);
      if (!parsed) return null;
      const profile = await prisma.topicIdentityProfile.findUnique({
        where: {
          topicId_pubkey: {
            topicId: parsed.topicId,
            pubkey: Buffer.from(parsed.pubkeyHex, 'hex'),
          },
        },
        select: { displayName: true },
      });
      const displayName = profile?.displayName?.trim() ?? '';
      if (!displayName) return null;
      return {
        topicId: parsed.topicId,
        task: { resourceType: 'topic_profile_display_name', source: { displayName } },
        sourceLocale: guessLocale(displayName),
      };
    }

    case 'consensus_report': {
      const report = await prisma.consensusReport.findUnique({
        where: { id: resourceId },
        select: { id: true, topicId: true, status: true, contentMd: true },
      });
      const contentMd = report?.status === 'ready' ? report.contentMd?.trim() ?? '' : '';
      if (!report || !contentMd) return null;
      return {
        topicId: report.topicId,
        task: { resourceType: 'consensus_report', source: { contentMd } },
        sourceLocale: guessLocale(contentMd),
      };
    }

    case 'camp': {
      const parsed = parseCampResourceId(resourceId);
      if (!parsed) return null;
      const camp = await prisma.camp.findUnique({
        where: { topicId_clusterId: { topicId: parsed.topicId, clusterId: parsed.clusterId } },
        select: { label: true, summary: true },
      });
      if (!camp) return null;
      const label = camp.label?.trim() ?? null;
      const summary = camp.summary?.trim() ?? null;
      const combined = `${label ?? ''}\n${summary ?? ''}`.trim();
      if (!combined) return null;
      return {
        topicId: parsed.topicId,
        task: { resourceType: 'camp', source: { label, summary } },
        sourceLocale: guessLocale(combined),
      };
    }

    default:
      return assertNever(resourceType);
  }
}

function computeSourceHash(task: TranslationTask): Buffer {
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
    case 'consensus_report':
      return sha256Json({ contentMd: task.source.contentMd.trim() });
    case 'camp':
      return sha256Json({
        label: task.source.label === null ? null : task.source.label.trim(),
        summary: task.source.summary === null ? null : task.source.summary.trim(),
      });
    default:
      return assertNever(task);
  }
}

function sha256Json(value: unknown): Buffer {
  return createHash('sha256').update(JSON.stringify(value)).digest();
}

function guessLocale(text: string): TranslationLocale {
  return /[\u4E00-\u9FFF]/.test(text) ? 'zh' : 'en';
}

function estimateTokens(task: TranslationTask): number {
  const overhead = 800;
  const textLen = getTaskText(task).length;
  // Conservative: assume ~1 char ~= 1 token, and output is similar size.
  return overhead + textLen * 2;
}

function getTaskText(task: TranslationTask): string {
  switch (task.resourceType) {
    case 'topic_title':
      return task.source.title.trim();
    case 'argument':
      return `${task.source.title ?? ''}\n${task.source.body}`.trim();
    case 'topic_profile_display_name':
      return task.source.displayName.trim();
    case 'consensus_report':
      return task.source.contentMd.trim();
    case 'camp':
      return `${task.source.label ?? ''}\n${task.source.summary ?? ''}`.trim();
    default:
      return assertNever(task);
  }
}

function getMonthlyBudgetTokens(): number | null {
  const fallback = 200_000;
  const raw = process.env.TRANSLATION_BUDGET_TOKENS_PER_MONTH;
  if (!raw) return fallback;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < 0) return null; // unlimited
  return parsed; // 0 disables external calls
}

function getUtcMonthKey(now: Date): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

async function consumeBudget(redis: Redis, key: string, limit: number, delta: number): Promise<boolean> {
  const result = (await redis.eval(LUA_BUDGET_CONSUME, 1, key, String(limit), String(delta))) as unknown;
  if (!Array.isArray(result) || result.length < 1) return false;
  return result[0] === 1;
}

async function publishTranslationUpdatedEvent(
  redis: Redis,
  topicId: string,
  resourceType: TranslationResourceType,
  resourceId: string,
  locale: TranslationLocale,
): Promise<string> {
  const streamKey = `topic:events:${topicId}`;
  const envelope = {
    event: 'translation_updated',
    data: { topicId, resourceType, resourceId, locale },
  };

  const id = await redis.xadd(
    streamKey,
    'MAXLEN',
    '~',
    String(TOPIC_EVENTS_MAXLEN),
    '*',
    'data',
    JSON.stringify(envelope),
  );

  if (!id) {
    throw new Error(`Failed to publish event to stream ${streamKey}`);
  }

  return id;
}

function parseTopicProfileDisplayNameResourceId(resourceId: string): { topicId: string; pubkeyHex: string } | null {
  const idx = resourceId.indexOf(':');
  if (idx <= 0) return null;
  const topicId = resourceId.slice(0, idx);
  const pubkeyHex = resourceId.slice(idx + 1);
  if (!topicId) return null;
  if (!/^[0-9a-f]{64}$/i.test(pubkeyHex)) return null;
  return { topicId, pubkeyHex: pubkeyHex.toLowerCase() };
}

function parseCampResourceId(resourceId: string): { topicId: string; clusterId: number } | null {
  const idx = resourceId.indexOf(':');
  if (idx <= 0) return null;
  const topicId = resourceId.slice(0, idx);
  const clusterIdRaw = resourceId.slice(idx + 1);
  const clusterId = Number.parseInt(clusterIdRaw, 10);
  if (!topicId) return null;
  if (!Number.isFinite(clusterId)) return null;
  return { topicId, clusterId };
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}

function toPrismaBytes(bytes: Buffer): Uint8Array<ArrayBuffer> {
  // Prisma's generated types use Uint8Array<ArrayBuffer> (not ArrayBufferLike).
  // Allocate a fresh ArrayBuffer to satisfy the type constraint.
  const out = new Uint8Array(new ArrayBuffer(bytes.length));
  out.set(bytes);
  return out;
}

function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}
