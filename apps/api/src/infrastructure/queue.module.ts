/**
 * @file queue.module.ts
 * @description BullMQ queue module for enqueueing AI jobs (Step 18)
 * @see docs/ai-worker.md#3
 */

import { Global, Module, OnModuleDestroy, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';

// Queue name per docs/ai-worker.md (using underscore instead of colon for BullMQ compatibility)
const QUEUE_ARGUMENT_ANALYSIS = 'ai_argument-analysis';

/**
 * Parse Redis URL to BullMQ connection options
 */
function getRedisConnection() {
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
  const url = new URL(redisUrl);

  const port = url.port ? Number(url.port) : 6379;
  const db = url.pathname?.length > 1 ? Number(url.pathname.slice(1)) : 0;
  const username = url.username ? decodeURIComponent(url.username) : undefined;
  const password = url.password ? decodeURIComponent(url.password) : undefined;

  return {
    host: url.hostname,
    port,
    db: Number.isFinite(db) ? db : 0,
    username,
    password,
    tls: url.protocol === 'rediss:' ? {} : undefined,
  };
}

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly argumentAnalysisQueue: Queue;

  constructor() {
    const connection = getRedisConnection();
    this.argumentAnalysisQueue = new Queue(QUEUE_ARGUMENT_ANALYSIS, { connection });
  }

  async onModuleDestroy() {
    await this.argumentAnalysisQueue.close();
  }

  /**
   * Enqueue an argument for AI analysis (stance + embedding)
   *
   * @param argumentId - The argument ID to analyze
   * @returns Job ID
   *
   * Job is idempotent via jobId="arg:{argumentId}".
   * Repeated enqueues for the same argument will be deduplicated.
   */
  async enqueueArgumentAnalysis(argumentId: string): Promise<string> {
    const job = await this.argumentAnalysisQueue.add(
      'analysis',
      { argumentId },
      {
        jobId: `arg_${argumentId}`,
        removeOnComplete: 100,
        removeOnFail: 100,
      }
    );

    console.log(`[queue] Enqueued argument-analysis job=${job.id} argumentId=${argumentId}`);
    return job.id ?? argumentId;
  }
}

@Global()
@Module({
  providers: [QueueService],
  exports: [QueueService],
})
export class QueueModule {}
