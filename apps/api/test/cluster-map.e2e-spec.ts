/**
 * @file cluster-map.e2e-spec.ts
 * @description Step 19 - GET /v1/topics/:topicId/cluster-map e2e tests
 *
 * Assertions per docs/steps/step19.md:
 * - x/y normalized to [-1,1] (and pruned points do not affect normalization)
 * - clusterId: DB NULL => "-1"
 * - weight = log(totalVotes + 1)
 * - pruned arguments are filtered out
 * - response parses via shared-contracts zClusterMap
 */

import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { v7 as uuidv7 } from 'uuid';
import { zClusterMap, zErrorResponse } from '@epiphany/shared-contracts';

import { createE2eApp } from './e2e-helpers';
import { PrismaService } from '../src/infrastructure/prisma.module';

describe('Cluster Map API (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('should return normalized cluster-map and satisfy contract', async () => {
    const topicId = uuidv7();
    const rootArgumentId = uuidv7();
    const authorPubkey = Buffer.alloc(32);

    const computedAt = new Date('2025-12-19T12:00:00.000Z');

    await prisma.topic.create({
      data: {
        id: topicId,
        title: `ClusterMap Topic ${topicId}`,
        status: 'active',
        lastClusteredAt: computedAt,
        lastClusterArgumentCount: 2,
        lastClusterTotalVotes: 9,
      },
    });

    await prisma.argument.create({
      data: {
        id: rootArgumentId,
        topicId,
        parentId: null,
        title: 'Root',
        body: 'Root',
        authorPubkey,
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

    const aNoise = uuidv7(); // cluster_id NULL => "-1"
    const aCluster0 = uuidv7(); // cluster_id 0 => "0"
    const aPruned = uuidv7(); // should be filtered out and not affect normalization

    await prisma.argument.createMany({
      data: [
        {
          id: aNoise,
          topicId,
          parentId: rootArgumentId,
          title: 'Noise',
          body: 'Noise',
          authorPubkey,
          analysisStatus: 'ready',
          stanceScore: -0.31,
          totalVotes: 0,
          totalCost: 0,
        },
        {
          id: aCluster0,
          topicId,
          parentId: rootArgumentId,
          title: 'Cluster0',
          body: 'Cluster0',
          authorPubkey,
          analysisStatus: 'ready',
          stanceScore: 0.31,
          totalVotes: 9,
          totalCost: 0,
        },
        {
          id: aPruned,
          topicId,
          parentId: rootArgumentId,
          title: 'Pruned',
          body: 'Pruned',
          authorPubkey,
          analysisStatus: 'ready',
          stanceScore: 0,
          totalVotes: 100,
          totalCost: 0,
          prunedAt: new Date(),
        },
      ],
    });

    // camps: only clusterId >=0
    await prisma.camp.create({
      data: {
        topicId,
        clusterId: 0,
        label: 'Camp 0',
        summary: null,
        params: { engine: 'node' },
        computedAt,
      },
    });

    // Raw UMAP coordinates (not normalized)
    // Non-pruned points: x in [10,20], y in [-5,5] => normalize to [-1,1]
    // Pruned point: extreme coordinates to ensure it's ignored for normalization.
    await prisma.clusterData.createMany({
      data: [
        {
          topicId,
          argumentId: aNoise,
          clusterId: null,
          umapX: 10,
          umapY: -5,
          computedAt,
        },
        {
          topicId,
          argumentId: aCluster0,
          clusterId: 0,
          umapX: 20,
          umapY: 5,
          computedAt,
        },
        {
          topicId,
          argumentId: aPruned,
          clusterId: 0,
          umapX: 1000,
          umapY: 1000,
          computedAt,
        },
      ],
    });

    const res = await request(app.getHttpServer())
      .get(`/v1/topics/${topicId}/cluster-map`)
      .expect(200);

    const parsed = zClusterMap.safeParse(res.body);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    expect(parsed.data.topicId).toBe(topicId);
    expect(parsed.data.points.length).toBe(2);

    const byId = new Map(parsed.data.points.map((p) => [p.argumentId, p]));
    expect(byId.has(aPruned)).toBe(false);

    const pNoise = byId.get(aNoise)!;
    expect(pNoise.clusterId).toBe('-1');
    expect(pNoise.x).toBe(-1);
    expect(pNoise.y).toBe(-1);
    expect(pNoise.stance).toBe(-1);
    expect(pNoise.weight).toBeCloseTo(Math.log(0 + 1), 8);

    const p0 = byId.get(aCluster0)!;
    expect(p0.clusterId).toBe('0');
    expect(p0.x).toBe(1);
    expect(p0.y).toBe(1);
    expect(p0.stance).toBe(1);
    expect(p0.weight).toBeCloseTo(Math.log(9 + 1), 8);

    // Cluster centroid should be computed in the same normalized coordinate system
    expect(parsed.data.clusters.length).toBe(1);
    const c0 = parsed.data.clusters[0]!;
    expect(c0.id).toBe('0');
    expect(c0.label).toBe('Camp 0');
    expect(c0.centroid).toEqual({ x: 1, y: 1 });
  });

  it('should return 404 TOPIC_NOT_FOUND for unknown topic', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/topics/${uuidv7()}/cluster-map`)
      .expect(404);

    const parsed = zErrorResponse.safeParse(res.body);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.error.code).toBe('TOPIC_NOT_FOUND');
  });
});

