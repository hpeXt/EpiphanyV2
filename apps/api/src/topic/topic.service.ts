/**
 * @file topic.service.ts
 * @description Topic business logic service
 */
import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../infrastructure/prisma.module.js';
import { RedisService } from '../infrastructure/redis.module.js';
import { QueueService } from '../infrastructure/queue.module.js';
import { TopicEventsPublisher } from '../sse/topic-events.publisher.js';
import type {
  ClusterMap,
  ConsensusReport,
  ConsensusReportLatestResponse,
  CreateTopicRequest,
  LedgerMe,
  StakeMeItem,
  StakesMeResponse,
  TopicSummary,
} from '@epiphany/shared-contracts';
import { buildClusterMapResponse, getClusterMapModelVersion } from './cluster-map.mapper.js';

type TransactionClient = Prisma.TransactionClient;

export interface CreateTopicResult {
  topicId: string;
  rootArgumentId: string;
  claimToken: string;
  expiresAt: string;
}

export interface ListTopicsParams {
  limit?: number;
  beforeId?: string;
  orderBy?: 'createdAt_desc';
}

export interface ListTopicsResult {
  items: TopicSummary[];
  nextBeforeId: string | null;
}

@Injectable()
export class TopicService {
  private readonly DEFAULT_LIMIT = 20;
  private readonly MAX_LIMIT = 100;
  private readonly CLAIM_TOKEN_TTL_SECONDS = 300; // 5 minutes

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly queue: QueueService,
    private readonly topicEvents: TopicEventsPublisher,
  ) {}

  private assertIsTopicOwner(topic: { ownerPubkey: Uint8Array | null }, pubkeyHex: string): void {
    const ownerHex = topic.ownerPubkey ? Buffer.from(topic.ownerPubkey).toString('hex') : null;
    if (!ownerHex || ownerHex !== pubkeyHex) {
      throw new ForbiddenException({
        error: { code: 'NOT_TOPIC_OWNER', message: 'Not topic owner' },
      });
    }
  }

  private assertTopicStatusAllowsHostCommand(params: {
    currentStatus: 'active' | 'frozen' | 'archived';
    command: {
      type:
        | 'SET_STATUS'
        | 'EDIT_ROOT'
        | 'PRUNE_ARGUMENT'
        | 'UNPRUNE_ARGUMENT'
        | 'BLACKLIST_PUBKEY'
        | 'UNBLACKLIST_PUBKEY'
        | 'GENERATE_CONSENSUS_REPORT';
      payload: unknown;
    };
  }): void {
    if (params.currentStatus === 'active') return;

    if (params.currentStatus === 'archived') {
      throw new ConflictException({
        error: {
          code: 'TOPIC_STATUS_DISALLOWS_WRITE',
          message: 'Topic status disallows write',
        },
      });
    }

    // frozen: only allow SET_STATUS(active)
    if (params.command.type === 'SET_STATUS') {
      const payload = params.command.payload as { status?: string };
      if (payload.status === 'active') return;
    }

    throw new ConflictException({
      error: {
        code: 'TOPIC_STATUS_DISALLOWS_WRITE',
        message: 'Topic status disallows write',
      },
    });
  }

  private toJsonObject(value: Prisma.JsonValue | null): Record<string, unknown> | null {
    if (!value) return null;
    if (typeof value !== 'object') return null;
    if (Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  }

  private isValidHex(str: string, expectedLength: number): boolean {
    if (str.length !== expectedLength) return false;
    return /^[0-9a-f]+$/i.test(str);
  }

  async getLatestConsensusReport(topicId: string): Promise<ConsensusReportLatestResponse> {
    const topic = await this.prisma.topic.findUnique({
      where: { id: topicId },
      select: { id: true },
    });

    if (!topic) {
      throw new NotFoundException({
        error: { code: 'TOPIC_NOT_FOUND', message: 'Topic not found' },
      });
    }

    const latest = await this.prisma.consensusReport.findFirst({
      where: { topicId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        topicId: true,
        status: true,
        contentMd: true,
        model: true,
        promptVersion: true,
        params: true,
        metadata: true,
        computedAt: true,
        createdAt: true,
      },
    });

    if (!latest) {
      return { report: null };
    }

    return { report: this.toConsensusReportDto(latest) };
  }

  private toConsensusReportDto(report: {
    id: string;
    topicId: string;
    status: 'generating' | 'ready' | 'failed';
    contentMd: string | null;
    model: string | null;
    promptVersion: string | null;
    params: Prisma.JsonValue | null;
    metadata: Prisma.JsonValue | null;
    computedAt: Date | null;
    createdAt: Date;
  }): ConsensusReport {
    const base = {
      id: report.id,
      topicId: report.topicId,
      model: report.model,
      promptVersion: report.promptVersion,
      params: this.toJsonObject(report.params),
      metadata: this.toJsonObject(report.metadata),
      createdAt: report.createdAt.toISOString(),
    };

    if (report.status === 'generating') {
      return {
        ...base,
        status: 'generating',
        contentMd: null,
        computedAt: null,
      };
    }

    const computedAt = (report.computedAt ?? report.createdAt).toISOString();

    if (report.status === 'ready') {
      return {
        ...base,
        status: 'ready',
        contentMd: report.contentMd ?? '',
        computedAt,
      };
    }

    return {
      ...base,
      status: 'failed',
      contentMd: null,
      computedAt,
    };
  }

  /**
   * GENERATE_CONSENSUS_REPORT host command (requires owner)
   * @see docs/steps/step22.md
   */
  async generateConsensusReport(topicId: string, pubkeyHex: string): Promise<TopicSummary> {
    const topic = await this.prisma.topic.findUnique({
      where: { id: topicId },
      select: {
        id: true,
        status: true,
        ownerPubkey: true,
      },
    });

    if (!topic) {
      throw new NotFoundException({
        error: { code: 'TOPIC_NOT_FOUND', message: 'Topic not found' },
      });
    }

    this.assertIsTopicOwner(topic, pubkeyHex);
    this.assertTopicStatusAllowsHostCommand({
      currentStatus: topic.status,
      command: { type: 'GENERATE_CONSENSUS_REPORT', payload: {} },
    });

    const reportId = uuidv7();

    await this.prisma.consensusReport.create({
      data: {
        id: reportId,
        topicId,
        status: 'generating',
        contentMd: null,
        model: null,
        promptVersion: null,
        params: Prisma.DbNull,
        metadata: Prisma.DbNull,
        computedAt: null,
      },
    });

    // SSE invalidation so clients can pull latest report (best-effort)
    try {
      await this.topicEvents.publish(topicId, {
        event: 'report_updated',
        data: { topicId, reportId },
      });
    } catch {
      // ignore
    }

    // Fire-and-forget: don't block the response on queue
    this.queue.enqueueConsensusReport({ topicId, reportId, trigger: 'host' }).catch(async (err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[topic] Failed to enqueue consensus-report for topicId=${topicId} reportId=${reportId}:`,
        message,
      );
      // Mark failed so UI doesn't hang on "generating" forever.
      try {
        await this.prisma.consensusReport.update({
          where: { id: reportId },
          data: {
            status: 'failed',
            contentMd: null,
            metadata: {
              error: {
                message,
                timestamp: new Date().toISOString(),
              },
            },
            computedAt: new Date(),
          },
        });

        await this.topicEvents.publish(topicId, {
          event: 'report_updated',
          data: { topicId, reportId },
        });
      } catch {
        // ignore
      }
    });

    const updatedTopic = await this.getTopicById(topicId);
    if (!updatedTopic) {
      throw new NotFoundException({
        error: { code: 'TOPIC_NOT_FOUND', message: 'Topic not found' },
      });
    }
    return updatedTopic;
  }

  /**
   * Create a new topic with root argument
   */
  async createTopic(dto: CreateTopicRequest): Promise<CreateTopicResult> {
    // Validate input
    if (!dto.title || dto.title.trim() === '') {
      throw new BadRequestException({
        error: { code: 'BAD_REQUEST', message: 'title is required and cannot be empty' },
      });
    }
    if (!dto.body || dto.body.trim() === '') {
      throw new BadRequestException({
        error: { code: 'BAD_REQUEST', message: 'body is required and cannot be empty' },
      });
    }

    const topicId = uuidv7();
    const rootArgumentId = uuidv7();
    const claimToken = randomBytes(32).toString('hex');

    // Create topic + root argument in a transaction
    await this.prisma.$transaction(async (tx: TransactionClient) => {
      // 1. Create topic first (without root_argument_id)
      await tx.topic.create({
        data: {
          id: topicId,
          title: dto.title,
          status: 'active',
        },
      });

      // 2. Create root argument
      // For root argument, authorPubkey is empty (no author yet)
      const emptyPubkey = Buffer.alloc(32);
      await tx.argument.create({
        data: {
          id: rootArgumentId,
          topicId,
          parentId: null,
          title: dto.title,
          body: dto.body,
          authorPubkey: emptyPubkey,
          analysisStatus: 'pending_analysis',
          totalVotes: 0,
          totalCost: 0,
        },
      });

      // 3. Update topic with root_argument_id
      await tx.topic.update({
        where: { id: topicId },
        data: { rootArgumentId },
      });
    });

    // Store claim token in Redis with TTL
    await this.redis.setClaimToken(topicId, claimToken, this.CLAIM_TOKEN_TTL_SECONDS);

    const expiresAt = new Date(Date.now() + this.CLAIM_TOKEN_TTL_SECONDS * 1000).toISOString();

    return {
      topicId,
      rootArgumentId,
      claimToken,
      expiresAt,
    };
  }

  /**
   * List topics with cursor pagination
   */
  async listTopics(params: ListTopicsParams): Promise<ListTopicsResult> {
    let limit = params.limit ?? this.DEFAULT_LIMIT;
    // Clamp to MAX_LIMIT
    if (limit > this.MAX_LIMIT) {
      limit = this.MAX_LIMIT;
    }
    if (limit < 1) {
      limit = 1;
    }

    // Build query
    const whereClause: Record<string, unknown> = {};

    if (params.beforeId) {
      // UUID v7 is time-ordered, so we can use < for cursor pagination
      // Get the createdAt of beforeId topic
      const beforeTopic = await this.prisma.topic.findUnique({
        where: { id: params.beforeId },
        select: { createdAt: true },
      });

      if (beforeTopic) {
        whereClause.createdAt = { lt: beforeTopic.createdAt };
      }
    }

    // Query one extra to determine nextBeforeId
    const topics = await this.prisma.topic.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      select: {
        id: true,
        title: true,
        rootArgumentId: true,
        status: true,
        ownerPubkey: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const hasMore = topics.length > limit;
    const items = hasMore ? topics.slice(0, limit) : topics;
    const nextBeforeId = hasMore && items.length > 0 ? items[items.length - 1].id : null;

    return {
      items: items.map((t) => ({
        id: t.id,
        title: t.title,
        rootArgumentId: t.rootArgumentId || '',
        status: t.status,
        ownerPubkey: t.ownerPubkey ? Buffer.from(t.ownerPubkey).toString('hex') : null,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      })),
      nextBeforeId,
    };
  }

  /**
   * Get topic by ID
   */
  async getTopicById(topicId: string): Promise<TopicSummary | null> {
    const topic = await this.prisma.topic.findUnique({
      where: { id: topicId },
      select: {
        id: true,
        title: true,
        rootArgumentId: true,
        status: true,
        ownerPubkey: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!topic) {
      return null;
    }

    return {
      id: topic.id,
      title: topic.title,
      rootArgumentId: topic.rootArgumentId || '',
      status: topic.status,
      ownerPubkey: topic.ownerPubkey ? Buffer.from(topic.ownerPubkey).toString('hex') : null,
      createdAt: topic.createdAt.toISOString(),
      updatedAt: topic.updatedAt.toISOString(),
    };
  }

  /**
   * Claim topic ownership
   */
  async claimOwner(topicId: string, claimToken: string, pubkey: string): Promise<TopicSummary> {
    // Validate and consume token
    const tokenResult = await this.redis.consumeClaimToken(topicId, claimToken);

    if (tokenResult === 'expired') {
      throw new BadRequestException({
        error: { code: 'CLAIM_TOKEN_EXPIRED', message: 'Claim token has expired' },
      });
    }

    if (tokenResult === 'invalid') {
      throw new BadRequestException({
        error: { code: 'CLAIM_TOKEN_INVALID', message: 'Invalid claim token' },
      });
    }

    // Check if topic exists
    const topic = await this.prisma.topic.findUnique({
      where: { id: topicId },
    });

    if (!topic) {
      throw new NotFoundException({
        error: { code: 'TOPIC_NOT_FOUND', message: 'Topic not found' },
      });
    }

    // Check if already claimed
    if (topic.ownerPubkey) {
      throw new BadRequestException({
        error: { code: 'CLAIM_TOKEN_INVALID', message: 'Topic already has an owner' },
      });
    }

    // Update topic with owner
    const pubkeyBytes = Buffer.from(pubkey, 'hex');
    const updated = await this.prisma.topic.update({
      where: { id: topicId },
      data: { ownerPubkey: pubkeyBytes },
      select: {
        id: true,
        title: true,
        rootArgumentId: true,
        status: true,
        ownerPubkey: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return {
      id: updated.id,
      title: updated.title,
      rootArgumentId: updated.rootArgumentId || '',
      status: updated.status,
      ownerPubkey: updated.ownerPubkey ? Buffer.from(updated.ownerPubkey).toString('hex') : null,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  /**
   * SET_STATUS host command (requires owner)
   * @see docs/api-contract.md#3.2
   */
  async setStatus(topicId: string, status: 'active' | 'frozen' | 'archived', pubkeyHex: string): Promise<TopicSummary> {
    const topic = await this.prisma.topic.findUnique({
      where: { id: topicId },
      select: {
        id: true,
        title: true,
        rootArgumentId: true,
        status: true,
        ownerPubkey: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!topic) {
      throw new NotFoundException({
        error: { code: 'TOPIC_NOT_FOUND', message: 'Topic not found' },
      });
    }

    this.assertIsTopicOwner(topic, pubkeyHex);
    this.assertTopicStatusAllowsHostCommand({
      currentStatus: topic.status,
      command: { type: 'SET_STATUS', payload: { status } },
    });

    const updated = await this.prisma.topic.update({
      where: { id: topicId },
      data: { status },
      select: {
        id: true,
        title: true,
        rootArgumentId: true,
        status: true,
        ownerPubkey: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // SSE invalidation (best-effort)
    try {
      await this.topicEvents.publish(topicId, {
        event: 'topic_updated',
        data: { topicId, reason: 'status_changed' },
      });
    } catch {
      // ignore
    }

    return {
      id: updated.id,
      title: updated.title,
      rootArgumentId: updated.rootArgumentId || '',
      status: updated.status,
      ownerPubkey: updated.ownerPubkey ? Buffer.from(updated.ownerPubkey).toString('hex') : null,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  /**
   * EDIT_ROOT host command (requires owner)
   * @see docs/api-contract.md#3.2
   */
  async editRoot(
    topicId: string,
    input: { title: string; body: string },
    pubkeyHex: string,
  ): Promise<TopicSummary> {
    const topic = await this.prisma.topic.findUnique({
      where: { id: topicId },
      select: {
        id: true,
        rootArgumentId: true,
        status: true,
        ownerPubkey: true,
      },
    });

    if (!topic) {
      throw new NotFoundException({
        error: { code: 'TOPIC_NOT_FOUND', message: 'Topic not found' },
      });
    }

    if (!topic.rootArgumentId) {
      throw new NotFoundException({
        error: { code: 'TOPIC_NOT_FOUND', message: 'Topic not found' },
      });
    }

    this.assertIsTopicOwner(topic, pubkeyHex);
    this.assertTopicStatusAllowsHostCommand({
      currentStatus: topic.status,
      command: { type: 'EDIT_ROOT', payload: input },
    });

    const updatedTopic = await this.prisma.$transaction(async (tx: TransactionClient) => {
      await tx.argument.update({
        where: { topicId_id: { topicId, id: topic.rootArgumentId as string } },
        data: {
          title: input.title,
          body: input.body,
        },
      });

      return tx.topic.update({
        where: { id: topicId },
        data: { title: input.title },
        select: {
          id: true,
          title: true,
          rootArgumentId: true,
          status: true,
          ownerPubkey: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    });

    // SSE invalidation (best-effort)
    try {
      await this.topicEvents.publish(topicId, {
        event: 'topic_updated',
        data: { topicId, reason: 'root_edited' },
      });
    } catch {
      // ignore
    }

    return {
      id: updatedTopic.id,
      title: updatedTopic.title,
      rootArgumentId: updatedTopic.rootArgumentId || '',
      status: updatedTopic.status,
      ownerPubkey: updatedTopic.ownerPubkey ? Buffer.from(updatedTopic.ownerPubkey).toString('hex') : null,
      createdAt: updatedTopic.createdAt.toISOString(),
      updatedAt: updatedTopic.updatedAt.toISOString(),
    };
  }

  /**
   * PRUNE_ARGUMENT host command (requires owner)
   * @see docs/api-contract.md#3.2
   */
  async pruneArgument(
    topicId: string,
    input: { argumentId: string; reason: string | null },
    pubkeyHex: string,
  ): Promise<TopicSummary> {
    const pubkeyBytes = Buffer.from(pubkeyHex, 'hex');

    const topic = await this.prisma.topic.findUnique({
      where: { id: topicId },
      select: {
        id: true,
        rootArgumentId: true,
        status: true,
        ownerPubkey: true,
      },
    });

    if (!topic) {
      throw new NotFoundException({
        error: { code: 'TOPIC_NOT_FOUND', message: 'Topic not found' },
      });
    }

    this.assertIsTopicOwner(topic, pubkeyHex);
    this.assertTopicStatusAllowsHostCommand({
      currentStatus: topic.status,
      command: { type: 'PRUNE_ARGUMENT', payload: input },
    });

    if (topic.rootArgumentId && input.argumentId === topic.rootArgumentId) {
      throw new BadRequestException({
        error: { code: 'BAD_REQUEST', message: 'Cannot prune root argument' },
      });
    }

    await this.prisma.argument.update({
      where: { topicId_id: { topicId, id: input.argumentId } },
      data: {
        prunedAt: new Date(),
        pruneReason: input.reason,
        prunedByPubkey: pubkeyBytes,
      },
    }).catch(() => {
      throw new NotFoundException({
        error: { code: 'ARGUMENT_NOT_FOUND', message: 'Argument not found' },
      });
    });

    // SSE invalidation (best-effort)
    try {
      await this.topicEvents.publish(topicId, {
        event: 'argument_updated',
        data: { argumentId: input.argumentId, reason: 'pruned' },
      });
    } catch {
      // ignore
    }

    const updatedTopic = await this.getTopicById(topicId);
    if (!updatedTopic) {
      throw new NotFoundException({
        error: { code: 'TOPIC_NOT_FOUND', message: 'Topic not found' },
      });
    }
    return updatedTopic;
  }

  /**
   * UNPRUNE_ARGUMENT host command (requires owner)
   * @see docs/api-contract.md#3.2
   */
  async unpruneArgument(topicId: string, input: { argumentId: string }, pubkeyHex: string): Promise<TopicSummary> {
    const topic = await this.prisma.topic.findUnique({
      where: { id: topicId },
      select: {
        id: true,
        status: true,
        ownerPubkey: true,
      },
    });

    if (!topic) {
      throw new NotFoundException({
        error: { code: 'TOPIC_NOT_FOUND', message: 'Topic not found' },
      });
    }

    this.assertIsTopicOwner(topic, pubkeyHex);
    this.assertTopicStatusAllowsHostCommand({
      currentStatus: topic.status,
      command: { type: 'UNPRUNE_ARGUMENT', payload: input },
    });

    await this.prisma.argument.update({
      where: { topicId_id: { topicId, id: input.argumentId } },
      data: {
        prunedAt: null,
        pruneReason: null,
        prunedByPubkey: null,
      },
    }).catch(() => {
      throw new NotFoundException({
        error: { code: 'ARGUMENT_NOT_FOUND', message: 'Argument not found' },
      });
    });

    // Optional invalidation: use the same 'pruned' reason for pruning-state changes.
    try {
      await this.topicEvents.publish(topicId, {
        event: 'argument_updated',
        data: { argumentId: input.argumentId, reason: 'pruned' },
      });
    } catch {
      // ignore
    }

    const updatedTopic = await this.getTopicById(topicId);
    if (!updatedTopic) {
      throw new NotFoundException({
        error: { code: 'TOPIC_NOT_FOUND', message: 'Topic not found' },
      });
    }
    return updatedTopic;
  }

  /**
   * BLACKLIST_PUBKEY host command (requires owner)
   * Step 23 - Topic-local pubkey blacklist (no cross-topic linkage).
   */
  async blacklistPubkey(
    topicId: string,
    input: { pubkey: string; reason?: string | null },
    ownerPubkeyHex: string,
  ): Promise<TopicSummary> {
    const topic = await this.prisma.topic.findUnique({
      where: { id: topicId },
      select: {
        id: true,
        status: true,
        ownerPubkey: true,
      },
    });

    if (!topic) {
      throw new NotFoundException({
        error: { code: 'TOPIC_NOT_FOUND', message: 'Topic not found' },
      });
    }

    this.assertIsTopicOwner(topic, ownerPubkeyHex);
    this.assertTopicStatusAllowsHostCommand({
      currentStatus: topic.status,
      command: { type: 'BLACKLIST_PUBKEY', payload: input },
    });

    const targetPubkeyHex = input.pubkey.toLowerCase();
    if (!this.isValidHex(targetPubkeyHex, 64)) {
      throw new BadRequestException({
        error: { code: 'BAD_REQUEST', message: 'Invalid pubkey format' },
      });
    }

    const ownerHex = topic.ownerPubkey ? Buffer.from(topic.ownerPubkey).toString('hex') : null;
    if (ownerHex && ownerHex === targetPubkeyHex) {
      throw new BadRequestException({
        error: { code: 'BAD_REQUEST', message: 'Cannot blacklist topic owner' },
      });
    }

    const pubkeyBytes = Buffer.from(targetPubkeyHex, 'hex');

    try {
      await this.prisma.topicPubkeyBlacklist.create({
        data: {
          topicId,
          pubkey: pubkeyBytes,
          reason: input.reason ?? null,
        },
      });
    } catch (err) {
      // Already blacklisted -> idempotent success
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // ignore
      } else {
        throw err;
      }
    }

    const updatedTopic = await this.getTopicById(topicId);
    if (!updatedTopic) {
      throw new NotFoundException({
        error: { code: 'TOPIC_NOT_FOUND', message: 'Topic not found' },
      });
    }
    return updatedTopic;
  }

  /**
   * UNBLACKLIST_PUBKEY host command (requires owner)
   * Step 23 - Topic-local pubkey blacklist removal.
   */
  async unblacklistPubkey(
    topicId: string,
    input: { pubkey: string },
    ownerPubkeyHex: string,
  ): Promise<TopicSummary> {
    const topic = await this.prisma.topic.findUnique({
      where: { id: topicId },
      select: {
        id: true,
        status: true,
        ownerPubkey: true,
      },
    });

    if (!topic) {
      throw new NotFoundException({
        error: { code: 'TOPIC_NOT_FOUND', message: 'Topic not found' },
      });
    }

    this.assertIsTopicOwner(topic, ownerPubkeyHex);
    this.assertTopicStatusAllowsHostCommand({
      currentStatus: topic.status,
      command: { type: 'UNBLACKLIST_PUBKEY', payload: input },
    });

    const targetPubkeyHex = input.pubkey.toLowerCase();
    if (!this.isValidHex(targetPubkeyHex, 64)) {
      throw new BadRequestException({
        error: { code: 'BAD_REQUEST', message: 'Invalid pubkey format' },
      });
    }

    const pubkeyBytes = Buffer.from(targetPubkeyHex, 'hex');

    try {
      await this.prisma.topicPubkeyBlacklist.delete({
        where: { topicId_pubkey: { topicId, pubkey: pubkeyBytes } },
      });
    } catch (err) {
      // Not found -> idempotent success
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        // ignore
      } else {
        throw err;
      }
    }

    const updatedTopic = await this.getTopicById(topicId);
    if (!updatedTopic) {
      throw new NotFoundException({
        error: { code: 'TOPIC_NOT_FOUND', message: 'Topic not found' },
      });
    }
    return updatedTopic;
  }

  /**
   * Get ledger for a user in a topic (auto-initializes if not exists)
   * @see docs/api-contract.md#3.8
   */
  async getLedgerMe(topicId: string, pubkeyHex: string): Promise<LedgerMe> {
    // Check if topic exists
    const topic = await this.prisma.topic.findUnique({
      where: { id: topicId },
      select: { id: true },
    });

    if (!topic) {
      throw new NotFoundException({
        error: { code: 'TOPIC_NOT_FOUND', message: 'Topic not found' },
      });
    }

    const pubkeyBytes = Buffer.from(pubkeyHex, 'hex');

    // Try to find existing ledger, or return default values
    const ledger = await this.prisma.ledger.findUnique({
      where: { topicId_pubkey: { topicId, pubkey: pubkeyBytes } },
      select: {
        topicId: true,
        pubkey: true,
        balance: true,
        totalVotesStaked: true,
        totalCostStaked: true,
        lastInteractionAt: true,
      },
    });

    if (ledger) {
      return {
        topicId: ledger.topicId,
        pubkey: Buffer.from(ledger.pubkey).toString('hex'),
        balance: ledger.balance,
        myTotalVotes: ledger.totalVotesStaked,
        myTotalCost: ledger.totalCostStaked,
        lastInteractionAt: ledger.lastInteractionAt?.toISOString() ?? null,
      };
    }

    // Return default ledger values (no actual row created until first interaction)
    return {
      topicId,
      pubkey: pubkeyHex,
      balance: 100,
      myTotalVotes: 0,
      myTotalCost: 0,
      lastInteractionAt: null,
    };
  }

  /**
   * Get all stakes for a user in a topic (includes pruned arguments)
   * @see docs/api-contract.md#3.9
   */
  async getStakesMe(topicId: string, pubkeyHex: string): Promise<StakesMeResponse> {
    // Check if topic exists
    const topic = await this.prisma.topic.findUnique({
      where: { id: topicId },
      select: { id: true },
    });

    if (!topic) {
      throw new NotFoundException({
        error: { code: 'TOPIC_NOT_FOUND', message: 'Topic not found' },
      });
    }

    const pubkeyBytes = Buffer.from(pubkeyHex, 'hex');

    // Get all stakes with argument info (including pruned)
    const stakes = await this.prisma.stake.findMany({
      where: {
        topicId,
        voterPubkey: pubkeyBytes,
      },
      include: {
        argument: {
          select: {
            id: true,
            title: true,
            body: true,
            prunedAt: true,
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const items: StakeMeItem[] = stakes.map((stake) => {
      // Generate excerpt from body (first 100 chars)
      const excerptLength = 100;
      const argumentExcerpt = stake.argument.body.length > excerptLength
        ? stake.argument.body.slice(0, excerptLength) + '...'
        : stake.argument.body;

      return {
        argumentId: stake.argumentId,
        votes: stake.votes,
        cost: stake.cost,
        argumentPrunedAt: stake.argument.prunedAt?.toISOString() ?? null,
        updatedAt: stake.updatedAt.toISOString(),
        argumentTitle: stake.argument.title,
        argumentExcerpt,
      };
    });

    return {
      topicId,
      pubkey: pubkeyHex,
      items,
    };
  }

  /**
   * Get cluster map data for God View (public read)
   * @see docs/api-contract.md#3.11
   */
  async getClusterMap(topicId: string): Promise<ClusterMap> {
    const topic = await this.prisma.topic.findUnique({
      where: { id: topicId },
      select: {
        id: true,
        createdAt: true,
        lastClusteredAt: true,
      },
    });

    if (!topic) {
      throw new NotFoundException({
        error: { code: 'TOPIC_NOT_FOUND', message: 'Topic not found' },
      });
    }

    const [clusterRows, campRows] = await Promise.all([
      this.prisma.clusterData.findMany({
        where: { topicId, argument: { prunedAt: null } },
        select: {
          argumentId: true,
          clusterId: true,
          umapX: true,
          umapY: true,
          argument: {
            select: {
              totalVotes: true,
              stanceScore: true,
              analysisStatus: true,
            },
          },
        },
      }),
      this.prisma.camp.findMany({
        where: { topicId },
        select: { clusterId: true, label: true, summary: true },
      }),
    ]);

    const computedAt = topic.lastClusteredAt ?? topic.createdAt;
    const modelVersion = getClusterMapModelVersion(topic.lastClusteredAt);

    return buildClusterMapResponse({
      topicId,
      computedAt,
      modelVersion,
      points: clusterRows.map((row) => ({
        argumentId: row.argumentId,
        umapX: row.umapX,
        umapY: row.umapY,
        clusterId: row.clusterId,
        totalVotes: row.argument.totalVotes,
        stanceScore: row.argument.stanceScore,
        analysisStatus: row.argument.analysisStatus,
      })),
      camps: campRows.map((c) => ({
        clusterId: c.clusterId,
        label: c.label,
        summary: c.summary,
      })),
    });
  }
}
