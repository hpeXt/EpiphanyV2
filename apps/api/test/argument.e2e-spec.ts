import { type INestApplication } from '@nestjs/common';
import { type App } from 'supertest/types';
import request from 'supertest';
import { v7 as uuidv7 } from 'uuid';

import {
  zCreateArgumentResponse,
  zErrorResponse,
} from '@epiphany/shared-contracts';

import { PrismaService } from '../src/infrastructure/prisma.module';
import {
  computeAuthorId,
  createE2eApp,
  generateEd25519Keypair,
  makeSignedHeaders,
} from './e2e-helpers';

describe('Argument API (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const { privateKey, pubkeyHex } = generateEd25519Keypair();
  const pubkeyBytes = Buffer.from(pubkeyHex, 'hex');

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function createTopic(): Promise<{
    topicId: string;
    rootArgumentId: string;
  }> {
    const res = await request(app.getHttpServer())
      .post('/v1/topics')
      .send({ title: 'E2E Topic', body: 'Root body' })
      .expect(201);
    return { topicId: res.body.topicId, rootArgumentId: res.body.rootArgumentId };
  }

  describe('POST /v1/topics/:topicId/arguments', () => {
    it('should require signature: missing signature → 401 INVALID_SIGNATURE', async () => {
      const { topicId, rootArgumentId } = await createTopic();
      const path = `/v1/topics/${topicId}/arguments`;

      const res = await request(app.getHttpServer())
        .post(path)
        .send({ parentId: rootArgumentId, title: null, body: 'Hello' })
        .expect(401);

      const parsed = zErrorResponse.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.error.code).toBe('INVALID_SIGNATURE');
      }
    });

    it('should enforce timestamp window → 401 TIMESTAMP_OUT_OF_RANGE', async () => {
      const { topicId, rootArgumentId } = await createTopic();
      const path = `/v1/topics/${topicId}/arguments`;

      const body = { parentId: rootArgumentId, title: null, body: 'Hello' };
      const headers = makeSignedHeaders({
        method: 'POST',
        path,
        body,
        privateKey,
        pubkeyHex,
        timestampMs: Date.now() - 61_000,
      });

      const res = await request(app.getHttpServer())
        .post(path)
        .set(headers)
        .send(body)
        .expect(401);

      const parsed = zErrorResponse.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.error.code).toBe('TIMESTAMP_OUT_OF_RANGE');
      }
    });

    it('should reject nonce replay → 409 NONCE_REPLAY', async () => {
      const { topicId, rootArgumentId } = await createTopic();
      const path = `/v1/topics/${topicId}/arguments`;

      const nonce = 'fixed-nonce-for-replay';
      const body = { parentId: rootArgumentId, title: null, body: 'Hello' };

      const headers1 = makeSignedHeaders({
        method: 'POST',
        path,
        body,
        privateKey,
        pubkeyHex,
        nonce,
      });

      await request(app.getHttpServer())
        .post(path)
        .set(headers1)
        .send(body)
        .expect(200);

      const headers2 = makeSignedHeaders({
        method: 'POST',
        path,
        body,
        privateKey,
        pubkeyHex,
        nonce,
      });

      const res = await request(app.getHttpServer())
        .post(path)
        .set(headers2)
        .send(body)
        .expect(409);

      const parsed = zErrorResponse.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.error.code).toBe('NONCE_REPLAY');
      }
    });

    it('should return 404 TOPIC_NOT_FOUND when topic does not exist', async () => {
      const topicId = uuidv7();
      const path = `/v1/topics/${topicId}/arguments`;

      const body = { parentId: uuidv7(), title: null, body: 'Hello' };
      const headers = makeSignedHeaders({
        method: 'POST',
        path,
        body,
        privateKey,
        pubkeyHex,
      });

      const res = await request(app.getHttpServer())
        .post(path)
        .set(headers)
        .send(body)
        .expect(404);

      const parsed = zErrorResponse.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.error.code).toBe('TOPIC_NOT_FOUND');
      }
    });

    it('should return 404 ARGUMENT_NOT_FOUND when parent does not exist', async () => {
      const { topicId } = await createTopic();
      const path = `/v1/topics/${topicId}/arguments`;

      const body = { parentId: uuidv7(), title: null, body: 'Hello' };
      const headers = makeSignedHeaders({
        method: 'POST',
        path,
        body,
        privateKey,
        pubkeyHex,
      });

      const res = await request(app.getHttpServer())
        .post(path)
        .set(headers)
        .send(body)
        .expect(404);

      const parsed = zErrorResponse.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.error.code).toBe('ARGUMENT_NOT_FOUND');
      }
    });

    it('should reject writes when topic.status is not active → 409 TOPIC_STATUS_DISALLOWS_WRITE', async () => {
      const { topicId, rootArgumentId } = await createTopic();
      await prisma.topic.update({ where: { id: topicId }, data: { status: 'frozen' } });

      const path = `/v1/topics/${topicId}/arguments`;
      const body = { parentId: rootArgumentId, title: null, body: 'Hello' };
      const headers = makeSignedHeaders({
        method: 'POST',
        path,
        body,
        privateKey,
        pubkeyHex,
      });

      const beforeCount = await prisma.argument.count({ where: { topicId } });

      const res = await request(app.getHttpServer())
        .post(path)
        .set(headers)
        .send(body)
        .expect(409);

      const afterCount = await prisma.argument.count({ where: { topicId } });
      expect(afterCount).toBe(beforeCount);

      const parsed = zErrorResponse.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.error.code).toBe('TOPIC_STATUS_DISALLOWS_WRITE');
      }
    });

    it('should validate request body: missing parentId/body → 400 BAD_REQUEST', async () => {
      const { topicId, rootArgumentId } = await createTopic();
      const path = `/v1/topics/${topicId}/arguments`;

      const body = { body: 'Hello' };
      const headers = makeSignedHeaders({
        method: 'POST',
        path,
        body,
        privateKey,
        pubkeyHex,
      });

      const res = await request(app.getHttpServer())
        .post(path)
        .set(headers)
        .send(body)
        .expect(400);

      const parsed = zErrorResponse.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.error.code).toBe('BAD_REQUEST');
      }

      const body2 = { parentId: rootArgumentId };
      const headers2 = makeSignedHeaders({
        method: 'POST',
        path,
        body: body2,
        privateKey,
        pubkeyHex,
      });

      const res2 = await request(app.getHttpServer())
        .post(path)
        .set(headers2)
        .send(body2)
        .expect(400);

      const parsed2 = zErrorResponse.safeParse(res2.body);
      expect(parsed2.success).toBe(true);
      if (parsed2.success) {
        expect(parsed2.data.error.code).toBe('BAD_REQUEST');
      }
    });

    it('should allow replying to a pruned parent (prunedAt != null)', async () => {
      const { topicId, rootArgumentId } = await createTopic();
      await prisma.argument.update({
        where: { topicId_id: { topicId, id: rootArgumentId } },
        data: { prunedAt: new Date() },
      });

      const path = `/v1/topics/${topicId}/arguments`;
      const body = { parentId: rootArgumentId, title: null, body: 'Child' };
      const headers = makeSignedHeaders({
        method: 'POST',
        path,
        body,
        privateKey,
        pubkeyHex,
      });

      const res = await request(app.getHttpServer())
        .post(path)
        .set(headers)
        .send(body)
        .expect(200);

      const parsed = zCreateArgumentResponse.safeParse(res.body);
      expect(parsed.success).toBe(true);
    });

    it('should treat missing initialVotes as 0 (no stake, totals=0)', async () => {
      const { topicId, rootArgumentId } = await createTopic();
      const path = `/v1/topics/${topicId}/arguments`;

      const body = { parentId: rootArgumentId, title: null, body: 'No votes' };
      const headers = makeSignedHeaders({
        method: 'POST',
        path,
        body,
        privateKey,
        pubkeyHex,
      });

      const res = await request(app.getHttpServer())
        .post(path)
        .set(headers)
        .send(body)
        .expect(200);

      const parsed = zCreateArgumentResponse.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;

      expect(parsed.data.argument.totalVotes).toBe(0);
      expect(parsed.data.argument.totalCost).toBe(0);

      const stakeCount = await prisma.stake.count({
        where: { topicId, voterPubkey: pubkeyBytes },
      });
      expect(stakeCount).toBe(0);
    });

    it('should reject invalid initialVotes (>10) → 400 BAD_REQUEST', async () => {
      const { topicId, rootArgumentId } = await createTopic();
      const path = `/v1/topics/${topicId}/arguments`;

      const body = {
        parentId: rootArgumentId,
        title: null,
        body: 'Too many votes',
        initialVotes: 11,
      };
      const headers = makeSignedHeaders({
        method: 'POST',
        path,
        body,
        privateKey,
        pubkeyHex,
      });

      const res = await request(app.getHttpServer())
        .post(path)
        .set(headers)
        .send(body)
        .expect(400);

      const parsed = zErrorResponse.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.error.code).toBe('BAD_REQUEST');
      }
    });

    it('should fail atomically on insufficient balance (no argument/stake, ledger unchanged) → 402 INSUFFICIENT_BALANCE', async () => {
      const { topicId, rootArgumentId } = await createTopic();

      await prisma.ledger.create({
        data: {
          topicId,
          pubkey: pubkeyBytes,
          balance: 0,
          totalVotesStaked: 0,
          totalCostStaked: 100,
          lastInteractionAt: null,
        },
      });

      const ledgerBefore = await prisma.ledger.findUniqueOrThrow({
        where: { topicId_pubkey: { topicId, pubkey: pubkeyBytes } },
      });

      const path = `/v1/topics/${topicId}/arguments`;
      const body = {
        parentId: rootArgumentId,
        title: null,
        body: 'Need votes',
        initialVotes: 1,
      };
      const headers = makeSignedHeaders({
        method: 'POST',
        path,
        body,
        privateKey,
        pubkeyHex,
      });

      const argCountBefore = await prisma.argument.count({ where: { topicId } });
      const stakeCountBefore = await prisma.stake.count({
        where: { topicId, voterPubkey: pubkeyBytes },
      });

      const res = await request(app.getHttpServer())
        .post(path)
        .set(headers)
        .send(body)
        .expect(402);

      const argCountAfter = await prisma.argument.count({ where: { topicId } });
      const stakeCountAfter = await prisma.stake.count({
        where: { topicId, voterPubkey: pubkeyBytes },
      });
      expect(argCountAfter).toBe(argCountBefore);
      expect(stakeCountAfter).toBe(stakeCountBefore);

      const ledgerAfter = await prisma.ledger.findUniqueOrThrow({
        where: { topicId_pubkey: { topicId, pubkey: pubkeyBytes } },
      });
      expect(ledgerAfter.balance).toBe(ledgerBefore.balance);
      expect(ledgerAfter.totalCostStaked).toBe(ledgerBefore.totalCostStaked);
      expect(ledgerAfter.totalVotesStaked).toBe(ledgerBefore.totalVotesStaked);
      expect(ledgerAfter.updatedAt.toISOString()).toBe(
        ledgerBefore.updatedAt.toISOString(),
      );

      const parsed = zErrorResponse.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.error.code).toBe('INSUFFICIENT_BALANCE');
      }
    });

    it('should create argument + initialVotes atomically (stake/ledger/totals updated) and match contract', async () => {
      const { topicId, rootArgumentId } = await createTopic();
      const path = `/v1/topics/${topicId}/arguments`;

      const body = {
        parentId: rootArgumentId,
        title: null,
        body: 'Arg with votes',
        initialVotes: 3,
      };
      const headers = makeSignedHeaders({
        method: 'POST',
        path,
        body,
        privateKey,
        pubkeyHex,
      });

      const res = await request(app.getHttpServer())
        .post(path)
        .set(headers)
        .send(body)
        .expect(200);

      const parsed = zCreateArgumentResponse.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;

      // Argument created with pending_analysis and correct authorId
      expect(parsed.data.argument.topicId).toBe(topicId);
      expect(parsed.data.argument.parentId).toBe(rootArgumentId);
      expect(parsed.data.argument.analysisStatus).toBe('pending_analysis');
      expect(parsed.data.argument.authorId).toBe(computeAuthorId(pubkeyHex));

      // Totals updated
      expect(parsed.data.argument.totalVotes).toBe(3);
      expect(parsed.data.argument.totalCost).toBe(9);

      // Ledger updated and invariant holds
      expect(parsed.data.ledger.pubkey).toBe(pubkeyHex);
      expect(parsed.data.ledger.myTotalVotes).toBe(3);
      expect(parsed.data.ledger.myTotalCost).toBe(9);
      expect(parsed.data.ledger.balance).toBe(91);
      expect(parsed.data.ledger.balance + parsed.data.ledger.myTotalCost).toBe(100);

      // Stake persisted with votes^2 cost
      const stake = await prisma.stake.findUniqueOrThrow({
        where: {
          topicId_argumentId_voterPubkey: {
            topicId,
            argumentId: parsed.data.argument.id,
            voterPubkey: pubkeyBytes,
          },
        },
      });
      expect(stake.votes).toBe(3);
      expect(stake.cost).toBe(9);
    });
  });
});

