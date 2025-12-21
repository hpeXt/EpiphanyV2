/**
 * @file user.service.ts
 * @description User service for batch-balance endpoint
 * @see docs/api-contract.md#3.10
 */
import { Injectable } from '@nestjs/common';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { PrismaService } from '../infrastructure/prisma.module.js';
import type {
  BatchBalanceRequest,
  BatchBalanceResponse,
  BatchBalanceResult,
} from '@epiphany/shared-contracts';

const TIMESTAMP_WINDOW_MS = 60_000; // 60 seconds

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Process batch balance query with item-level signature verification
   * @see docs/api-contract.md#3.10
   */
  async batchBalance(request: BatchBalanceRequest): Promise<BatchBalanceResponse> {
    const results: BatchBalanceResult[] = [];

    for (const item of request.items) {
      try {
        const result = await this.processBalanceItem(item);
        results.push(result);
      } catch (error) {
        // This shouldn't happen as processBalanceItem catches all errors
        results.push({
          topicId: item.topicId,
          ok: false,
          error: {
            code: 'BAD_REQUEST',
            message: error instanceof Error ? error.message : 'Unknown error',
          },
        });
      }
    }

    return { results };
  }

  private async processBalanceItem(item: {
    topicId: string;
    pubkey: string;
    timestamp: number;
    nonce: string;
    signature: string;
  }): Promise<BatchBalanceResult> {
    // Validate pubkey format
    if (!this.isValidHex(item.pubkey, 64)) {
      return {
        topicId: item.topicId,
        ok: false,
        error: { code: 'INVALID_SIGNATURE', message: 'Invalid pubkey format' },
      };
    }

    // Validate signature format
    if (!this.isValidHex(item.signature, 128)) {
      return {
        topicId: item.topicId,
        ok: false,
        error: { code: 'INVALID_SIGNATURE', message: 'Invalid signature format' },
      };
    }

    // Validate nonce format (no pipe)
    if (item.nonce.includes('|')) {
      return {
        topicId: item.topicId,
        ok: false,
        error: { code: 'BAD_REQUEST', message: 'Nonce cannot contain |' },
      };
    }

    // Check timestamp window
    const now = Date.now();
    if (Math.abs(now - item.timestamp) >= TIMESTAMP_WINDOW_MS) {
      return {
        topicId: item.topicId,
        ok: false,
        error: { code: 'TIMESTAMP_OUT_OF_RANGE', message: 'Timestamp out of range' },
      };
    }

    // Build canonical message for GET /v1/topics/{topicId}/ledger/me with empty body
    // Format: v1|GET|/v1/topics/{topicId}/ledger/me|{timestamp}|{nonce}|
    const path = `/v1/topics/${item.topicId}/ledger/me`;
    const canonical = `v1|GET|${path}|${item.timestamp}|${item.nonce}|`;

    // Verify signature
    const isValid = this.verifySignature(item.pubkey, canonical, item.signature);
    if (!isValid) {
      return {
        topicId: item.topicId,
        ok: false,
        error: { code: 'INVALID_SIGNATURE', message: 'Signature verification failed' },
      };
    }

    // Check if topic exists
    const topic = await this.prisma.topic.findUnique({
      where: { id: item.topicId },
      select: { id: true },
    });

    if (!topic) {
      return {
        topicId: item.topicId,
        ok: false,
        error: { code: 'TOPIC_NOT_FOUND', message: 'Topic not found' },
      };
    }

    // Get ledger or return default
    const pubkeyBytes = Buffer.from(item.pubkey, 'hex');
    const ledger = await this.prisma.ledger.findUnique({
      where: { topicId_pubkey: { topicId: item.topicId, pubkey: pubkeyBytes } },
      select: {
        balance: true,
        totalVotesStaked: true,
        totalCostStaked: true,
        lastInteractionAt: true,
      },
    });

    if (ledger) {
      return {
        topicId: item.topicId,
        ok: true,
        balance: ledger.balance,
        myTotalVotes: ledger.totalVotesStaked,
        myTotalCost: ledger.totalCostStaked,
        lastInteractionAt: ledger.lastInteractionAt?.toISOString() ?? null,
      };
    }

    // Return default ledger values
    return {
      topicId: item.topicId,
      ok: true,
      balance: 100,
      myTotalVotes: 0,
      myTotalCost: 0,
      lastInteractionAt: null,
    };
  }

  private verifySignature(pubkeyHex: string, message: string, signatureHex: string): boolean {
    try {
      const pubkeyBytes = Buffer.from(pubkeyHex, 'hex');
      const signatureBytes = Buffer.from(signatureHex, 'hex');

      // Create Ed25519 public key object
      const keyObject = createPublicKey({
        key: Buffer.concat([
          // Ed25519 public key DER header
          Buffer.from('302a300506032b6570032100', 'hex'),
          pubkeyBytes,
        ]),
        format: 'der',
        type: 'spki',
      });

      return verify(null, Buffer.from(message, 'utf8'), keyObject, signatureBytes);
    } catch {
      return false;
    }
  }

  private isValidHex(str: string, expectedLength: number): boolean {
    if (str.length !== expectedLength) return false;
    return /^[0-9a-f]+$/i.test(str);
  }
}
