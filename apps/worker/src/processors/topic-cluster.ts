/**
 * @file topic-cluster.ts
 * @description Topic clustering job processor (Step 19)
 *
 * Responsibilities:
 * - Compute threshold (new_arguments / total_votes_change_ratio) on the clusterable set
 * - Run UMAP(2D) + HDBSCAN via a pluggable engine (node/python)
 * - Transactionally replace latest camps + cluster_data
 * - Publish SSE invalidation: cluster_updated
 *
 * @see docs/ai-worker.md#5
 * @see docs/steps/step19.md
 */

import { Prisma, type PrismaClient } from '@epiphany/database';
import type { Redis } from 'ioredis';
import { zSseEnvelope } from '@epiphany/shared-contracts';
import type { Queue } from 'bullmq';

export const TOPIC_CLUSTER_DEBOUNCE_MS = 5 * 60 * 1000;
const TOPIC_EVENTS_MAXLEN = 1000;

const THRESHOLD_NEW_ARGUMENTS = 5;
const THRESHOLD_TOTAL_VOTES_CHANGE_RATIO = 0.2;

export interface ClusterableStats {
  argumentCount: number;
  totalVotes: number;
}

export interface TopicClusterThresholdResult {
  newArguments: number;
  totalVotesChangeRatio: number;
  shouldCluster: boolean;
}

export function computeTopicClusterThreshold(params: {
  current: ClusterableStats;
  last: ClusterableStats;
}): TopicClusterThresholdResult {
  const newArguments = params.current.argumentCount - params.last.argumentCount;
  const totalVotesChangeRatio =
    Math.abs(params.current.totalVotes - params.last.totalVotes) /
    Math.max(1, params.last.totalVotes);

  return {
    newArguments,
    totalVotesChangeRatio,
    shouldCluster:
      newArguments >= THRESHOLD_NEW_ARGUMENTS ||
      totalVotesChangeRatio >= THRESHOLD_TOTAL_VOTES_CHANGE_RATIO,
  };
}

export async function getTopicClusterableStats(params: {
  prisma: PrismaClient;
  topicId: string;
}): Promise<ClusterableStats> {
  const rows = await params.prisma.$queryRaw<
    Array<{ argumentCount: number; totalVotes: number | null }>
  >`
    SELECT
      COUNT(*)::int AS "argumentCount",
      COALESCE(SUM(total_votes), 0)::int AS "totalVotes"
    FROM arguments
    WHERE topic_id = ${params.topicId}::uuid
      AND pruned_at IS NULL
      AND analysis_status = 'ready'
      AND embedding IS NOT NULL
  `;

  const row = rows[0];
  return {
    argumentCount: row?.argumentCount ?? 0,
    totalVotes: row?.totalVotes ?? 0,
  };
}

export interface ClusterEngineUmapParams {
  nComponents: 2;
  nNeighbors: number;
  minDist: number;
  randomState: number;
  metric: 'cosine';
}

export interface ClusterEngineHdbscanParams {
  metric: 'euclidean';
  minClusterSize: number;
  minSamples: number;
  clusterSelectionMethod: 'eom';
}

export interface ClusterEnginePoint {
  argumentId: string;
  x: number;
  y: number;
  clusterId: number; // HDBSCAN label; -1 means noise
}

export interface ClusterEngineResult {
  points: ClusterEnginePoint[];
}

export type TopicClusterEngine =
  | {
      engine: 'node';
      cluster: (opts: {
        embeddings: Array<{ argumentId: string; embedding: number[] }>;
        umap: ClusterEngineUmapParams;
        hdbscan: ClusterEngineHdbscanParams;
      }) => Promise<ClusterEngineResult>;
    }
  | {
      engine: 'python';
      cluster: (opts: {
        topicId: string;
        computedAt: Date;
        umap: ClusterEngineUmapParams;
        hdbscan: ClusterEngineHdbscanParams;
      }) => Promise<ClusterEngineResult>;
    };

