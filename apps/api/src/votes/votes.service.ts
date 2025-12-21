/**
 * @file votes.service.ts
 * @description QV setVotes write path (transaction + invariants + strong idempotency)
 */
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { validateSetVotes } from '@epiphany/core-logic';
import { zSetVotesResponse, type SetVotesResponse, type LedgerMe } from '@epiphany/shared-contracts';
import { PrismaService } from '../infrastructure/prisma.module.js';
import { RedisService } from '../infrastructure/redis.module.js';
import { TopicEventsPublisher } from '../sse/topic-events.publisher.js';

const IDEMPOTENCY_TTL_SECONDS = 300; // 5 minutes

@Injectable()
export class VotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly topicEvents: TopicEventsPublisher,
  ) {}

  private getIdempotencyKey(pubkey: string, nonce: string): string {
    return `idemp:setVotes:${pubkey}:${nonce}`;
  }

  private toLedgerMe(ledger: {
    topicId: string;
    pubkey: Uint8Array;
    balance: number;
    totalVotesStaked: number;
    totalCostStaked: number;
    lastInteractionAt: Date | null;
  }): LedgerMe {
    return {
      topicId: ledger.topicId,
      pubkey: Buffer.from(ledger.pubkey).toString('hex'),
      balance: ledger.balance,
      myTotalVotes: ledger.totalVotesStaked,
      myTotalCost: ledger.totalCostStaked,
      lastInteractionAt: ledger.lastInteractionAt ? ledger.lastInteractionAt.toISOString() : null,
    };
  }

  async setVotes(params: {
    argumentId: string;
    targetVotes: number;
    pubkey: string;
    nonce: string;
    nonceReplay: boolean;
  }): Promise<SetVotesResponse> {
    const idempotencyKey = this.getIdempotencyKey(params.pubkey, params.nonce);

    // Idempotency read: return cached success response regardless of request body/argumentId
    const cached = await this.redis.get(idempotencyKey);
    if (cached) {
      try {
        const parsed = zSetVotesResponse.safeParse(JSON.parse(cached));
        if (parsed.success) return parsed.data;
      } catch {
        // fall through to recompute; cache will be overwritten on next success
      }
    }

    // If nonce is a replay but we have no cached response, treat it as a true replay attack
    if (params.nonceReplay) {
      throw new ConflictException({
        error: { code: 'NONCE_REPLAY', message: 'Nonce already used' },
      });
    }

    const pubkeyBytes = Buffer.from(params.pubkey, 'hex');

    const result = await this.prisma.$transaction(async (tx) => {
      // Lock argument + topic
      const rows = await tx.$queryRaw<
        Array<{
          argumentId: string;
          topicId: string;
          prunedAt: Date | null;
          topicStatus: string;
        }>
      >(Prisma.sql`
        SELECT
          a.id          AS "argumentId",
          a.topic_id    AS "topicId",
          a.pruned_at   AS "prunedAt",
          t.status      AS "topicStatus"
        FROM arguments a
        JOIN topics t ON t.id = a.topic_id
        WHERE a.id = ${params.argumentId}::uuid
        FOR UPDATE OF a, t
      `);

      const row = rows[0];
      if (!row) {
        throw new NotFoundException({
          error: { code: 'ARGUMENT_NOT_FOUND', message: 'Argument not found' },
        });
      }

      const { topicId, prunedAt, topicStatus } = row;

      // Ensure ledger exists
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO ledgers (
          topic_id,
          pubkey,
          balance,
          total_votes_staked,
          total_cost_staked,
          created_at,
          updated_at
        )
        VALUES (
          ${topicId}::uuid,
          ${pubkeyBytes},
          100,
          0,
          0,
          NOW(),
          NOW()
        )
        ON CONFLICT DO NOTHING
      `);

      // Lock ledger
      const ledgerRows = await tx.$queryRaw<
        Array<{
          topicId: string;
          pubkey: Buffer;
          balance: number;
          totalVotesStaked: number;
          totalCostStaked: number;
          lastInteractionAt: Date | null;
        }>
      >(Prisma.sql`
        SELECT
          topic_id            AS "topicId",
          pubkey              AS "pubkey",
          balance             AS "balance",
          total_votes_staked  AS "totalVotesStaked",
          total_cost_staked   AS "totalCostStaked",
          last_interaction_at AS "lastInteractionAt"
        FROM ledgers
        WHERE topic_id = ${topicId}::uuid
          AND pubkey = ${pubkeyBytes}
        FOR UPDATE
      `);

      const ledger = ledgerRows[0];
      if (!ledger) {
        throw new HttpException(
          { error: { code: 'BAD_REQUEST', message: 'Ledger initialization failed' } },
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      // Lock stake (may be absent)
      const stakeRows = await tx.$queryRaw<Array<{ votes: number; cost: number }>>(Prisma.sql`
        SELECT votes, cost
        FROM stakes
        WHERE topic_id = ${topicId}::uuid
          AND argument_id = ${params.argumentId}::uuid
          AND voter_pubkey = ${pubkeyBytes}
        FOR UPDATE
      `);

      const currentVotes = stakeRows[0]?.votes ?? 0;

      // pruned/status restrictions: only forbid increase
      if (prunedAt && params.targetVotes > currentVotes) {
        throw new ConflictException({
          error: {
            code: 'ARGUMENT_PRUNED_INCREASE_FORBIDDEN',
            message: 'Cannot increase votes on a pruned argument',
          },
        });
      }

      if (topicStatus !== 'active' && params.targetVotes > currentVotes) {
        throw new ConflictException({
          error: {
            code: 'TOPIC_STATUS_DISALLOWS_WRITE',
            message: 'Topic status disallows increasing votes',
          },
        });
      }

      // Core delta + balance check (pure logic)
      const validation = validateSetVotes({
        currentVotes,
        targetVotes: params.targetVotes,
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

      const { delta } = validation;

      // Update stake (upsert/delete)
      if (params.targetVotes === 0) {
        if (currentVotes > 0) {
          await tx.stake.delete({
            where: {
              topicId_argumentId_voterPubkey: {
                topicId,
                argumentId: params.argumentId,
                voterPubkey: pubkeyBytes,
              },
            },
          });
        }
      } else {
        await tx.stake.upsert({
          where: {
            topicId_argumentId_voterPubkey: {
              topicId,
              argumentId: params.argumentId,
              voterPubkey: pubkeyBytes,
            },
          },
          create: {
            topicId,
            argumentId: params.argumentId,
            voterPubkey: pubkeyBytes,
            votes: params.targetVotes,
            cost: delta.targetCost,
          },
          update: {
            votes: params.targetVotes,
            cost: delta.targetCost,
          },
        });
      }

      const now = new Date();

      // Update ledger (explicit values; row is locked)
      const updatedLedger = await tx.ledger.update({
        where: { topicId_pubkey: { topicId, pubkey: pubkeyBytes } },
        data: {
          balance: ledger.balance - delta.deltaCost,
          totalVotesStaked: ledger.totalVotesStaked + delta.deltaVotes,
          totalCostStaked: ledger.totalCostStaked + delta.deltaCost,
          lastInteractionAt: now,
        },
        select: {
          topicId: true,
          pubkey: true,
          balance: true,
          totalVotesStaked: true,
          totalCostStaked: true,
          lastInteractionAt: true,
        },
      });

      // Update argument totals (atomic increment; argument row is locked)
      await tx.argument.update({
        where: { topicId_id: { topicId, id: params.argumentId } },
        data: {
          totalVotes: { increment: delta.deltaVotes },
          totalCost: { increment: delta.deltaCost },
        },
      });

      const response: SetVotesResponse = {
        argumentId: params.argumentId,
        previousVotes: currentVotes,
        targetVotes: params.targetVotes,
        deltaVotes: delta.deltaVotes,
        previousCost: delta.previousCost,
        targetCost: delta.targetCost,
        deltaCost: delta.deltaCost,
        ledger: this.toLedgerMe(updatedLedger),
      };

      return { topicId, response };
    });

    // Idempotency write: cache only successful responses
    await this.redis.set(
      idempotencyKey,
      JSON.stringify(result.response),
      'EX',
      IDEMPOTENCY_TTL_SECONDS,
    );

    // (Optional, Step 12 consumes) SSE invalidation stream write
    try {
      await this.topicEvents.publish(result.topicId, {
        event: 'argument_updated',
        data: { argumentId: result.response.argumentId, reason: 'new_vote' },
      });
    } catch {
      // Best-effort; voting should not fail due to SSE stream issues
    }

    return result.response;
  }
}
