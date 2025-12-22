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
 * @see docs/ai-worker.md#7
 * @see docs/steps/step22.md
 */

import { Prisma, type PrismaClient } from '@epiphany/database';
import type { Redis } from 'ioredis';

const TOPIC_EVENTS_MAXLEN = 1000;
const DEFAULT_MAX_ARGUMENTS = 30;
const DEFAULT_PROMPT_VERSION = 'consensus-report/v1';

export type ConsensusReportTrigger = 'auto' | 'host';

export interface SelectedArgument {
  id: string;
  title: string | null;
  body: string;
  totalVotes: number;
  createdAt: Date;
}

export interface ConsensusReportParamsSnapshot {
  promptVersion: string;
  trigger: ConsensusReportTrigger;
  maxArguments: number;
  ordering: 'totalVotes_desc_createdAt_asc_id_asc';
  filters: {
    pruned: false;
  };
  selectedArgumentIds: string[];
}

export interface GenerateConsensusReportInput {
  topicId: string;
  topicTitle: string;
  rootArgumentId: string;
  arguments: SelectedArgument[];
  params: ConsensusReportParamsSnapshot;
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
  const {
    topicId,
    reportId,
    trigger,
    prisma,
    redis,
    provider,
    promptVersion = DEFAULT_PROMPT_VERSION,
    maxArguments = DEFAULT_MAX_ARGUMENTS,
  } = params;

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
    const { topicTitle, rootArgumentId, arguments: selectedArgs, selectedArgumentIds } =
      await selectConsensusReportArguments(prisma, topicId, maxArguments);

    paramsSnapshot = {
      promptVersion,
      trigger,
      maxArguments,
      ordering: 'totalVotes_desc_createdAt_asc_id_asc',
      filters: { pruned: false },
      selectedArgumentIds,
    };

    const paramsJson = paramsSnapshot as unknown as Prisma.InputJsonValue;

    const { contentMd, model } = await provider.generate({
      topicId,
      topicTitle,
      rootArgumentId,
      arguments: selectedArgs,
      params: paramsSnapshot,
    });

    if (!contentMd || !contentMd.trim()) {
      throw new Error('Provider returned empty contentMd');
    }

    await prisma.consensusReport.update({
      where: { id: reportId },
      data: {
        status: 'ready',
        contentMd,
        model,
        promptVersion,
        params: paramsJson,
        metadata: Prisma.DbNull,
        computedAt: startedAt,
      },
    });

    await publishReportUpdatedEvent(redis, topicId, reportId);

    return { success: true, topicId, reportId };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
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
        maxArguments,
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

async function selectConsensusReportArguments(
  prisma: PrismaClient,
  topicId: string,
  maxArguments: number,
): Promise<{
  topicTitle: string;
  rootArgumentId: string;
  arguments: SelectedArgument[];
  selectedArgumentIds: string[];
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

  const root = await prisma.argument.findUnique({
    where: { topicId_id: { topicId, id: topic.rootArgumentId } },
    select: {
      id: true,
      title: true,
      body: true,
      totalVotes: true,
      createdAt: true,
    },
  });

  if (!root) {
    throw new Error('Root argument not found');
  }

  const remaining = Math.max(0, maxArguments - 1);

  const others = remaining
    ? await prisma.argument.findMany({
        where: {
          topicId,
          prunedAt: null,
          NOT: { id: root.id },
        },
        orderBy: [{ totalVotes: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
        take: remaining,
        select: {
          id: true,
          title: true,
          body: true,
          totalVotes: true,
          createdAt: true,
        },
      })
    : [];

  const selected = [root, ...others].map((arg) => ({
    id: arg.id,
    title: arg.title,
    body: arg.body,
    totalVotes: arg.totalVotes,
    createdAt: arg.createdAt,
  }));

  const selectedArgumentIds = selected.map((arg) => arg.id);

  return {
    topicTitle: topic.title,
    rootArgumentId: root.id,
    arguments: selected,
    selectedArgumentIds,
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
