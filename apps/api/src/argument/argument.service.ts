/**
 * @file argument.service.ts
 * @description Argument write path orchestration (Step 09)
 */
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { createHash } from 'node:crypto';
import type { CreateArgumentRequest } from '@epiphany/shared-contracts';
import { validateSetVotes, INITIAL_BALANCE } from '@epiphany/core-logic';
import { PrismaService } from '../infrastructure/prisma.module.js';

export interface CreateArgumentParams {
  topicId: string;
  dto: CreateArgumentRequest & { initialVotes: number };
  pubkeyHex: string;
}

@Injectable()
export class ArgumentService {
  constructor(private readonly prisma: PrismaService) {}

  async createArgument(params: CreateArgumentParams) {
    const { topicId, dto, pubkeyHex } = params;
    const pubkeyBytes = Buffer.from(pubkeyHex, 'hex');
    const argumentId = uuidv7();

    const { parentId, title, body } = dto;
    const initialVotes = dto.initialVotes ?? 0;

    const topic = await this.prisma.topic.findUnique({
      where: { id: topicId },
      select: { id: true, status: true },
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

    return {
      argument: this.toArgumentDto(result.argument),
      ledger: this.toLedgerDto(result.ledger),
    };
  }

  private toArgumentDto(arg: {
    id: string;
    topicId: string;
    parentId: string | null;
    title: string | null;
    body: string;
    authorPubkey: Buffer;
    analysisStatus: string;
    stanceScore: number | null;
    totalVotes: number;
    totalCost: number;
    prunedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
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
      authorId,
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
