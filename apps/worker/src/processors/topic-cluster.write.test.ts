/**
 * @file topic-cluster.write.test.ts
 * @description TDD tests for topic clustering DB write semantics (Step 19)
 *
 * Test cases per docs/stage01/steps/step19.md:
 * - Idempotent latest overwrite: re-run replaces camps/cluster_data (no bloat)
 * - cluster_updated invalidation is published after successful write
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { getPrisma, type PrismaClient } from '@epiphany/database';
import Redis from 'ioredis';
import { v7 as uuidv7 } from 'uuid';

import { processTopicCluster, type TopicClusterEngine } from '../processors/topic-cluster.js';
import { cleanupTopicTestData } from '../test/cleanup.js';

const EMBEDDING_DIMENSIONS = 4096;

describe('Topic Cluster Processor - DB overwrite idempotency', () => {
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

    await redis.del(`topic:events:${topicId}`);
  });

  afterEach(async () => {
    await cleanupTopicTestData({ prisma, redis, topicId });
  });

  it('should overwrite latest camps/cluster_data on re-run (no table bloat)', async () => {
    // Create 6 arguments, but prune 1 => 5 clusterable (meets new_arguments>=5)
    const ids = Array.from({ length: 6 }, () => uuidv7());

    await prisma.argument.createMany({
      data: ids.map((id, idx) => ({
        id,
        topicId,
        parentId: rootArgumentId,
        title: `Arg ${idx}`,
        body: `Body ${idx}`,
        authorPubkey: testPubkey,
        analysisStatus: 'ready',
        stanceScore: idx % 2 === 0 ? 0.4 : -0.4,
        totalVotes: idx + 1,
        totalCost: 0,
        prunedAt: idx === 5 ? new Date() : null,
      })),
    });

    for (const [idx, id] of ids.entries()) {
      await setEmbedding(prisma, topicId, id, 0.01 + idx * 0.001);
    }

    const engine: TopicClusterEngine = {
      engine: 'node',
      async cluster({ embeddings }) {
        const points = embeddings.map((row, idx) => ({
          argumentId: row.argumentId,
          x: idx,
          y: -idx,
          clusterId: idx < 3 ? 0 : idx === 3 ? 1 : -1,
        }));
        return { points };
      },
    };

    const t1 = new Date('2025-12-19T12:00:00.000Z');
    const r1 = await processTopicCluster({ topicId, prisma, redis, engine, computedAt: t1 });
    expect(r1.success).toBe(true);

    const clusterableCount = await prisma.clusterData.count({ where: { topicId } });
    const campsCount = await prisma.camp.count({ where: { topicId } });
    expect(clusterableCount).toBe(5); // pruned excluded
    expect(campsCount).toBe(2); // clusterId 0 and 1 only (noise excluded)

    // Make vote totals change enough to re-trigger threshold: +100 votes on one clusterable point
    await prisma.argument.update({
      where: { topicId_id: { topicId, id: ids[0]! } },
      data: { totalVotes: { increment: 100 } },
    });

    const t2 = new Date('2025-12-19T12:10:00.000Z');
    const r2 = await processTopicCluster({ topicId, prisma, redis, engine, computedAt: t2 });
    expect(r2.success).toBe(true);

    // Still latest-only: counts unchanged (no bloat)
    const clusterableCount2 = await prisma.clusterData.count({ where: { topicId } });
    const campsCount2 = await prisma.camp.count({ where: { topicId } });
    expect(clusterableCount2).toBe(5);
    expect(campsCount2).toBe(2);

    // Ensure rows were replaced (computedAt reflects latest)
    const anyRow = await prisma.clusterData.findFirst({ where: { topicId } });
    expect(anyRow).not.toBeNull();
    expect(anyRow!.computedAt.toISOString()).toBe(t2.toISOString());

    const topic = await prisma.topic.findUnique({ where: { id: topicId } });
    expect(topic).not.toBeNull();
    expect(topic!.lastClusteredAt?.toISOString()).toBe(t2.toISOString());
  });

  it('should publish cluster_updated invalidation after successful clustering', async () => {
    const ids = Array.from({ length: 5 }, () => uuidv7());

    await prisma.argument.createMany({
      data: ids.map((id, idx) => ({
        id,
        topicId,
        parentId: rootArgumentId,
        title: `Arg ${idx}`,
        body: `Body ${idx}`,
        authorPubkey: testPubkey,
        analysisStatus: 'ready',
        stanceScore: 0,
        totalVotes: 1,
        totalCost: 0,
      })),
    });

    for (const [idx, id] of ids.entries()) {
      await setEmbedding(prisma, topicId, id, 0.01 + idx * 0.001);
    }

    const engine: TopicClusterEngine = {
      engine: 'node',
      async cluster({ embeddings }) {
        return {
          points: embeddings.map((row, idx) => ({
            argumentId: row.argumentId,
            x: idx,
            y: idx,
            clusterId: 0,
          })),
        };
      },
    };

    const result = await processTopicCluster({
      topicId,
      prisma,
      redis,
      engine,
      computedAt: new Date('2025-12-19T12:00:00.000Z'),
    });

    expect(result.success).toBe(true);

    const events = await redis.xrange(`topic:events:${topicId}`, '-', '+');
    expect(events.length).toBeGreaterThanOrEqual(1);
    const last = events[events.length - 1];
    const data = JSON.parse(last[1][1]);
    expect(data.event).toBe('cluster_updated');
    expect(data.data.topicId).toBe(topicId);
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
