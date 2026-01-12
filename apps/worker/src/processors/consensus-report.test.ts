/**
 * @file consensus-report.test.ts
 * @description TDD tests for consensus report worker (Step 22)
 *
 * Test cases per docs/stage01/steps/step22.md:
 * - Job idempotency: same reportId rerun short-circuits (no duplicate generation)
 * - Failure semantics: status=failed and error written to metadata
 * - Success semantics: status=ready and contentMd present
 * - Input policy: filters pruned, deterministic ordering + traceable promptVersion/params
 * - Event: XADD topic:events:{topicId} with report_updated
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { getPrisma, type PrismaClient } from '@epiphany/database';
import Redis from 'ioredis';
import { v7 as uuidv7 } from 'uuid';

import {
  processConsensusReport,
  type ConsensusReportProvider,
  type GenerateConsensusReportInput,
} from './consensus-report.js';
import { cleanupTopicTestData } from '../test/cleanup.js';

describe('Consensus Report Processor', () => {
  let prisma: PrismaClient;
  let redis: Redis;
  let topicId: string;
  let rootArgumentId: string;
  let reportId: string;
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
    reportId = uuidv7();

    await prisma.topic.create({
      data: {
        id: topicId,
        title: `Test Topic ${topicId}`,
        visibility: 'private',
        status: 'active',
      },
    });

    await prisma.argument.create({
      data: {
        id: rootArgumentId,
        topicId,
        parentId: null,
        title: 'Root',
        body: 'Root argument for consensus report tests.',
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

    await prisma.consensusReport.create({
      data: {
        id: reportId,
        topicId,
        status: 'generating',
        contentMd: null,
        model: null,
        promptVersion: null,
        params: null,
        metadata: null,
        computedAt: null,
      },
    });

    await redis.del(`topic:events:${topicId}`);
  });

  afterEach(async () => {
    await cleanupTopicTestData({ prisma, redis, topicId });
  });

  it('should write status=ready with contentMd and publish report_updated', async () => {
    const provider: ConsensusReportProvider = {
      generate: vi.fn(async () => ({
        contentMd: '# Consensus Report\n\nHello world.',
        model: 'mock-report-model',
      })),
    };

    const result = await processConsensusReport({
      topicId,
      reportId,
      trigger: 'host',
      prisma,
      redis,
      provider,
    });

    expect(result.success).toBe(true);

    const updated = await prisma.consensusReport.findUnique({ where: { id: reportId } });
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('ready');
    expect(updated!.contentMd).toContain('Consensus Report');
    expect(updated!.promptVersion).toBe('consensus-report/v6-t3c-longform');
    expect(updated!.params).toBeTruthy();
    expect((updated!.params as any).filters?.pruned).toBe(false);
    expect(Array.isArray((updated!.params as any).selectedArgumentIds)).toBe(true);
    expect((updated!.metadata as any)?.sources).toBeTruthy();
    expect((updated!.metadata as any)?.coverage).toBeTruthy();
    expect(updated!.computedAt).not.toBeNull();

    const events = await redis.xrange(`topic:events:${topicId}`, '-', '+');
    expect(events.length).toBeGreaterThanOrEqual(1);
    const last = events[events.length - 1];
    const eventData = JSON.parse(last[1][1]);
    expect(eventData.event).toBe('report_updated');
    expect(eventData.data.topicId).toBe(topicId);
    expect(eventData.data.reportId).toBe(reportId);
  });

  it('should short circuit when report is already ready (no duplicate generation)', async () => {
    const provider: ConsensusReportProvider = {
      generate: vi.fn(async () => ({
        contentMd: '# Consensus Report\n\nFirst.',
        model: 'mock-report-model',
      })),
    };

    const first = await processConsensusReport({
      topicId,
      reportId,
      trigger: 'host',
      prisma,
      redis,
      provider,
    });
    expect(first.success).toBe(true);

    const eventsBefore = await redis.xrange(`topic:events:${topicId}`, '-', '+');

    const second = await processConsensusReport({
      topicId,
      reportId,
      trigger: 'host',
      prisma,
      redis,
      provider,
    });

    expect(second.success).toBe(true);
    expect(second.shortCircuited).toBe(true);
    expect((provider.generate as any).mock.calls.length).toBe(1);

    const eventsAfter = await redis.xrange(`topic:events:${topicId}`, '-', '+');
    expect(eventsAfter.length).toBe(eventsBefore.length);
  });

  it('should write status=failed with error metadata and publish report_updated', async () => {
    const provider: ConsensusReportProvider = {
      generate: vi.fn(async () => {
        throw new Error('Provider failed');
      }),
    };

    const result = await processConsensusReport({
      topicId,
      reportId,
      trigger: 'host',
      prisma,
      redis,
      provider,
    });

    expect(result.success).toBe(false);

    const updated = await prisma.consensusReport.findUnique({ where: { id: reportId } });
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('failed');
    expect(updated!.contentMd).toBeNull();
    expect(updated!.metadata).toBeTruthy();
    expect((updated!.metadata as any).error?.message).toContain('Provider failed');
    expect(updated!.computedAt).not.toBeNull();

    const events = await redis.xrange(`topic:events:${topicId}`, '-', '+');
    expect(events.length).toBeGreaterThanOrEqual(1);
    const last = events[events.length - 1];
    const eventData = JSON.parse(last[1][1]);
    expect(eventData.event).toBe('report_updated');
  });

  it('should filter pruned arguments from generation input and params', async () => {
    const prunedId = uuidv7();
    const visibleId = uuidv7();

    await prisma.argument.createMany({
      data: [
        {
          id: prunedId,
          topicId,
          parentId: rootArgumentId,
          title: 'Pruned',
          body: 'Should be excluded',
          authorPubkey: testPubkey,
          analysisStatus: 'ready',
          stanceScore: 0,
          totalVotes: 999,
          totalCost: 0,
          prunedAt: new Date(),
          pruneReason: 'test',
        },
        {
          id: visibleId,
          topicId,
          parentId: rootArgumentId,
          title: 'Visible',
          body: 'Should be included',
          authorPubkey: testPubkey,
          analysisStatus: 'ready',
          stanceScore: 0,
          totalVotes: 1,
          totalCost: 0,
        },
      ],
    });

    let captured: GenerateConsensusReportInput | null = null;
    const provider: ConsensusReportProvider = {
      generate: vi.fn(async (input) => {
        captured = input;
        return { contentMd: '# ok', model: 'mock-report-model' };
      }),
    };

    await processConsensusReport({
      topicId,
      reportId,
      trigger: 'host',
      prisma,
      redis,
      provider,
      maxArguments: 10,
    });

    expect(captured).not.toBeNull();
    expect(captured!.params.selectedArgumentIds).not.toContain(prunedId);

    const updated = await prisma.consensusReport.findUnique({ where: { id: reportId } });
    expect(updated).not.toBeNull();
    const sourceMap = (updated!.metadata as any)?.sources as Record<
      string,
      { argumentId: string; authorId: string }
    >;
    expect(sourceMap).toBeTruthy();
    const sourceArgumentIds = Object.values(sourceMap).map((s) => s.argumentId);
    expect(sourceArgumentIds).toContain(rootArgumentId);
    expect(sourceArgumentIds).toContain(visibleId);
    expect(sourceArgumentIds).not.toContain(prunedId);
  });
});
