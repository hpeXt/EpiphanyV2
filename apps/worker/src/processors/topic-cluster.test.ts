/**
 * @file topic-cluster.test.ts
 * @description TDD tests for topic clustering worker (Step 19)
 *
 * Test cases per docs/stage01/steps/step19.md:
 * - Threshold stats: filters pruned + only ready & embedding!=NULL
 * - Threshold formula: new_arguments>=5 OR total_votes_change_ratio>=20%
 * - Debounce: same topic enqueue within 5min is deduped via jobId
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { Queue } from 'bullmq';
import { getPrisma, type PrismaClient } from '@epiphany/database';
import Redis from 'ioredis';
import { v7 as uuidv7 } from 'uuid';

import { getRedisConnection } from '../lib/redis-connection.js';
import {
  TOPIC_CLUSTER_DEBOUNCE_MS,
  computeTopicClusterThreshold,
  enqueueTopicClusterDebounced,
  getTopicClusterableStats,
} from '../processors/topic-cluster.js';
import { cleanupTopicTestData } from '../test/cleanup.js';

const EMBEDDING_DIMENSIONS = 4096;

describe('Topic Cluster Threshold + Debounce', () => {
  let prisma: PrismaClient;
  let redis: Redis;
  let topicId: string;
  let rootArgumentId: string;
  let testPubkey: Buffer;

  beforeAll(async () => {
    prisma = getPrisma();
    redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
    testPubkey = Buffer.from('0'.repeat(64), 'hex');
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await redis.quit();
  });

  beforeEach(async () => {
    topicId = uuidv7();
    rootArgumentId = uuidv7();

    await prisma.topic.create({
      data: {
        id: topicId,
        title: `Test Topic ${topicId}`,
        visibility: 'private',
        status: 'active',
        lastClusterArgumentCount: 0,
        lastClusterTotalVotes: 0,
      },
    });

    await prisma.argument.create({
      data: {
        id: rootArgumentId,
        topicId,
        parentId: null,
        title: 'Root',
        body: 'Root argument for clustering tests.',
        authorPubkey: testPubkey,
        analysisStatus: 'ready',
        stanceScore: 0,
        totalVotes: 0,
        totalCost: 0,
      },
    });

    await prisma.topic.update({
      where: { id: topicId },
      data: { rootArgumentId },
    });

    // Clear any existing events for this topic
    await redis.del(`topic:events:${topicId}`);
  });

  afterEach(async () => {
    await cleanupTopicTestData({ prisma, redis, topicId });
  });

  it('should compute clusterable stats by filtering pruned + only ready&embedding!=NULL', async () => {
    const clusterable1 = uuidv7();
    const pruned = uuidv7();
    const noEmbedding = uuidv7();
    const pending = uuidv7();
    const clusterable2 = uuidv7();

    await prisma.argument.createMany({
      data: [
        {
          id: clusterable1,
          topicId,
          parentId: rootArgumentId,
          title: 'A',
          body: 'A',
          authorPubkey: testPubkey,
          analysisStatus: 'ready',
          stanceScore: 0.1,
          totalVotes: 2,
          totalCost: 0,
        },
        {
          id: pruned,
          topicId,
          parentId: rootArgumentId,
          title: 'B',
          body: 'B',
          authorPubkey: testPubkey,
          analysisStatus: 'ready',
          stanceScore: 0.1,
          totalVotes: 100,
          totalCost: 0,
          prunedAt: new Date(),
          pruneReason: 'test',
        },
        {
          id: noEmbedding,
          topicId,
          parentId: rootArgumentId,
          title: 'C',
          body: 'C',
          authorPubkey: testPubkey,
          analysisStatus: 'ready',
          stanceScore: 0.1,
          totalVotes: 50,
          totalCost: 0,
        },
        {
          id: pending,
          topicId,
          parentId: rootArgumentId,
          title: 'D',
          body: 'D',
          authorPubkey: testPubkey,
          analysisStatus: 'pending_analysis',
          stanceScore: null,
          totalVotes: 30,
          totalCost: 0,
        },
        {
          id: clusterable2,
          topicId,
          parentId: rootArgumentId,
          title: 'E',
          body: 'E',
          authorPubkey: testPubkey,
          analysisStatus: 'ready',
          stanceScore: -0.4,
          totalVotes: 3,
          totalCost: 0,
        },
      ],
    });

    // Set embeddings only for the 2 clusterable arguments (ready + not pruned)
    await setEmbedding(prisma, topicId, clusterable1, 0.01);
    await setEmbedding(prisma, topicId, clusterable2, 0.02);

    // Also set embedding for pending (should still be excluded due to analysis_status!=ready)
    await setEmbedding(prisma, topicId, pending, 0.03);

    const stats = await getTopicClusterableStats({ prisma, topicId });

    expect(stats.argumentCount).toBe(2);
    expect(stats.totalVotes).toBe(2 + 3);
  });

  it('should apply the documented threshold formula (new_arguments>=5 OR total_votes_change_ratio>=20%)', () => {
    // new_arguments threshold
    expect(
      computeTopicClusterThreshold({
        current: { argumentCount: 5, totalVotes: 0 },
        last: { argumentCount: 0, totalVotes: 0 },
      }).shouldCluster
    ).toBe(true);

    expect(
      computeTopicClusterThreshold({
        current: { argumentCount: 4, totalVotes: 0 },
        last: { argumentCount: 0, totalVotes: 0 },
      }).shouldCluster
    ).toBe(false);

    // total_votes_change_ratio threshold: abs(125-100)/max(1,100)=0.25
    const r1 = computeTopicClusterThreshold({
      current: { argumentCount: 0, totalVotes: 125 },
      last: { argumentCount: 0, totalVotes: 100 },
    });
    expect(r1.totalVotesChangeRatio).toBeCloseTo(0.25, 5);
    expect(r1.shouldCluster).toBe(true);

    // below threshold: abs(110-100)/100=0.10
    const r2 = computeTopicClusterThreshold({
      current: { argumentCount: 0, totalVotes: 110 },
      last: { argumentCount: 0, totalVotes: 100 },
    });
    expect(r2.totalVotesChangeRatio).toBeCloseTo(0.1, 5);
    expect(r2.shouldCluster).toBe(false);
  });

  it('should debounce via BullMQ jobId + 5min delay (no duplicate jobs for same topic)', async () => {
    expect(TOPIC_CLUSTER_DEBOUNCE_MS).toBe(5 * 60 * 1000);

    const queueName = `ai_topic-cluster_test_${uuidv7()}`;
    const queue = new Queue(queueName, { connection: getRedisConnection() });

    try {
      await enqueueTopicClusterDebounced(queue, topicId);
      await enqueueTopicClusterDebounced(queue, topicId);

      const jobId = `cluster_${topicId}`;
      const job = await queue.getJob(jobId);
      expect(job).not.toBeNull();
      expect(job!.opts.delay).toBe(TOPIC_CLUSTER_DEBOUNCE_MS);

      const delayed = await queue.getJobs(['delayed']);
      expect(delayed.length).toBe(1);
      expect(delayed[0]!.id).toBe(jobId);
    } finally {
      await queue.obliterate({ force: true });
      await queue.close();
    }
  });
});

function formatEmbeddingForPgvector(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

async function setEmbedding(
  prisma: PrismaClient,
  topicId: string,
  argumentId: string,
  fill: number
): Promise<void> {
  const embedding = new Array(EMBEDDING_DIMENSIONS).fill(fill);
  await prisma.$executeRaw`
    UPDATE arguments
    SET embedding = ${formatEmbeddingForPgvector(embedding)}::vector
    WHERE id = ${argumentId}::uuid AND topic_id = ${topicId}::uuid
  `;
}