export interface ProcessTopicClusterParams {
  topicId: string;
  prisma: PrismaClient;
  redis: Redis;
  engine: TopicClusterEngine;
  computedAt?: Date;
}

export interface ProcessTopicClusterResult {
  success: boolean;
  shortCircuited?: boolean;
  error?: string;
}

export async function processTopicCluster(
  params: ProcessTopicClusterParams
): Promise<ProcessTopicClusterResult> {
  const computedAt = params.computedAt ?? new Date();

  const topic = await params.prisma.topic.findUnique({
    where: { id: params.topicId },
    select: {
      id: true,
      lastClusterArgumentCount: true,
      lastClusterTotalVotes: true,
    },
  });

  if (!topic) {
    return { success: false, error: 'Topic not found' };
  }

  const current = await getTopicClusterableStats({
    prisma: params.prisma,
    topicId: params.topicId,
  });

  const threshold = computeTopicClusterThreshold({
    current,
    last: {
      argumentCount: topic.lastClusterArgumentCount ?? 0,
      totalVotes: topic.lastClusterTotalVotes ?? 0,
    },
  });

  if (!threshold.shouldCluster) {
    return { success: true, shortCircuited: true };
  }

  // Practical guardrail: HDBSCAN's min_cluster_size is >= 5 in v1.0 defaults.
  if (current.argumentCount < THRESHOLD_NEW_ARGUMENTS) {
    return { success: true, shortCircuited: true };
  }

  const umap = getDefaultUmapParams(current.argumentCount);
  const hdbscan = getDefaultHdbscanParams(current.argumentCount);

  let engineResult: ClusterEngineResult;
  if (params.engine.engine === 'node') {
    const embeddings = await readClusterableEmbeddings(params.prisma, params.topicId);
    engineResult = await params.engine.cluster({ embeddings, umap, hdbscan });
  } else {
    engineResult = await params.engine.cluster({
      topicId: params.topicId,
      computedAt,
      umap,
      hdbscan,
    });
  }

  const points = engineResult.points;
  if (!Array.isArray(points) || points.length === 0) {
    return { success: false, error: 'Engine returned empty points' };
  }

  const campClusterIds = Array.from(
    new Set(points.map((p) => p.clusterId).filter((id) => Number.isFinite(id) && id >= 0))
  ).sort((a, b) => a - b);

  const campParams: Prisma.InputJsonValue = {
    engine: params.engine.engine,
    umap: {
      nComponents: umap.nComponents,
      nNeighbors: umap.nNeighbors,
      minDist: umap.minDist,
      randomState: umap.randomState,
      metric: umap.metric,
    },
    hdbscan: {
      metric: hdbscan.metric,
      minClusterSize: hdbscan.minClusterSize,
      minSamples: hdbscan.minSamples,
      clusterSelectionMethod: hdbscan.clusterSelectionMethod,
    },
    threshold: {
      newArguments: threshold.newArguments,
      totalVotesChangeRatio: threshold.totalVotesChangeRatio,
      current: { argumentCount: current.argumentCount, totalVotes: current.totalVotes },
      last: {
        argumentCount: topic.lastClusterArgumentCount ?? 0,
        totalVotes: topic.lastClusterTotalVotes ?? 0,
      },
    },
    normalization: {
      method: 'minmax',
      range: [-1, 1],
      axes: 'separate',
      appliedIn: 'api',
    },
  };

  try {
    await params.prisma.$transaction(async (tx) => {
      // latest-only overwrite strategy (delete then insert) per docs/database.md
      await tx.clusterData.deleteMany({ where: { topicId: params.topicId } });
      await tx.camp.deleteMany({ where: { topicId: params.topicId } });

      if (campClusterIds.length > 0) {
        await tx.camp.createMany({
          data: campClusterIds.map((clusterId) => ({
            topicId: params.topicId,
            clusterId,
            label: null,
            summary: null,
            params: campParams,
            computedAt,
          })),
        });
      }

      await tx.clusterData.createMany({
        data: points.map((p) => ({
          topicId: params.topicId,
          argumentId: p.argumentId,
          clusterId: p.clusterId >= 0 ? p.clusterId : null,
          umapX: p.x,
          umapY: p.y,
          computedAt,
        })),
      });

      await tx.topic.update({
        where: { id: params.topicId },
        data: {
          lastClusteredAt: computedAt,
          lastClusterArgumentCount: current.argumentCount,
          lastClusterTotalVotes: current.totalVotes,
        },
      });
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }

  try {
    await publishClusterUpdatedEvent(params.redis, params.topicId);
  } catch (err) {
    // Best-effort invalidation (do not treat as job failure)
    console.warn('[topic-cluster] Failed to publish cluster_updated event:', err);
  }

  return { success: true };
}

export async function enqueueTopicClusterDebounced(
  queue: Queue,
  topicId: string
): Promise<string> {
  // BullMQ custom jobId cannot contain ":" (see Job.validateOptions).
  const jobId = `cluster_${topicId}`;

  try {
    await queue.add(
      'cluster',
      { topicId },
      {
        jobId,
        delay: TOPIC_CLUSTER_DEBOUNCE_MS,
        removeOnComplete: 100,
        removeOnFail: 100,
      }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // BullMQ duplicate jobId: treat as debounce hit
    if (msg.includes('Job') && msg.includes('already exists')) return jobId;
    if (msg.includes('JobId') && msg.includes('already exists')) return jobId;
    throw err;
  }

  return jobId;
}

function getDefaultUmapParams(n: number): ClusterEngineUmapParams {
  // Per docs/ai-worker.md: n_neighbors = min(15, n-1)
  const nNeighbors = Math.max(2, Math.min(15, n - 1));
  return {
    nComponents: 2,
    nNeighbors,
    minDist: 0.1,
    randomState: 42,
    metric: 'cosine',
  };
}

function getDefaultHdbscanParams(n: number): ClusterEngineHdbscanParams {
  const base = Math.max(THRESHOLD_NEW_ARGUMENTS, Math.floor(n * 0.02));
  const minClusterSize = Math.max(2, Math.min(base, n));
  return {
    metric: 'euclidean',
    minClusterSize,
    minSamples: minClusterSize,
    clusterSelectionMethod: 'eom',
  };
}

async function readClusterableEmbeddings(
  prisma: PrismaClient,
  topicId: string
): Promise<Array<{ argumentId: string; embedding: number[] }>> {
  const rows = await prisma.$queryRaw<Array<{ argumentId: string; embeddingText: string }>>`
    SELECT
      id              AS "argumentId",
      embedding::text AS "embeddingText"
    FROM arguments
    WHERE topic_id = ${topicId}::uuid
      AND pruned_at IS NULL
      AND analysis_status = 'ready'
      AND embedding IS NOT NULL
    ORDER BY created_at ASC, id ASC
  `;

  return rows.map((row) => ({
    argumentId: row.argumentId,
    embedding: parsePgvectorText(row.embeddingText),
  }));
}

function parsePgvectorText(text: string): number[] {
  // pgvector text format: "[0.1,0.2,...]"
  const trimmed = text.trim();
  const body =
    trimmed.startsWith('[') && trimmed.endsWith(']')
      ? trimmed.slice(1, -1)
      : trimmed;
  if (!body) return [];
  return body.split(',').map((s) => Number(s.trim()));
}

async function publishClusterUpdatedEvent(redis: Redis, topicId: string): Promise<string> {
  const streamKey = `topic:events:${topicId}`;
  const envelope = zSseEnvelope.parse({
    event: 'cluster_updated',
    data: { topicId },
  });

  const id = await redis.xadd(
    streamKey,
    'MAXLEN',
    '~',
    String(TOPIC_EVENTS_MAXLEN),
    '*',
    'data',
    JSON.stringify(envelope)
  );

  if (!id) {
    throw new Error(`Failed to publish event to stream ${streamKey}`);
  }

  return id;
}
