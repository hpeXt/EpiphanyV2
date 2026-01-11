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
import { createHash, timingSafeEqual } from 'node:crypto';
import { validateSetVotes } from '@epiphany/core-logic';
import { zSetVotesResponse, type SetVotesResponse, type LedgerMe } from '@epiphany/shared-contracts';
import { PrismaService } from '../infrastructure/prisma.module.js';
import { RedisService } from '../infrastructure/redis.module.js';
import { TopicEventsPublisher } from '../sse/topic-events.publisher.js';
import { QueueService } from '../infrastructure/queue.module.js';

const IDEMPOTENCY_TTL_SECONDS = 300; // 5 minutes
const IDEMPOTENCY_DB_CLEANUP_LIMIT = 500;

@Injectable()
export class VotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly topicEvents: TopicEventsPublisher,
    private readonly queue: QueueService,
  ) {}

  private getIdempotencyKey(pubkey: string, nonce: string): string {
    return `idemp:setVotes:${pubkey}:${nonce}`;
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
    accessKeyHex?: string;
  }): Promise<SetVotesResponse> {
    const idempotencyKey = this.getIdempotencyKey(params.pubkey, params.nonce);
    const pubkeyBytes = Buffer.from(params.pubkey, 'hex');

    // Idempotency read: return cached success response regardless of request body/argumentId
    try {
      const cached = await this.redis.get(idempotencyKey);
      if (cached) {
        try {
          const parsed = zSetVotesResponse.safeParse(JSON.parse(cached));
          if (parsed.success) return parsed.data;
        } catch {
          // fall through to recompute; cache will be overwritten on next success
        }
      }
    } catch {
      // Best-effort: if Redis is unavailable, fall back to DB-backed idempotency.
    }

    // Best-effort: keep DB idempotency table bounded (expired rows).
    // This is intentionally limited to avoid per-request full-table deletes.
    try {
      await this.prisma.$executeRaw(Prisma.sql`
        DELETE FROM set_votes_idempotency
        WHERE ctid IN (
          SELECT ctid
          FROM set_votes_idempotency
          WHERE expires_at < NOW()
          LIMIT ${IDEMPOTENCY_DB_CLEANUP_LIMIT}
        )
      `);
    } catch {
      // ignore cleanup failures
    }

    const now = new Date();
    const existing = await this.prisma.setVotesIdempotency.findUnique({
      where: { pubkey_nonce: { pubkey: pubkeyBytes, nonce: params.nonce } },
      select: { response: true, expiresAt: true },
    });
    if (existing) {
      if (existing.expiresAt > now) {
        const parsed = zSetVotesResponse.safeParse(existing.response);
        if (parsed.success) {
          try {
            const ttlSeconds = Math.min(
              IDEMPOTENCY_TTL_SECONDS,
              Math.max(1, Math.ceil((existing.expiresAt.getTime() - Date.now()) / 1000)),
            );
            await this.redis.set(idempotencyKey, JSON.stringify(parsed.data), 'EX', ttlSeconds);
          } catch {
            // best-effort cache warm
          }
          return parsed.data;
        }
      } else {
        // Expired: allow nonce reuse after the window.
        await this.prisma.setVotesIdempotency
          .delete({ where: { pubkey_nonce: { pubkey: pubkeyBytes, nonce: params.nonce } } })
          .catch(() => undefined);
      }
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // Lock argument + topic
      const rows = await tx.$queryRaw<
        Array<{
          argumentId: string;
          topicId: string;
          prunedAt: Date | null;
          topicStatus: string;
          topicVisibility: string;
          ownerPubkey: Buffer | null;
          accessKeyHash: Buffer | null;
        }>
      >(Prisma.sql`
        SELECT
          a.id          AS "argumentId",
          a.topic_id    AS "topicId",
          a.pruned_at   AS "prunedAt",
          t.status      AS "topicStatus",
          t.visibility  AS "topicVisibility",
          t.owner_pubkey AS "ownerPubkey",
          t.access_key_hash AS "accessKeyHash"
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

      const { topicId, prunedAt, topicStatus, topicVisibility, ownerPubkey, accessKeyHash } = row;

      if (topicVisibility === 'private') {
        const ownerOk = ownerPubkey ? Buffer.from(ownerPubkey).equals(pubkeyBytes) : false;

        if (!ownerOk) {
          const participantRows = await tx.$queryRaw<Array<{ ok: number }>>(Prisma.sql`
            SELECT 1 AS ok
            FROM ledgers
            WHERE topic_id = ${topicId}::uuid
              AND pubkey = ${pubkeyBytes}
            LIMIT 1
          `);

          const isParticipant = participantRows.length > 0;
          const accessKeyNormalized = this.normalizeAccessKeyHex(params.accessKeyHex);
          const accessKeyOk = accessKeyNormalized
            ? this.verifyAccessKey(accessKeyNormalized, accessKeyHash)
            : false;

          if (!isParticipant && !accessKeyOk) {
            throw new NotFoundException({
              error: { code: 'ARGUMENT_NOT_FOUND', message: 'Argument not found' },
            });
          }
        }
      }

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

      // DB-backed idempotency (durable): store the success response in the same transaction.
      // If another request already created the record, return its stored response and avoid writes.
      const now = new Date();
      const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_SECONDS * 1000);

      const response: SetVotesResponse = {
        argumentId: params.argumentId,
        previousVotes: currentVotes,
        targetVotes: params.targetVotes,
        deltaVotes: delta.deltaVotes,
        previousCost: delta.previousCost,
        targetCost: delta.targetCost,
        deltaCost: delta.deltaCost,
        ledger: {
          topicId,
          pubkey: params.pubkey,
          balance: ledger.balance - delta.deltaCost,
          myTotalVotes: ledger.totalVotesStaked + delta.deltaVotes,
          myTotalCost: ledger.totalCostStaked + delta.deltaCost,
          lastInteractionAt: now.toISOString(),
        },
      };

      try {
        await tx.setVotesIdempotency.create({
          data: {
            pubkey: pubkeyBytes,
            nonce: params.nonce,
            response,
            expiresAt,
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          const existing = await tx.setVotesIdempotency.findUnique({
            where: { pubkey_nonce: { pubkey: pubkeyBytes, nonce: params.nonce } },
            select: { response: true, expiresAt: true },
          });

          if (existing && existing.expiresAt > now) {
            const parsed = zSetVotesResponse.safeParse(existing.response);
            if (parsed.success) {
              return { topicId: parsed.data.ledger.topicId, response: parsed.data, didMutate: false, expiresAt: existing.expiresAt };
            }
          }

          // Existing but invalid/expired: fall through to let the request fail (consistent with "nonce consumed").
          throw new ConflictException({
            error: { code: 'NONCE_REPLAY', message: 'Nonce already used' },
          });
        }

        throw err;
      }

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

      response.ledger = this.toLedgerMe(updatedLedger);
      return { topicId, response, didMutate: true, expiresAt };
    });

    // Idempotency write: cache only successful responses (best-effort; DB is the source of truth)
    try {
      const ttlSeconds = Math.min(
        IDEMPOTENCY_TTL_SECONDS,
        Math.max(1, Math.ceil((result.expiresAt.getTime() - Date.now()) / 1000)),
      );
      await this.redis.set(idempotencyKey, JSON.stringify(result.response), 'EX', ttlSeconds);
    } catch {
      // ignore Redis failures
    }

    if (!result.didMutate) {
      return result.response;
    }

    // (Optional, Step 12 consumes) SSE invalidation stream write
    try {
      await this.topicEvents.publish(result.topicId, {
        event: 'argument_updated',
        data: { argumentId: result.response.argumentId, reason: 'new_vote' },
      });
    } catch {
      // Best-effort; voting should not fail due to SSE stream issues
    }

    // Trigger topic clustering debounce (Step 19) after a vote change.
    this.queue.enqueueTopicCluster(result.topicId).catch(() => {
      // Best-effort; voting should not fail due to queue issues
    });

    return result.response;
  }
}
