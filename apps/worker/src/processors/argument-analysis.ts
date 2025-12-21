/**
 * @file argument-analysis.ts
 * @description Argument analysis job processor (Step 18)
 *
 * Processes argument analysis jobs:
 * 1. Reads argument + parent from DB
 * 2. Short-circuits if already ready (idempotency)
 * 3. Calls AI Provider for stance + embedding
 * 4. Transaction writes back to DB
 * 5. Publishes SSE invalidation event
 *
 * @see docs/ai-worker.md#4
 * @see docs/steps/step18.md
 */

import type { PrismaClient } from '@epiphany/database';
import type { Redis } from 'ioredis';
import { type AIProvider, isValidStanceScore, isValidEmbedding } from '../providers/ai-provider.js';

const EMBEDDING_DIMENSIONS = 4096;
const TOPIC_EVENTS_MAXLEN = 1000;

export interface ProcessArgumentAnalysisParams {
  argumentId: string;
  prisma: PrismaClient;
  redis: Redis;
  aiProvider: AIProvider;
}

export interface ProcessResult {
  success: boolean;
  shortCircuited?: boolean;
  error?: string;
}

/**
 * Process argument analysis job
 *
 * @returns Result indicating success/failure
 */
export async function processArgumentAnalysis(
  params: ProcessArgumentAnalysisParams
): Promise<ProcessResult> {
  const { argumentId, prisma, redis, aiProvider } = params;

  // Step 1: Read argument from DB
  const argument = await prisma.argument.findUnique({
    where: { id: argumentId },
    include: {
      parent: {
        select: {
          id: true,
          title: true,
          body: true,
        },
      },
    },
  });

  if (!argument) {
    console.warn(`[argument-analysis] Argument not found: ${argumentId}`);
    return { success: false, error: 'Argument not found' };
  }

  // Step 2: Idempotency check - short circuit if already ready
  if (argument.analysisStatus === 'ready') {
    console.log(`[argument-analysis] Short circuit: ${argumentId} already ready`);
    return { success: true, shortCircuited: true };
  }

  const topicId = argument.topicId;

  try {
    // Step 3: Call AI Provider
    const parentText = argument.parent
      ? formatArgumentText(argument.parent.title, argument.parent.body)
      : '';
    const childText = formatArgumentText(argument.title, argument.body);

    // Get stance and embedding in parallel
    const [stanceScore, embedding] = await Promise.all([
      argument.parent ? aiProvider.getStance(parentText, childText) : Promise.resolve(0),
      aiProvider.getEmbedding(childText),
    ]);

    const embeddingModel = aiProvider.getEmbeddingModel();

    // Validate results
    if (!isValidStanceScore(stanceScore)) {
      throw new Error(`Invalid stance score: ${stanceScore} (must be in [-1, 1])`);
    }

    if (!isValidEmbedding(embedding, EMBEDDING_DIMENSIONS)) {
      throw new Error(`Invalid embedding: expected ${EMBEDDING_DIMENSIONS} dimensions`);
    }

    // Step 4: Transaction write back to DB
    await prisma.$executeRaw`
      UPDATE arguments
      SET
        analysis_status = 'ready',
        stance_score = ${stanceScore},
        embedding = ${formatEmbeddingForPgvector(embedding)}::vector,
        embedding_model = ${embeddingModel},
        updated_at = NOW()
      WHERE id = ${argumentId}::uuid AND topic_id = ${topicId}::uuid
    `;

    // Step 5: Publish SSE invalidation event
    await publishArgumentUpdatedEvent(redis, topicId, argumentId);

    console.log(`[argument-analysis] Success: ${argumentId}`);
    return { success: true };
  } catch (error) {
    // Handle failure: write failed status and still publish event
    const errorMessage = error instanceof Error ? error.message : String(error);

    console.error(`[argument-analysis] Failed: ${argumentId}`, errorMessage);

    try {
      // Write failure state to DB (use raw SQL to clear embedding pgvector field)
      await prisma.$executeRaw`
        UPDATE arguments
        SET
          analysis_status = 'failed',
          stance_score = NULL,
          embedding = NULL,
          embedding_model = NULL,
          metadata = ${JSON.stringify({ error: { message: errorMessage, timestamp: new Date().toISOString() } })}::jsonb,
          updated_at = NOW()
        WHERE id = ${argumentId}::uuid AND topic_id = ${topicId}::uuid
      `;

      // Still publish event so frontend knows to update from pending -> failed
      await publishArgumentUpdatedEvent(redis, topicId, argumentId);
    } catch (writeError) {
      console.error(`[argument-analysis] Failed to write failure state:`, writeError);
    }

    return { success: false, error: errorMessage };
  }
}

/**
 * Format argument text for AI processing
 * Uses "title\n\nbody" format when title exists, otherwise just body
 */
function formatArgumentText(title: string | null, body: string): string {
  if (title && title.trim()) {
    return `${title}\n\n${body}`;
  }
  return body;
}

/**
 * Format embedding array for pgvector
 */
function formatEmbeddingForPgvector(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

/**
 * Publish argument_updated event to Redis Stream
 */
async function publishArgumentUpdatedEvent(
  redis: Redis,
  topicId: string,
  argumentId: string
): Promise<string | null> {
  const streamKey = `topic:events:${topicId}`;
  const envelope = {
    event: 'argument_updated',
    data: {
      argumentId,
      reason: 'analysis_done',
    },
  };

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
