/**
 * @file argument-analysis.test.ts
 * @description TDD tests for argument analysis worker (Step 18)
 *
 * Test cases per step18.md:
 * - Same argument repeated enqueue: only writes once (ready short circuit)
 * - Failure semantics: writes analysis_status=failed, stance_score/embedding=NULL, still sends event
 * - Event: XADD topic:events:{topicId} with argument_updated + reason="analysis_done"
 * - Embedding dimensions: must be 4096 when successful; NULL on failure
 * - stanceScore range: clamp/validate in [-1,1]; invalid output is failure
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { getPrisma, type PrismaClient } from '@epiphany/database';
import Redis from 'ioredis';
import { v7 as uuidv7 } from 'uuid';

import { processArgumentAnalysis } from '../processors/argument-analysis.js';
import type { AIProvider } from '../providers/ai-provider.js';
import { createMockAIProvider } from '../providers/mock-ai-provider.js';

describe('Argument Analysis Processor', () => {
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
    // Create a fresh topic for each test
    topicId = uuidv7();
    rootArgumentId = uuidv7();

    // Create topic first without root argument
    await prisma.topic.create({
      data: {
        id: topicId,
        title: `Test Topic ${topicId}`,
        status: 'active',
      },
    });

    // Then create the root argument
    await prisma.argument.create({
      data: {
        id: rootArgumentId,
        topicId,
        parentId: null,
        title: 'Root',
        body: 'This is the root argument for testing.',
        authorPubkey: testPubkey,
        analysisStatus: 'ready',
        stanceScore: 0,
        totalVotes: 0,
        totalCost: 0,
      },
    });

    // Update topic with root argument reference
    await prisma.topic.update({
      where: { id: topicId },
      data: { rootArgumentId },
    });

    // Clear any existing events for this topic
    const streamKey = `topic:events:${topicId}`;
    await redis.del(streamKey);
  });

  describe('Success Path', () => {
    it('should write embedding with exactly 4096 dimensions on success', async () => {
      const argumentId = uuidv7();
      await createPendingArgument(prisma, topicId, argumentId, rootArgumentId, testPubkey);

      const mockProvider = createMockAIProvider({ shouldSucceed: true });

      await processArgumentAnalysis({
        argumentId,
        prisma,
        redis,
        aiProvider: mockProvider,
      });

      const updated = await prisma.argument.findUnique({
        where: { topicId_id: { topicId, id: argumentId } },
      });

      expect(updated).not.toBeNull();
      expect(updated!.analysisStatus).toBe('ready');
      expect(updated!.embedding).not.toBeNull();

      // Verify embedding is 4096 dimensions by checking the raw SQL
      const result = await prisma.$queryRaw<{ dim: number }[]>`
        SELECT vector_dims(embedding) as dim FROM arguments
        WHERE id = ${argumentId}::uuid AND topic_id = ${topicId}::uuid
      `;
      expect(result[0]?.dim).toBe(4096);
    });

    it('should write stanceScore in range [-1, 1] on success', async () => {
      const argumentId = uuidv7();
      await createPendingArgument(prisma, topicId, argumentId, rootArgumentId, testPubkey);

      const mockProvider = createMockAIProvider({
        shouldSucceed: true,
        stanceScore: 0.75,
      });

      await processArgumentAnalysis({
        argumentId,
        prisma,
        redis,
        aiProvider: mockProvider,
      });

      const updated = await prisma.argument.findUnique({
        where: { topicId_id: { topicId, id: argumentId } },
      });

      expect(updated).not.toBeNull();
      expect(updated!.stanceScore).toBe(0.75);
      expect(updated!.stanceScore).toBeGreaterThanOrEqual(-1);
      expect(updated!.stanceScore).toBeLessThanOrEqual(1);
    });

    it('should publish argument_updated event with reason="analysis_done" on success', async () => {
      const argumentId = uuidv7();
      await createPendingArgument(prisma, topicId, argumentId, rootArgumentId, testPubkey);

      const mockProvider = createMockAIProvider({ shouldSucceed: true });

      await processArgumentAnalysis({
        argumentId,
        prisma,
        redis,
        aiProvider: mockProvider,
      });

      const streamKey = `topic:events:${topicId}`;
      const events = await redis.xrange(streamKey, '-', '+');

      expect(events.length).toBeGreaterThanOrEqual(1);

      const lastEvent = events[events.length - 1];
      const eventData = JSON.parse(lastEvent[1][1]); // [id, ['data', jsonString]]

      expect(eventData.event).toBe('argument_updated');
      expect(eventData.data.argumentId).toBe(argumentId);
      expect(eventData.data.reason).toBe('analysis_done');
    });

    it('should write embedding_model to record the model used', async () => {
      const argumentId = uuidv7();
      await createPendingArgument(prisma, topicId, argumentId, rootArgumentId, testPubkey);

      const mockProvider = createMockAIProvider({ shouldSucceed: true });

      await processArgumentAnalysis({
        argumentId,
        prisma,
        redis,
        aiProvider: mockProvider,
      });

      const updated = await prisma.argument.findUnique({
        where: { topicId_id: { topicId, id: argumentId } },
      });

      expect(updated).not.toBeNull();
      expect(updated!.embeddingModel).toBe('mock-embedding-model');
    });
  });

  describe('Idempotency / Short Circuit', () => {
    it('should short circuit when argument is already ready (no AI calls)', async () => {
      const argumentId = uuidv7();

      // Create argument already in ready state
      await prisma.argument.create({
        data: {
          id: argumentId,
          topicId,
          parentId: rootArgumentId,
          title: 'Already Ready',
          body: 'This argument is already analyzed.',
          authorPubkey: testPubkey,
          analysisStatus: 'ready',
          stanceScore: 0.5,
          totalVotes: 0,
          totalCost: 0,
          embeddingModel: 'previous-model',
        },
      });

      const mockProvider = createMockAIProvider({ shouldSucceed: true });
      const getStanceSpy = vi.spyOn(mockProvider, 'getStance');
      const getEmbeddingSpy = vi.spyOn(mockProvider, 'getEmbedding');

      await processArgumentAnalysis({
        argumentId,
        prisma,
        redis,
        aiProvider: mockProvider,
      });

      // AI provider should NOT be called
      expect(getStanceSpy).not.toHaveBeenCalled();
      expect(getEmbeddingSpy).not.toHaveBeenCalled();
    });

    it('should handle repeated job enqueue - only processes once', async () => {
      const argumentId = uuidv7();
      await createPendingArgument(prisma, topicId, argumentId, rootArgumentId, testPubkey);

      const mockProvider = createMockAIProvider({ shouldSucceed: true });
      const getStanceSpy = vi.spyOn(mockProvider, 'getStance');

      // First call should process
      await processArgumentAnalysis({
        argumentId,
        prisma,
        redis,
        aiProvider: mockProvider,
      });

      expect(getStanceSpy).toHaveBeenCalledTimes(1);

      // Second call should short circuit (already ready)
      await processArgumentAnalysis({
        argumentId,
        prisma,
        redis,
        aiProvider: mockProvider,
      });

      // Still only called once
      expect(getStanceSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('Failure Semantics', () => {
    it('should write analysis_status=failed when AI provider fails', async () => {
      const argumentId = uuidv7();
      await createPendingArgument(prisma, topicId, argumentId, rootArgumentId, testPubkey);

      const mockProvider = createMockAIProvider({ shouldSucceed: false });

      await processArgumentAnalysis({
        argumentId,
        prisma,
        redis,
        aiProvider: mockProvider,
      });

      const updated = await prisma.argument.findUnique({
        where: { topicId_id: { topicId, id: argumentId } },
      });

      expect(updated).not.toBeNull();
      expect(updated!.analysisStatus).toBe('failed');
    });

    it('should set stance_score and embedding to NULL on failure', async () => {
      const argumentId = uuidv7();
      await createPendingArgument(prisma, topicId, argumentId, rootArgumentId, testPubkey);

      const mockProvider = createMockAIProvider({ shouldSucceed: false });

      await processArgumentAnalysis({
        argumentId,
        prisma,
        redis,
        aiProvider: mockProvider,
      });

      const updated = await prisma.argument.findUnique({
        where: { topicId_id: { topicId, id: argumentId } },
      });

      expect(updated).not.toBeNull();
      expect(updated!.stanceScore).toBeNull();
      // Prisma returns undefined for Unsupported vector fields, not null
      expect(updated!.embedding == null).toBe(true);
    });

    it('should still publish argument_updated event on failure', async () => {
      const argumentId = uuidv7();
      await createPendingArgument(prisma, topicId, argumentId, rootArgumentId, testPubkey);

      const mockProvider = createMockAIProvider({ shouldSucceed: false });

      await processArgumentAnalysis({
        argumentId,
        prisma,
        redis,
        aiProvider: mockProvider,
      });

      const streamKey = `topic:events:${topicId}`;
      const events = await redis.xrange(streamKey, '-', '+');

      expect(events.length).toBeGreaterThanOrEqual(1);

      const lastEvent = events[events.length - 1];
      const eventData = JSON.parse(lastEvent[1][1]);

      expect(eventData.event).toBe('argument_updated');
      expect(eventData.data.argumentId).toBe(argumentId);
      expect(eventData.data.reason).toBe('analysis_done');
    });

    it('should record error info in metadata on failure', async () => {
      const argumentId = uuidv7();
      await createPendingArgument(prisma, topicId, argumentId, rootArgumentId, testPubkey);

      const mockProvider = createMockAIProvider({
        shouldSucceed: false,
        errorMessage: 'Provider timeout',
      });

      await processArgumentAnalysis({
        argumentId,
        prisma,
        redis,
        aiProvider: mockProvider,
      });

      const updated = await prisma.argument.findUnique({
        where: { topicId_id: { topicId, id: argumentId } },
      });

      expect(updated).not.toBeNull();
      expect(updated!.metadata).not.toBeNull();
      const metadata = updated!.metadata as { error?: { message?: string } };
      expect(metadata.error).toBeDefined();
      expect(metadata.error!.message).toContain('Provider timeout');
    });

    it('should treat invalid stanceScore (outside [-1,1]) as failure', async () => {
      const argumentId = uuidv7();
      await createPendingArgument(prisma, topicId, argumentId, rootArgumentId, testPubkey);

      // Provider returns invalid stance score > 1
      const mockProvider = createMockAIProvider({
        shouldSucceed: true,
        stanceScore: 1.5, // Invalid: outside [-1, 1]
      });

      await processArgumentAnalysis({
        argumentId,
        prisma,
        redis,
        aiProvider: mockProvider,
      });

      const updated = await prisma.argument.findUnique({
        where: { topicId_id: { topicId, id: argumentId } },
      });

      expect(updated).not.toBeNull();
      expect(updated!.analysisStatus).toBe('failed');
      expect(updated!.stanceScore).toBeNull();
    });

    it('should treat stanceScore < -1 as failure', async () => {
      const argumentId = uuidv7();
      await createPendingArgument(prisma, topicId, argumentId, rootArgumentId, testPubkey);

      const mockProvider = createMockAIProvider({
        shouldSucceed: true,
        stanceScore: -1.5, // Invalid: outside [-1, 1]
      });

      await processArgumentAnalysis({
        argumentId,
        prisma,
        redis,
        aiProvider: mockProvider,
      });

      const updated = await prisma.argument.findUnique({
        where: { topicId_id: { topicId, id: argumentId } },
      });

      expect(updated).not.toBeNull();
      expect(updated!.analysisStatus).toBe('failed');
    });
  });

  describe('Edge Cases', () => {
    it('should handle argument not found gracefully', async () => {
      const nonExistentId = uuidv7();
      const mockProvider = createMockAIProvider({ shouldSucceed: true });

      // Should not throw, just return early
      await expect(
        processArgumentAnalysis({
          argumentId: nonExistentId,
          prisma,
          redis,
          aiProvider: mockProvider,
        })
      ).resolves.not.toThrow();
    });

    it('should correctly read parent text for stance analysis', async () => {
      const argumentId = uuidv7();
      const childBody = 'I disagree with the root argument.';

      await prisma.argument.create({
        data: {
          id: argumentId,
          topicId,
          parentId: rootArgumentId,
          title: 'Child Argument',
          body: childBody,
          authorPubkey: testPubkey,
          analysisStatus: 'pending_analysis',
          totalVotes: 0,
          totalCost: 0,
        },
      });

      let capturedParentText = '';
      let capturedChildText = '';

      const mockProvider: AIProvider = {
        getStance: async (parentText: string, childText: string) => {
          capturedParentText = parentText;
          capturedChildText = childText;
          return -0.5;
        },
        getEmbedding: async () => new Array(4096).fill(0.1),
        getEmbeddingModel: () => 'mock-model',
      };

      await processArgumentAnalysis({
        argumentId,
        prisma,
        redis,
        aiProvider: mockProvider,
      });

      // Should have called with parent's body and child's title+body
      expect(capturedParentText).toContain('This is the root argument for testing.');
      expect(capturedChildText).toContain(childBody);
    });

    it('should use title + body for embedding when title exists', async () => {
      const argumentId = uuidv7();
      const title = 'My Title';
      const body = 'My body content.';

      await prisma.argument.create({
        data: {
          id: argumentId,
          topicId,
          parentId: rootArgumentId,
          title,
          body,
          authorPubkey: testPubkey,
          analysisStatus: 'pending_analysis',
          totalVotes: 0,
          totalCost: 0,
        },
      });

      let capturedText = '';

      const mockProvider: AIProvider = {
        getStance: async () => 0,
        getEmbedding: async (text: string) => {
          capturedText = text;
          return new Array(4096).fill(0.1);
        },
        getEmbeddingModel: () => 'mock-model',
      };

      await processArgumentAnalysis({
        argumentId,
        prisma,
        redis,
        aiProvider: mockProvider,
      });

      expect(capturedText).toContain(title);
      expect(capturedText).toContain(body);
    });

    it('should use only body for embedding when title is null', async () => {
      const argumentId = uuidv7();
      const body = 'Only body content.';

      await prisma.argument.create({
        data: {
          id: argumentId,
          topicId,
          parentId: rootArgumentId,
          title: null,
          body,
          authorPubkey: testPubkey,
          analysisStatus: 'pending_analysis',
          totalVotes: 0,
          totalCost: 0,
        },
      });

      let capturedText = '';

      const mockProvider: AIProvider = {
        getStance: async () => 0,
        getEmbedding: async (text: string) => {
          capturedText = text;
          return new Array(4096).fill(0.1);
        },
        getEmbeddingModel: () => 'mock-model',
      };

      await processArgumentAnalysis({
        argumentId,
        prisma,
        redis,
        aiProvider: mockProvider,
      });

      expect(capturedText).toBe(body);
    });
  });
});

// Helper function to create a pending argument
async function createPendingArgument(
  prisma: PrismaClient,
  topicId: string,
  argumentId: string,
  parentId: string,
  authorPubkey: Buffer
): Promise<void> {
  await prisma.argument.create({
    data: {
      id: argumentId,
      topicId,
      parentId,
      title: 'Test Argument',
      body: 'This is a test argument body for analysis.',
      authorPubkey,
      analysisStatus: 'pending_analysis',
      totalVotes: 0,
      totalCost: 0,
    },
  });
}
