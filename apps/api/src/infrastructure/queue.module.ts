/**
 * @file queue.module.ts
 * @description BullMQ queue module for enqueueing AI jobs (Step 18)
 * @see docs/stage01/ai-worker.md#3
 */

import { Global, Module, OnModuleDestroy, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';

// Queue name per docs/stage01/ai-worker.md (using underscore instead of colon for BullMQ compatibility)
const QUEUE_ARGUMENT_ANALYSIS = 'ai_argument-analysis';
const QUEUE_TOPIC_CLUSTER = 'ai_topic-cluster';
const QUEUE_CONSENSUS_REPORT = 'ai_consensus-report';
const TOPIC_CLUSTER_DEBOUNCE_MS = 5 * 60 * 1000;

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
  private readonly topicClusterQueue: Queue;
  private readonly consensusReportQueue: Queue;

  constructor() {
    const connection = getRedisConnection();
    this.argumentAnalysisQueue = new Queue(QUEUE_ARGUMENT_ANALYSIS, { connection });
    this.topicClusterQueue = new Queue(QUEUE_TOPIC_CLUSTER, { connection });
    this.consensusReportQueue = new Queue(QUEUE_CONSENSUS_REPORT, { connection });
  }

  async onModuleDestroy() {
    await this.argumentAnalysisQueue.close();
    await this.topicClusterQueue.close();
    await this.consensusReportQueue.close();
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

  /**
   * Enqueue a topic clustering job (UMAP + HDBSCAN) with debounce (delay=5min).
   *
   * Job is idempotent via jobId="cluster:{topicId}".
   * Repeated enqueues for the same topic will be deduplicated by BullMQ.
   */
  async enqueueTopicCluster(topicId: string): Promise<string> {
    // BullMQ custom jobId cannot contain ":" (see Job.validateOptions).
    const jobId = `cluster_${topicId}`;
    try {
      const job = await this.topicClusterQueue.add(
        'cluster',
        { topicId },
        {
          jobId,
          delay: TOPIC_CLUSTER_DEBOUNCE_MS,
          removeOnComplete: 100,
          removeOnFail: 100,
        },
      );

      console.log(`[queue] Enqueued topic-cluster job=${job.id} topicId=${topicId}`);
      return job.id ?? jobId;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('already exists')) {
        return jobId;
      }
      throw err;
    }
  }

  /**
   * Enqueue a consensus report generation job (Step 22).
   *
   * Job is idempotent via jobId="report_{reportId}".
   */
  async enqueueConsensusReport(params: {
    topicId: string;
    reportId: string;
    trigger: 'auto' | 'host';
  }): Promise<string> {
    const job = await this.consensusReportQueue.add(
      'report',
      { topicId: params.topicId, reportId: params.reportId, trigger: params.trigger },
      {
        jobId: `report_${params.reportId}`,
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );

    console.log(
      `[queue] Enqueued consensus-report job=${job.id} topicId=${params.topicId} reportId=${params.reportId}`,
    );
    return job.id ?? params.reportId;
  }
}

@Global()
@Module({
  providers: [QueueService],
  exports: [QueueService],
})
export class QueueModule {}
