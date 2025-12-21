/**
 * @file topic.service.ts
 * @description Topic business logic service
 */
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../infrastructure/prisma.module.js';
import { RedisService } from '../infrastructure/redis.module.js';
import type { CreateTopicRequest, TopicSummary, LedgerMe, StakesMeResponse, StakeMeItem } from '@epiphany/shared-contracts';

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
  ) {}

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
}
