/**
 * @file consensus-report.ts
 * @description Consensus report job processor (Step 22)
 *
 * Generates a topic-level consensus report asynchronously (non-blocking write path):
 * 1. Reads consensus_reports row
 * 2. Short-circuits if already ready (idempotency)
 * 3. Loads topic + arguments (filters pruned) with a deterministic sampling/ordering strategy
 * 4. Calls provider to generate markdown
 * 5. Writes ready/failed state + traceability fields (promptVersion/params, error metadata)
 * 6. Publishes SSE invalidation event (report_updated)
 *
 * @see docs/stage01/ai-worker.md#7
 * @see docs/stage01/steps/step22.md
 */

import { Prisma, type PrismaClient } from '@epiphany/database';
import type { Redis } from 'ioredis';
import { createHash } from 'node:crypto';

const TOPIC_EVENTS_MAXLEN = 1000;
const REPORT_META_START = '<!-- REPORT_META_START -->';
const REPORT_META_END = '<!-- REPORT_META_END -->';

export type ConsensusReportTrigger = 'auto' | 'host';

export interface SelectedArgument {
  id: string;
  title: string | null;
  body: string;
  totalVotes: number;
  createdAt: Date;
  authorPubkey: Uint8Array;
}

export interface ConsensusReportParamsSnapshot {
  promptVersion: string;
  trigger: ConsensusReportTrigger;
  selection: {
    strategy: 'root+topVotes+stratified';
    maxSources: number;
    maxCharsPerSource: number;
    topVotesK: number;
    minPerBucket: number;
    stanceThresholds: { supportGte: number; opposeLte: number };
    depthBins: Array<'1' | '2-3' | '4+'>;
  };
  ordering: 'totalVotes_desc_createdAt_asc_id_asc';
  filters: { pruned: false };
  selectedArgumentIds: string[];
}

export interface ConsensusReportSourceForModel {
  label: string; // S1..Sn
  title: string | null;
  body: string;
  totalVotes: number;
  depth: number | null;
  stance: -1 | 0 | 1;
}

export interface GenerateConsensusReportInput {
  topicTitle: string;
  sources: ConsensusReportSourceForModel[];
  params: ConsensusReportParamsSnapshot;
  coverage: {
    argumentsTotal: number;
    argumentsIncluded: number;
    votesTotal: number;
    votesIncluded: number;
  };
}

export interface ConsensusReportProvider {
  generate(input: GenerateConsensusReportInput): Promise<{ contentMd: string; model: string }>;
}

export interface ProcessConsensusReportParams {
  topicId: string;
  reportId: string;
  trigger: ConsensusReportTrigger;
  prisma: PrismaClient;
  redis: Redis;
  provider: ConsensusReportProvider;
  promptVersion?: string;
  maxArguments?: number;
}

export interface ProcessConsensusReportResult {
  success: boolean;
  shortCircuited?: boolean;
  topicId?: string;
  reportId?: string;
  error?: string;
}

