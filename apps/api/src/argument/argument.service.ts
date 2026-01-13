/**
 * @file argument.service.ts
 * @description Argument write path orchestration (Step 09, Step 18)
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { CreateArgumentRequest, EditArgumentRequest } from '@epiphany/shared-contracts';
import { validateSetVotes, INITIAL_BALANCE } from '@epiphany/core-logic';
import { PrismaService } from '../infrastructure/prisma.module.js';
import { QueueService } from '../infrastructure/queue.module.js';
import { TopicEventsPublisher } from '../sse/topic-events.publisher.js';
import { TranslationService } from '../translation/translation.service.js';
import type { Locale } from '../common/locale.js';

export interface CreateArgumentParams {
  topicId: string;
  dto: CreateArgumentRequest & { initialVotes: number };
  pubkeyHex: string;
  accessKeyHex?: string;
}

export interface EditArgumentParams {
  argumentId: string;
  dto: EditArgumentRequest;
  pubkeyHex: string;
}

@Injectable()
export class ArgumentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
    private readonly topicEvents: TopicEventsPublisher,
    private readonly translations: TranslationService,
  ) {}

  private async getAuthorDisplayName(
    topicId: string,
    authorPubkey: Uint8Array,
    locale: Locale,
  ): Promise<string | null> {
    const profile = await this.prisma.topicIdentityProfile.findUnique({
      where: { topicId_pubkey: { topicId, pubkey: Buffer.from(authorPubkey) } },
      select: { displayName: true },
    });

    const displayName = profile?.displayName ?? null;
    if (!displayName) return null;

    const pubkeyHex = Buffer.from(authorPubkey).toString('hex');
    const overrides = await this.translations.getDisplayNameOverrides({
      items: [{ topicId, pubkeyHex, displayName }],
      targetLocale: locale,
    });

    return overrides.get(`${topicId}:${pubkeyHex}`) ?? displayName;
  }

  private normalizeAccessKeyHex(value: string | undefined): string | null {
    const normalized = value?.trim().toLowerCase() ?? null;
    if (!normalized) return null;
    if (!/^[0-9a-f]{64}$/.test(normalized)) return null;
    return normalized;
  }

  private verifyAccessKey(accessKeyHex: string, expectedHash: Uint8Array | null): boolean {
    if (!expectedHash) return false;
    const digest = createHash('sha256').update(Buffer.from(accessKeyHex, 'hex')).digest();
    const expected = Buffer.from(expectedHash);
    if (expected.length !== digest.length) return false;
    return timingSafeEqual(expected, digest);
  }

  async getArgument(argumentId: string, locale: Locale) {
    const argument = await this.prisma.argument.findFirst({
      where: { id: argumentId, prunedAt: null },
      select: {
        id: true,
        topicId: true,
        parentId: true,
        title: true,
        body: true,
        bodyRich: true,
        authorPubkey: true,
        analysisStatus: true,
        stanceScore: true,
        totalVotes: true,
        totalCost: true,
        prunedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!argument) {
      throw new NotFoundException({
        error: { code: 'ARGUMENT_NOT_FOUND', message: 'Argument not found' },
      });
    }

    const argumentOverrides = await this.translations.getArgumentOverrides({
      items: [{ id: argument.id, title: argument.title, body: argument.body }],
      targetLocale: locale,
    });
    const override = argumentOverrides.get(argument.id);

    const localizedTitle = override?.title ?? argument.title;
    const localizedBody = override?.body ?? argument.body;
    const localizedBodyRich = localizedBody !== argument.body ? null : argument.bodyRich;

    const authorDisplayName = await this.getAuthorDisplayName(argument.topicId, argument.authorPubkey, locale);
    return {
      argument: this.toArgumentDto(
        { ...argument, title: localizedTitle, body: localizedBody, bodyRich: localizedBodyRich },
        authorDisplayName,
      ),
    };
  }

  async createArgument(params: CreateArgumentParams & { locale: Locale }) {
    const { topicId, dto, pubkeyHex } = params;
    const pubkeyBytes = Buffer.from(pubkeyHex, 'hex');
    const argumentId = uuidv7();

    const { parentId, title, body, bodyRich } = dto;
    const initialVotes = dto.initialVotes ?? 0;

    const topic = await this.prisma.topic.findUnique({
      where: { id: topicId },
      select: {
        id: true,
        status: true,
        visibility: true,
        accessKeyHash: true,
        ownerPubkey: true,
      },
    });

    if (!topic) {
      throw new NotFoundException({
        error: { code: 'TOPIC_NOT_FOUND', message: 'Topic not found' },
      });
    }

    if (topic.status !== 'active') {
      throw new ConflictException({
        error: {
          code: 'TOPIC_STATUS_DISALLOWS_WRITE',
          message: 'Topic status disallows write',
        },
      });
    }

    if (topic.visibility === 'private') {
      const ownerHex = topic.ownerPubkey ? Buffer.from(topic.ownerPubkey).toString('hex') : null;
      const isOwner = ownerHex !== null && ownerHex === pubkeyHex;

      if (!isOwner) {
        const existingLedger = await this.prisma.ledger.findUnique({
          where: { topicId_pubkey: { topicId, pubkey: pubkeyBytes } },
          select: { topicId: true },
        });

        const accessKeyHex = this.normalizeAccessKeyHex(params.accessKeyHex);
        const accessKeyOk = accessKeyHex ? this.verifyAccessKey(accessKeyHex, topic.accessKeyHash) : false;

        if (!existingLedger && !accessKeyOk) {
          // Hide existence for private topics.
          throw new NotFoundException({
            error: { code: 'TOPIC_NOT_FOUND', message: 'Topic not found' },
          });
        }
      }
    }

    const parent = await this.prisma.argument.findUnique({
      where: { topicId_id: { topicId, id: parentId } },
      select: { id: true },
    });

    if (!parent) {
      throw new NotFoundException({
        error: { code: 'ARGUMENT_NOT_FOUND', message: 'Parent argument not found' },
      });
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const ledger = await tx.ledger.upsert({
        where: { topicId_pubkey: { topicId, pubkey: pubkeyBytes } },
        update: {},
        create: {
          topicId,
          pubkey: pubkeyBytes,
          balance: INITIAL_BALANCE,
          totalVotesStaked: 0,
          totalCostStaked: 0,
          lastInteractionAt: null,
        },
      });

      const createdArgument = await tx.argument.create({
        data: {
          id: argumentId,
          topicId,
          parentId,
          title: title ?? null,
          body,
          bodyRich: (bodyRich ?? null) as any,
          authorPubkey: pubkeyBytes,
          analysisStatus: 'pending_analysis',
          stanceScore: null,
          totalVotes: 0,
          totalCost: 0,
        },
      });

      let updatedLedger = ledger;
      let updatedArgument = createdArgument;

      if (initialVotes > 0) {
        const validation = validateSetVotes({
          currentVotes: 0,
          targetVotes: initialVotes,
          balance: ledger.balance,
        });

        if (!validation.ok) {
          if (validation.errorCode === 'INSUFFICIENT_BALANCE') {
            throw new HttpException(
              { error: { code: 'INSUFFICIENT_BALANCE', message: validation.message } },
              HttpStatus.PAYMENT_REQUIRED,
            );
          }

          throw new BadRequestException({
            error: { code: 'BAD_REQUEST', message: validation.message },
          });
        }

        const delta = validation.delta;

        const updatedCount = await tx.ledger.updateMany({
          where: {
            topicId,
            pubkey: pubkeyBytes,
            balance: { gte: delta.deltaCost },
          },
          data: {
            balance: { decrement: delta.deltaCost },
            totalVotesStaked: { increment: delta.deltaVotes },
            totalCostStaked: { increment: delta.deltaCost },
            lastInteractionAt: new Date(),
          },
        });

        if (updatedCount.count !== 1) {
          throw new HttpException(
            { error: { code: 'INSUFFICIENT_BALANCE', message: 'Insufficient balance' } },
            HttpStatus.PAYMENT_REQUIRED,
          );
        }

        await tx.stake.create({
          data: {
            topicId,
            argumentId,
            voterPubkey: pubkeyBytes,
            votes: initialVotes,
            cost: delta.targetCost,
          },
        });

        updatedArgument = await tx.argument.update({
          where: { topicId_id: { topicId, id: argumentId } },
          data: {
            totalVotes: { increment: delta.deltaVotes },
            totalCost: { increment: delta.deltaCost },
          },
        });

        updatedLedger = await tx.ledger.findUniqueOrThrow({
          where: { topicId_pubkey: { topicId, pubkey: pubkeyBytes } },
        });
      }

      return { argument: updatedArgument, ledger: updatedLedger };
    });

    // Enqueue for AI analysis (Step 18)
    // Fire-and-forget: don't block the response on queue
    this.queueService.enqueueArgumentAnalysis(argumentId).catch((err) => {
      console.error(`[argument] Failed to enqueue analysis for ${argumentId}:`, err);
    });

    // Fire-and-forget: pre-translate argument content to the other locale.
    this.translations
      .requestArgumentTranslation({
        argumentId,
        title: result.argument.title ?? null,
        body: result.argument.body,
      })
      .catch((err) => {
        console.warn(`[argument] Failed to request translation for ${argumentId}:`, err);
      });

    return {
      argument: this.toArgumentDto(
        result.argument,
        await this.getAuthorDisplayName(result.argument.topicId, result.argument.authorPubkey, params.locale),
      ),
      ledger: this.toLedgerDto(result.ledger),
    };
  }

  async editArgument(params: EditArgumentParams & { locale: Locale }) {
    const { argumentId, dto, pubkeyHex } = params;
    const pubkeyBytes = Buffer.from(pubkeyHex, 'hex');

    const body = dto.body.trim();
    if (!body) {
      throw new BadRequestException({
        error: { code: 'BAD_REQUEST', message: 'body is required and cannot be empty' },
      });
    }

    const argument = await this.prisma.argument.findUnique({
      where: { id: argumentId },
      select: {
        id: true,
        topicId: true,
        parentId: true,
        prunedAt: true,
        authorPubkey: true,
        topic: { select: { status: true } },
      },
    });

    if (!argument || argument.prunedAt) {
      throw new NotFoundException({
        error: { code: 'ARGUMENT_NOT_FOUND', message: 'Argument not found' },
      });
    }

    // Root argument is edited via host TopicCommand EDIT_ROOT (has no author).
    if (argument.parentId === null) {
      throw new BadRequestException({
        error: { code: 'BAD_REQUEST', message: 'Root argument must be edited via topic commands' },
      });
    }

    if (argument.topic.status !== 'active') {
      throw new ConflictException({
        error: { code: 'TOPIC_STATUS_DISALLOWS_WRITE', message: 'Topic status disallows write' },
      });
    }

    if (!Buffer.from(argument.authorPubkey).equals(pubkeyBytes)) {
      throw new ForbiddenException({
        error: { code: 'NOT_ARGUMENT_AUTHOR', message: 'Only the author can edit this argument' },
      });
    }

    const updateData: Record<string, unknown> = {
      body,
      analysisStatus: 'pending_analysis',
      stanceScore: null,
      embeddingModel: null,
    };

    if (dto.title !== undefined) {
      updateData.title = dto.title;
    }

    if (dto.bodyRich !== undefined) {
      updateData.bodyRich = (dto.bodyRich ?? null) as any;
    }

    const updated = await this.prisma.argument.update({
      where: { topicId_id: { topicId: argument.topicId, id: argumentId } },
      data: updateData as any,
      select: {
        id: true,
        topicId: true,
        parentId: true,
        title: true,
        body: true,
        bodyRich: true,
        authorPubkey: true,
        analysisStatus: true,
        stanceScore: true,
        totalVotes: true,
        totalCost: true,
        prunedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Re-enqueue AI analysis for updated content (fire-and-forget)
    this.queueService.enqueueArgumentAnalysis(argumentId).catch((err) => {
      console.error(`[argument] Failed to enqueue analysis for edit ${argumentId}:`, err);
    });

    // Fire-and-forget: refresh translation for updated content.
    this.translations
      .requestArgumentTranslation({ argumentId, title: updated.title ?? null, body: updated.body })
      .catch((err) => {
        console.warn(`[argument] Failed to request translation for edit ${argumentId}:`, err);
      });

    // Best-effort SSE invalidation
    this.topicEvents
      .publish(argument.topicId, {
        event: 'argument_updated',
        data: { argumentId, reason: 'edited' },
      })
      .catch(() => undefined);

    return {
      argument: this.toArgumentDto(
        updated,
        await this.getAuthorDisplayName(updated.topicId, updated.authorPubkey, params.locale),
      ),
    };
  }

  private toArgumentDto(arg: {
    id: string;
    topicId: string;
    parentId: string | null;
    title: string | null;
    body: string;
    bodyRich: unknown | null;
    authorPubkey: Uint8Array;
    analysisStatus: string;
    stanceScore: number | null;
    totalVotes: number;
    totalCost: number;
    prunedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }, authorDisplayName: string | null) {
    const authorId = createHash('sha256')
      .update(arg.authorPubkey)
      .digest('hex')
      .slice(0, 16);

    return {
      id: arg.id,
      topicId: arg.topicId,
      parentId: arg.parentId,
      title: arg.title,
      body: arg.body,
      bodyRich: arg.bodyRich ?? null,
      authorId,
      authorDisplayName,
      analysisStatus: arg.analysisStatus as 'pending_analysis' | 'ready' | 'failed',
      stanceScore: arg.stanceScore,
      totalVotes: arg.totalVotes,
      totalCost: arg.totalCost,
      prunedAt: arg.prunedAt ? arg.prunedAt.toISOString() : null,
      createdAt: arg.createdAt.toISOString(),
      updatedAt: arg.updatedAt.toISOString(),
    };
  }

  private toLedgerDto(ledger: {
    topicId: string;
    pubkey: Uint8Array;
    balance: number;
    totalVotesStaked: number;
    totalCostStaked: number;
    lastInteractionAt: Date | null;
  }) {
    return {
      topicId: ledger.topicId,
      pubkey: Buffer.from(ledger.pubkey).toString('hex'),
      balance: ledger.balance,
      myTotalVotes: ledger.totalVotesStaked,
      myTotalCost: ledger.totalCostStaked,
      lastInteractionAt: ledger.lastInteractionAt
        ? ledger.lastInteractionAt.toISOString()
        : null,
    };
  }
}
