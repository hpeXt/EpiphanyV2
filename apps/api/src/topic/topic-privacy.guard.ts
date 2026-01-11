/**
 * @file topic-privacy.guard.ts
 * @description Topic privacy access-control guard (public/unlisted/private)
 *
 * For private topics:
 * - Allow if X-Topic-Access-Key (or ?k= for SSE) matches access_key_hash
 * - Or allow if request carries a valid v1 signature AND pubkey is a participant (owner or ledger exists)
 *
 * Unauthorized reads return 404 to reduce topic existence probing.
 */

import { Injectable, type CanActivate, type ExecutionContext, NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';

import { PrismaService } from '../infrastructure/prisma.module.js';
import { AuthService } from '../common/auth.service.js';

type NotFoundCode = 'TOPIC_NOT_FOUND' | 'ARGUMENT_NOT_FOUND';

@Injectable()
export class TopicPrivacyGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();

    const topicIdParam = (req.params as any)?.topicId;
    const argumentIdParam = (req.params as any)?.argumentId;

    let topicId: string | null = null;
    let notFoundCode: NotFoundCode = 'TOPIC_NOT_FOUND';

    if (typeof topicIdParam === 'string' && topicIdParam) {
      topicId = topicIdParam;
      notFoundCode = 'TOPIC_NOT_FOUND';
    } else if (typeof argumentIdParam === 'string' && argumentIdParam) {
      // Resolve topicId from argumentId without leaking existence of private topics.
      const arg = await this.prisma.argument.findUnique({
        where: { id: argumentIdParam },
        select: { topicId: true },
      });

      if (!arg) {
        throw this.notFound('ARGUMENT_NOT_FOUND');
      }

      topicId = arg.topicId;
      notFoundCode = 'ARGUMENT_NOT_FOUND';
    } else {
      return true;
    }

    const topic = await this.prisma.topic.findUnique({
      where: { id: topicId },
      select: {
        id: true,
        visibility: true,
        accessKeyHash: true,
        ownerPubkey: true,
      },
    });

    if (!topic) {
      throw this.notFound(notFoundCode);
    }

    if (topic.visibility !== 'private') {
      return true;
    }

    const accessKeyHex = this.getAccessKeyHex(req);
    if (accessKeyHex && topic.accessKeyHash && this.verifyAccessKey(accessKeyHex, topic.accessKeyHash)) {
      return true;
    }

    const signatureHeaders = this.readSignatureHeaders(req);
    if (signatureHeaders) {
      const verified = await this.auth.verifySignature({
        method: req.method,
        path: req.originalUrl,
        timestamp: signatureHeaders.timestamp,
        nonce: signatureHeaders.nonce,
        rawBody: req.rawBody?.toString() || '',
        pubkey: signatureHeaders.pubkey,
        signature: signatureHeaders.signature,
      });

      if (verified.valid) {
        const pubkeyHexLower = signatureHeaders.pubkey.toLowerCase();

        const ownerHex = topic.ownerPubkey ? Buffer.from(topic.ownerPubkey).toString('hex').toLowerCase() : null;
        if (ownerHex && ownerHex === pubkeyHexLower) {
          return true;
        }

        // Participant: ledger row exists for (topicId, pubkey)
        const pubkeyBytes = Buffer.from(pubkeyHexLower, 'hex');
        const ledger = await this.prisma.ledger.findUnique({
          where: { topicId_pubkey: { topicId, pubkey: pubkeyBytes } },
          select: { topicId: true },
        });
        if (ledger) {
          return true;
        }
      }
    }

    throw this.notFound(notFoundCode);
  }

  private notFound(code: NotFoundCode): NotFoundException {
    const message = code === 'TOPIC_NOT_FOUND' ? 'Topic not found' : 'Argument not found';
    return new NotFoundException({ error: { code, message } });
  }

  private getAccessKeyHex(req: Request): string | null {
    const header = req.headers['x-topic-access-key'];
    const raw = typeof header === 'string' ? header : null;
    const query = typeof (req.query as any)?.k === 'string' ? String((req.query as any).k) : null;

    const candidate = (raw ?? query)?.trim().toLowerCase() ?? null;
    if (!candidate) return null;
    if (!/^[0-9a-f]{64}$/.test(candidate)) return null;
    return candidate;
  }

  private verifyAccessKey(accessKeyHex: string, expectedHash: Uint8Array): boolean {
    const keyBytes = Buffer.from(accessKeyHex, 'hex');
    const digest = createHash('sha256').update(keyBytes).digest();
    const expected = Buffer.from(expectedHash);
    if (expected.length !== digest.length) return false;
    return timingSafeEqual(expected, digest);
  }

  private readSignatureHeaders(req: Request): null | {
    pubkey: string;
    signature: string;
    timestamp: string;
    nonce: string;
  } {
    const pubkey = req.headers['x-pubkey'];
    const signature = req.headers['x-signature'];
    const timestamp = req.headers['x-timestamp'];
    const nonce = req.headers['x-nonce'];

    if (typeof pubkey !== 'string') return null;
    if (typeof signature !== 'string') return null;
    if (typeof timestamp !== 'string') return null;
    if (typeof nonce !== 'string') return null;

    return { pubkey, signature, timestamp, nonce };
  }
}