export async function processConsensusReport(
  params: ProcessConsensusReportParams,
): Promise<ProcessConsensusReportResult> {
  const { topicId, reportId, trigger, prisma, redis, provider } = params;
  const defaults = getConsensusReportDefaults();
  const promptVersion = params.promptVersion ?? defaults.promptVersion;
  const maxArguments = params.maxArguments ?? defaults.maxArguments;

  const report = await prisma.consensusReport.findUnique({
    where: { id: reportId },
    select: {
      id: true,
      topicId: true,
      status: true,
      contentMd: true,
    },
  });

  if (!report) {
    console.warn(`[consensus-report] Report not found: ${reportId}`);
    return { success: false, error: 'Report not found', topicId, reportId };
  }

  if (report.topicId !== topicId) {
    console.warn(
      `[consensus-report] Report topic mismatch: reportId=${reportId} report.topicId=${report.topicId} expected=${topicId}`,
    );
    return { success: false, error: 'Report topic mismatch', topicId, reportId };
  }

  // Idempotency check - short circuit if already ready with content
  if (report.status === 'ready' && report.contentMd) {
    console.log(`[consensus-report] Short circuit: ${reportId} already ready`);
    return { success: true, shortCircuited: true, topicId, reportId };
  }

  const startedAt = new Date();
  let paramsSnapshot: ConsensusReportParamsSnapshot | null = null;

  try {
    const maxCharsPerSource = defaults.maxCharsPerSource;
    const selectionDefaults: {
      maxSources: number;
      maxCharsPerSource: number;
      topVotesK: number;
      minPerBucket: number;
      stanceThresholds: { supportGte: number; opposeLte: number };
      depthBins: Array<'1' | '2-3' | '4+'>;
    } = {
      maxSources: maxArguments,
      maxCharsPerSource: maxCharsPerSource,
      topVotesK: 40,
      minPerBucket: 6,
      stanceThresholds: { supportGte: 0.3, opposeLte: -0.3 },
      depthBins: ['1', '2-3', '4+'],
    };

    const { topicTitle, arguments: selectedArgs, selectedArgumentIds, selectionSummary, coverage } =
      await selectConsensusReportArguments(prisma, topicId, selectionDefaults);

    paramsSnapshot = {
      promptVersion,
      trigger,
      selection: selectionSummary,
      ordering: 'totalVotes_desc_createdAt_asc_id_asc',
      filters: { pruned: false },
      selectedArgumentIds,
    };

    const paramsJson = paramsSnapshot as unknown as Prisma.InputJsonValue;

    const sources: ConsensusReportSourceForModel[] = selectedArgs.map((arg, index) => {
      const trimmedBody = trimForModel(arg.body, selectionDefaults.maxCharsPerSource);
      return {
        label: `S${index + 1}`,
        title: arg.title,
        body: trimmedBody,
        totalVotes: arg.totalVotes,
        depth: arg.depth,
        stance: arg.stance,
      };
    });

    const sourceMap: Record<
      string,
      {
        argumentId: string;
        authorId: string;
        title: string | null;
        totalVotes: number;
        excerpt: string;
        depth: number | null;
        stance: -1 | 0 | 1;
      }
    > = Object.fromEntries(
      selectedArgs.map((arg, index) => {
        const label = `S${index + 1}`;
        return [
          label,
          {
            argumentId: arg.id,
            authorId: deriveAuthorId(arg.authorPubkey),
            title: arg.title,
            totalVotes: arg.totalVotes,
            excerpt: toExcerpt(arg.body, 240),
            depth: arg.depth,
            stance: arg.stance,
          },
        ];
      }),
    );

    const { contentMd, model } = await provider.generate({
      topicTitle,
      sources,
      params: paramsSnapshot,
      coverage,
    });

    if (!contentMd || !contentMd.trim()) {
      throw new Error('Provider returned empty contentMd');
    }

    const extractedMeta = extractReportMetaBlock(contentMd);
    const reportMd = extractedMeta.contentMd;
    const providerMeta = extractedMeta.meta;

    await prisma.consensusReport.update({
      where: { id: reportId },
      data: {
        status: 'ready',
        contentMd: reportMd,
        model,
        promptVersion,
        params: paramsJson,
        metadata: {
          ...(providerMeta ?? {}),
          coverage,
          sources: sourceMap,
        },
        computedAt: startedAt,
      },
    });

    await publishReportUpdatedEvent(redis, topicId, reportId);

    return { success: true, topicId, reportId };
  } catch (error) {
    const errorMessage = formatErrorWithCause(error);
    console.error(`[consensus-report] Failed: reportId=${reportId} topicId=${topicId}`, errorMessage);

    try {
      const metadata = {
        error: {
          message: errorMessage,
          timestamp: new Date().toISOString(),
        },
      };

      const fallbackParams: ConsensusReportParamsSnapshot = {
        promptVersion,
        trigger,
        selection: {
          strategy: 'root+topVotes+stratified',
          maxSources: maxArguments,
          maxCharsPerSource: defaults.maxCharsPerSource,
          topVotesK: 40,
          minPerBucket: 6,
          stanceThresholds: { supportGte: 0.3, opposeLte: -0.3 },
          depthBins: ['1', '2-3', '4+'],
        },
        ordering: 'totalVotes_desc_createdAt_asc_id_asc',
        filters: { pruned: false },
        selectedArgumentIds: [],
      };

      const paramsJson = (paramsSnapshot ?? fallbackParams) as unknown as Prisma.InputJsonValue;

      await prisma.consensusReport.update({
        where: { id: reportId },
        data: {
          status: 'failed',
          contentMd: null,
          promptVersion,
          params: paramsJson,
          metadata,
          computedAt: startedAt,
        },
      });

      await publishReportUpdatedEvent(redis, topicId, reportId);
    } catch (writeError) {
      console.error(`[consensus-report] Failed to write failure state:`, writeError);
    }

    return { success: false, error: errorMessage, topicId, reportId };
  }
}

function formatErrorWithCause(error: unknown): string {
  if (!(error instanceof Error)) return String(error);

  const base = error.message || String(error);
  const cause = (error as any).cause;
  if (!cause) return base;

  if (cause instanceof Error) {
    const code = typeof (cause as any).code === 'string' ? String((cause as any).code) : null;
    const msg = cause.message || String(cause);
    return `${base} (cause: ${code ? `${code} ` : ''}${msg})`;
  }

  return `${base} (cause: ${String(cause)})`;
}

function getConsensusReportDefaults(): {
  maxArguments: number;
  maxCharsPerSource: number;
  promptVersion: string;
} {
  return {
    maxArguments: parsePositiveInt(process.env.REPORT_MAX_ARGUMENTS, 120),
    maxCharsPerSource: parsePositiveInt(process.env.REPORT_MAX_CHARS_PER_SOURCE, 1200),
    promptVersion: process.env.REPORT_PROMPT_VERSION ?? 'consensus-report/v6-t3c-longform',
  };
}

function deriveAuthorId(pubkey: Uint8Array): string {
  // sha256(pubkey_bytes).slice(0,16) lowercase hex
  return createHash('sha256').update(pubkey).digest('hex').slice(0, 16);
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function trimForModel(text: string, maxChars: number): string {
  const normalized = text.trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function toExcerpt(text: string, maxChars: number): string {
  const normalized = text.trim().replaceAll('\n', ' ');
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function extractReportMetaBlock(contentMd: string): { contentMd: string; meta: Record<string, unknown> | null } {
  const startIndex = contentMd.indexOf(REPORT_META_START);
  if (startIndex < 0) return { contentMd, meta: null };
  const endIndex = contentMd.indexOf(REPORT_META_END, startIndex + REPORT_META_START.length);
  if (endIndex < 0) return { contentMd, meta: null };

  const before = contentMd.slice(0, startIndex).trimEnd();
  const after = contentMd.slice(endIndex + REPORT_META_END.length).trimStart();
  const between = contentMd.slice(startIndex + REPORT_META_START.length, endIndex);

  const jsonMatch = between.match(/```json\s*([\s\S]*?)\s*```/i);
  if (!jsonMatch) {
    const joined = [before, after].filter(Boolean).join('\n\n');
    return { contentMd: joined, meta: null };
  }

  try {
    const parsed = JSON.parse(jsonMatch[1]) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      const joined = [before, after].filter(Boolean).join('\n\n');
      return { contentMd: joined, meta: null };
    }
    const joined = [before, after].filter(Boolean).join('\n\n');
    return { contentMd: joined, meta: parsed as Record<string, unknown> };
  } catch {
    const joined = [before, after].filter(Boolean).join('\n\n');
    return { contentMd: joined, meta: null };
  }
}

function stanceBucket(args: { analysisStatus: string; stanceScore: number | null }, thresholds: {
  supportGte: number;
  opposeLte: number;
}): -1 | 0 | 1 {
  if (args.analysisStatus !== 'ready' || args.stanceScore === null) return 0;
  if (args.stanceScore <= thresholds.opposeLte) return -1;
  if (args.stanceScore >= thresholds.supportGte) return 1;
  return 0;
}

async function selectConsensusReportArguments(
  prisma: PrismaClient,
  topicId: string,
  selection: {
    maxSources: number;
    maxCharsPerSource: number;
    topVotesK: number;
    minPerBucket: number;
    stanceThresholds: { supportGte: number; opposeLte: number };
    depthBins: Array<'1' | '2-3' | '4+'>;
  },
): Promise<{
  topicTitle: string;
  arguments: Array<SelectedArgument & { depth: number | null; stance: -1 | 0 | 1 }>;
  selectedArgumentIds: string[];
  selectionSummary: ConsensusReportParamsSnapshot['selection'];
  coverage: {
    argumentsTotal: number;
    argumentsIncluded: number;
    votesTotal: number;
    votesIncluded: number;
  };
}> {
  const topic = await prisma.topic.findUnique({
    where: { id: topicId },
    select: {
      title: true,
      rootArgumentId: true,
    },
  });

  if (!topic || !topic.rootArgumentId) {
    throw new Error('Topic not found');
  }

  const [agg, candidates] = await Promise.all([
    prisma.argument.aggregate({
      where: { topicId, prunedAt: null },
      _count: { _all: true },
      _sum: { totalVotes: true },
    }),
    prisma.argument.findMany({
      where: { topicId, prunedAt: null },
      select: {
        id: true,
        parentId: true,
        totalVotes: true,
        createdAt: true,
        analysisStatus: true,
        stanceScore: true,
      },
    }),
  ]);

  const argumentsTotal = agg._count?._all ?? 0;
  const votesTotal = agg._sum?.totalVotes ?? 0;

  const byParent = new Map<string, string[]>();
  for (const arg of candidates) {
    if (!arg.parentId) continue;
    const list = byParent.get(arg.parentId) ?? [];
    list.push(arg.id);
    byParent.set(arg.parentId, list);
  }

  const depthById = new Map<string, number>();
  depthById.set(topic.rootArgumentId, 0);
  const queue: string[] = [topic.rootArgumentId];
  while (queue.length) {
    const current = queue.shift()!;
    const currentDepth = depthById.get(current);
    if (currentDepth === undefined) continue;
    const children = byParent.get(current) ?? [];
    for (const childId of children) {
      if (depthById.has(childId)) continue;
      depthById.set(childId, currentDepth + 1);
      queue.push(childId);
    }
  }

  const root = await prisma.argument.findUnique({
    where: { topicId_id: { topicId, id: topic.rootArgumentId } },
    select: {
      id: true,
      title: true,
      body: true,
      totalVotes: true,
      createdAt: true,
      authorPubkey: true,
      analysisStatus: true,
      stanceScore: true,
    },
  });

  if (!root) {
    throw new Error('Root argument not found');
  }

  const maxSources = Math.max(1, selection.maxSources);
  const topVotesK = Math.max(0, selection.topVotesK);
  const minPerBucket = Math.max(0, selection.minPerBucket);

  const sortedCandidates = candidates
    .filter((c) => c.id !== root.id)
    .slice()
    .sort((a, b) => {
      if (b.totalVotes !== a.totalVotes) return b.totalVotes - a.totalVotes;
      const timeDiff = a.createdAt.getTime() - b.createdAt.getTime();
      if (timeDiff !== 0) return timeDiff;
      return a.id.localeCompare(b.id);
    });

  const selectedIds = new Set<string>();
  selectedIds.add(root.id);

  for (const c of sortedCandidates.slice(0, topVotesK)) {
    if (selectedIds.size >= maxSources) break;
    selectedIds.add(c.id);
  }

  type DepthBin = '1' | '2-3' | '4+';
  function toDepthBin(depth: number | null): DepthBin {
    if (depth === 1) return '1';
    if (depth === 2 || depth === 3) return '2-3';
    return '4+';
  }

  const buckets = new Map<string, typeof sortedCandidates>();
  for (const c of sortedCandidates) {
    if (selectedIds.has(c.id)) continue;
    if (selectedIds.size >= maxSources) break;
    const depth = depthById.get(c.id) ?? null;
    const bin = toDepthBin(depth);
    if (!selection.depthBins.includes(bin)) continue;
    const stance = stanceBucket({ analysisStatus: c.analysisStatus, stanceScore: c.stanceScore }, selection.stanceThresholds);
    const key = `${stance}:${bin}`;
    const list = buckets.get(key) ?? [];
    list.push(c);
    buckets.set(key, list);
  }

  const stanceOrder: Array<-1 | 0 | 1> = [-1, 0, 1];
  for (const stance of stanceOrder) {
    for (const bin of selection.depthBins) {
      if (selectedIds.size >= maxSources) break;
      const key = `${stance}:${bin}`;
      const list = buckets.get(key);
      if (!list || list.length < minPerBucket) continue;
      for (const c of list.slice(0, minPerBucket)) {
        if (selectedIds.size >= maxSources) break;
        selectedIds.add(c.id);
      }
    }
  }

  for (const c of sortedCandidates) {
    if (selectedIds.size >= maxSources) break;
    if (selectedIds.has(c.id)) continue;
    selectedIds.add(c.id);
  }

  const orderedSelectedIds: string[] = [root.id, ...Array.from(selectedIds).filter((id) => id !== root.id)];
  const selectedDetail = await prisma.argument.findMany({
    where: { topicId, prunedAt: null, id: { in: orderedSelectedIds } },
    select: {
      id: true,
      title: true,
      body: true,
      totalVotes: true,
      createdAt: true,
      authorPubkey: true,
      analysisStatus: true,
      stanceScore: true,
    },
  });

  const detailById = new Map(selectedDetail.map((d) => [d.id, d] as const));

  const selected = orderedSelectedIds
    .map((id) => detailById.get(id))
    .filter((d): d is NonNullable<typeof d> => Boolean(d))
    .map((arg) => {
      const depth = depthById.get(arg.id) ?? null;
      const stance = stanceBucket(
        { analysisStatus: arg.analysisStatus, stanceScore: arg.stanceScore ?? null },
        selection.stanceThresholds,
      );
      return {
        id: arg.id,
        title: arg.title,
        body: arg.body,
        totalVotes: arg.totalVotes,
        createdAt: arg.createdAt,
        authorPubkey: arg.authorPubkey,
        depth,
        stance,
      };
    });

  const rootSelected = selected.find((arg) => arg.id === root.id) ?? null;
  const otherSelected = selected
    .filter((arg) => arg.id !== root.id)
    .slice()
    .sort((a, b) => {
      if (b.totalVotes !== a.totalVotes) return b.totalVotes - a.totalVotes;
      const timeDiff = a.createdAt.getTime() - b.createdAt.getTime();
      if (timeDiff !== 0) return timeDiff;
      return a.id.localeCompare(b.id);
    });

  const orderedSelected = rootSelected ? [rootSelected, ...otherSelected] : otherSelected;

  const selectedArgumentIds = orderedSelected.map((arg) => arg.id);
  const votesIncluded = orderedSelected.reduce((sum, arg) => sum + arg.totalVotes, 0);

  const selectionSummary: ConsensusReportParamsSnapshot['selection'] = {
    strategy: 'root+topVotes+stratified',
    maxSources,
    maxCharsPerSource: selection.maxCharsPerSource,
    topVotesK: Math.min(topVotesK, Math.max(0, maxSources - 1)),
    minPerBucket,
    stanceThresholds: selection.stanceThresholds,
    depthBins: [...selection.depthBins],
  };

  return {
    topicTitle: topic.title,
    arguments: orderedSelected,
    selectedArgumentIds,
    selectionSummary,
    coverage: {
      argumentsTotal,
      argumentsIncluded: orderedSelected.length,
      votesTotal,
      votesIncluded,
    },
  };
}

async function publishReportUpdatedEvent(redis: Redis, topicId: string, reportId: string): Promise<string> {
  const streamKey = `topic:events:${topicId}`;
  const envelope = {
    event: 'report_updated',
    data: { topicId, reportId },
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
