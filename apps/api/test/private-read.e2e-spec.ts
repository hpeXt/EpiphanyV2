/**
 * @file private-read.e2e-spec.ts
 * @description Step 11 - Private read endpoints (ledger/me, stakes/me, batch-balance)
 *
 * Tests cover:
 * - GET /v1/topics/:topicId/ledger/me - requires signature, auto-init balance=100
 * - GET /v1/topics/:topicId/stakes/me - requires signature, includes pruned stakes
 * - POST /v1/user/batch-balance - item-level signature, single failure isolation
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { json } from 'express';
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign as cryptoSign,
  type KeyObject,
} from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/prisma.module';
import { RedisService } from '../src/infrastructure/redis.module';
import {
  zCreateTopicResponse,
  zErrorResponse,
  zLedgerMe,
  zStakesMeResponse,
  zBatchBalanceResponse,
} from '@epiphany/shared-contracts';

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

function generateUser(): { privateKey: KeyObject; pubkeyHex: string } {
  const keypair = generateKeyPairSync('ed25519');
  const pubkeyDer = keypair.publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  const pubkeyHex = pubkeyDer.subarray(12).toString('hex');
  return { privateKey: keypair.privateKey, pubkeyHex };
}

function signHeaders(opts: {
  method: string;
  path: string;
  rawBody?: string;
  privateKey: KeyObject;
  pubkeyHex: string;
  nonce?: string;
  timestampOffsetMs?: number;
}): Record<string, string> {
  const timestamp = String(Date.now() + (opts.timestampOffsetMs ?? 0));
  const nonce = opts.nonce ?? randomBytes(16).toString('hex');
  const bodyHash = opts.rawBody ? sha256Hex(opts.rawBody) : '';
  const canonical = `v1|${opts.method.toUpperCase()}|${opts.path}|${timestamp}|${nonce}|${bodyHash}`;
  const signature = cryptoSign(null, Buffer.from(canonical, 'utf8'), opts.privateKey).toString('hex');

  return {
    'X-Pubkey': opts.pubkeyHex,
    'X-Signature': signature,
    'X-Timestamp': timestamp,
    'X-Nonce': nonce,
  };
}

async function createTopic(app: INestApplication<App>): Promise<{ topicId: string; rootArgumentId: string }> {
  const res = await request(app.getHttpServer())
    .post('/v1/topics')
    .send({ title: 'E2E::privateRead', body: 'root body' })
    .expect(201);

  const parsed = zCreateTopicResponse.safeParse(res.body);
  expect(parsed.success).toBe(true);
  if (!parsed.success) throw new Error('createTopic response contract mismatch');

  return { topicId: parsed.data.topicId, rootArgumentId: parsed.data.rootArgumentId };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('Private Read Endpoints (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: RedisService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ bodyParser: false });
    app.use(
      json({
        verify: (req, _res, buf) => {
          (req as any).rawBody = buf.toString('utf8');
        },
      }),
    );
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();

    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
  });

  afterAll(async () => {
    await app.close();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // GET /v1/topics/:topicId/ledger/me
  // ─────────────────────────────────────────────────────────────────────────

  describe('GET /v1/topics/:topicId/ledger/me', () => {
    it('should require signature (missing headers -> 401 INVALID_SIGNATURE)', async () => {
      const { topicId } = await createTopic(app);

      const res = await request(app.getHttpServer())
        .get(`/v1/topics/${topicId}/ledger/me`);

      expect(res.status).toBe(401);
      const parsed = zErrorResponse.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.error.code).toBe('INVALID_SIGNATURE');
      }
    });

    it('should auto-initialize ledger with balance=100 when not exists', async () => {
      const { topicId } = await createTopic(app);
      const user = generateUser();
      const path = `/v1/topics/${topicId}/ledger/me`;
      const headers = signHeaders({
        method: 'GET',
        path,
        privateKey: user.privateKey,
        pubkeyHex: user.pubkeyHex,
      });

      const res = await request(app.getHttpServer())
        .get(path)
        .set(headers);

      expect(res.status).toBe(200);
      const parsed = zLedgerMe.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.topicId).toBe(topicId);
        expect(parsed.data.pubkey).toBe(user.pubkeyHex);
        expect(parsed.data.balance).toBe(100);
        expect(parsed.data.myTotalVotes).toBe(0);
        expect(parsed.data.myTotalCost).toBe(0);
      }
    });

    it('should return 409 NONCE_REPLAY when same nonce is used twice', async () => {
      const { topicId } = await createTopic(app);
      const user = generateUser();
      const path = `/v1/topics/${topicId}/ledger/me`;
      const fixedNonce = `test-nonce-${Date.now()}`;

      // First request should succeed
      const headers1 = signHeaders({
        method: 'GET',
        path,
        privateKey: user.privateKey,
        pubkeyHex: user.pubkeyHex,
        nonce: fixedNonce,
      });

      const res1 = await request(app.getHttpServer())
        .get(path)
        .set(headers1);
      expect(res1.status).toBe(200);

      // Second request with same nonce should fail
      const headers2 = signHeaders({
        method: 'GET',
        path,
        privateKey: user.privateKey,
        pubkeyHex: user.pubkeyHex,
        nonce: fixedNonce,
      });

      const res2 = await request(app.getHttpServer())
        .get(path)
        .set(headers2);

      expect(res2.status).toBe(409);
      expect(res2.body.error.code).toBe('NONCE_REPLAY');
    });

    it('should return 404 TOPIC_NOT_FOUND when topic does not exist', async () => {
      const user = generateUser();
      const missingTopicId = uuidv7();
      const path = `/v1/topics/${missingTopicId}/ledger/me`;
      const headers = signHeaders({
        method: 'GET',
        path,
        privateKey: user.privateKey,
        pubkeyHex: user.pubkeyHex,
      });

      const res = await request(app.getHttpServer())
        .get(path)
        .set(headers);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('TOPIC_NOT_FOUND');
    });

    it('should return correct balance after voting', async () => {
      const { topicId, rootArgumentId } = await createTopic(app);
      const user = generateUser();

      // Vote on root argument (0 -> 3, cost 9)
      const votePath = `/v1/arguments/${rootArgumentId}/votes`;
      const voteBody = JSON.stringify({ targetVotes: 3 });
      const voteHeaders = signHeaders({
        method: 'POST',
        path: votePath,
        rawBody: voteBody,
        privateKey: user.privateKey,
        pubkeyHex: user.pubkeyHex,
      });
      await request(app.getHttpServer())
        .post(votePath)
        .set(voteHeaders)
        .set('Content-Type', 'application/json')
        .send(voteBody)
        .expect(200);

      // Now check ledger/me
      const ledgerPath = `/v1/topics/${topicId}/ledger/me`;
      const ledgerHeaders = signHeaders({
        method: 'GET',
        path: ledgerPath,
        privateKey: user.privateKey,
        pubkeyHex: user.pubkeyHex,
      });

      const res = await request(app.getHttpServer())
        .get(ledgerPath)
        .set(ledgerHeaders);

      expect(res.status).toBe(200);
      const parsed = zLedgerMe.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.balance).toBe(91); // 100 - 9
        expect(parsed.data.myTotalVotes).toBe(3);
        expect(parsed.data.myTotalCost).toBe(9);
        // Invariant: balance + myTotalCost == 100
        expect(parsed.data.balance + parsed.data.myTotalCost).toBe(100);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // GET /v1/topics/:topicId/stakes/me
  // ─────────────────────────────────────────────────────────────────────────

  describe('GET /v1/topics/:topicId/stakes/me', () => {
    it('should require signature (missing headers -> 401 INVALID_SIGNATURE)', async () => {
      const { topicId } = await createTopic(app);

      const res = await request(app.getHttpServer())
        .get(`/v1/topics/${topicId}/stakes/me`);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_SIGNATURE');
    });

    it('should return empty items when no stakes exist', async () => {
      const { topicId } = await createTopic(app);
      const user = generateUser();
      const path = `/v1/topics/${topicId}/stakes/me`;
      const headers = signHeaders({
        method: 'GET',
        path,
        privateKey: user.privateKey,
        pubkeyHex: user.pubkeyHex,
      });

      const res = await request(app.getHttpServer())
        .get(path)
        .set(headers);

      expect(res.status).toBe(200);
      const parsed = zStakesMeResponse.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.topicId).toBe(topicId);
        expect(parsed.data.pubkey).toBe(user.pubkeyHex);
        expect(parsed.data.items).toEqual([]);
      }
    });

    it('should return stakes with correct cost == votes^2', async () => {
      const { topicId, rootArgumentId } = await createTopic(app);
      const user = generateUser();

      // Create a second argument
      const secondArgumentId = uuidv7();
      await prisma.argument.create({
        data: {
          id: secondArgumentId,
          topicId,
          parentId: rootArgumentId,
          title: null,
          body: 'E2E::arg2',
          authorPubkey: Buffer.from(''.padStart(64, '0'), 'hex'),
          analysisStatus: 'pending_analysis',
          totalVotes: 0,
          totalCost: 0,
        },
      });

      // Vote on root (0 -> 3, cost 9)
      const vote1Path = `/v1/arguments/${rootArgumentId}/votes`;
      const vote1Body = JSON.stringify({ targetVotes: 3 });
      const vote1Headers = signHeaders({
        method: 'POST',
        path: vote1Path,
        rawBody: vote1Body,
        privateKey: user.privateKey,
        pubkeyHex: user.pubkeyHex,
      });
      await request(app.getHttpServer())
        .post(vote1Path)
        .set(vote1Headers)
        .set('Content-Type', 'application/json')
        .send(vote1Body)
        .expect(200);

      // Vote on second (0 -> 2, cost 4)
      const vote2Path = `/v1/arguments/${secondArgumentId}/votes`;
      const vote2Body = JSON.stringify({ targetVotes: 2 });
      const vote2Headers = signHeaders({
        method: 'POST',
        path: vote2Path,
        rawBody: vote2Body,
        privateKey: user.privateKey,
        pubkeyHex: user.pubkeyHex,
      });
      await request(app.getHttpServer())
        .post(vote2Path)
        .set(vote2Headers)
        .set('Content-Type', 'application/json')
        .send(vote2Body)
        .expect(200);

      // Check stakes/me
      const stakesPath = `/v1/topics/${topicId}/stakes/me`;
      const stakesHeaders = signHeaders({
        method: 'GET',
        path: stakesPath,
        privateKey: user.privateKey,
        pubkeyHex: user.pubkeyHex,
      });

      const res = await request(app.getHttpServer())
        .get(stakesPath)
        .set(stakesHeaders);

      expect(res.status).toBe(200);
      const parsed = zStakesMeResponse.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.items.length).toBe(2);
        for (const stake of parsed.data.items) {
          // cost == votes^2
          expect(stake.cost).toBe(stake.votes * stake.votes);
        }
        // Check specific stakes
        const rootStake = parsed.data.items.find(s => s.argumentId === rootArgumentId);
        const secondStake = parsed.data.items.find(s => s.argumentId === secondArgumentId);
        expect(rootStake).toMatchObject({ votes: 3, cost: 9 });
        expect(secondStake).toMatchObject({ votes: 2, cost: 4 });
      }
    });

    it('should include pruned arguments with argumentPrunedAt field', async () => {
      const { topicId, rootArgumentId } = await createTopic(app);
      const user = generateUser();

      // Vote on root (0 -> 3)
      const votePath = `/v1/arguments/${rootArgumentId}/votes`;
      const voteBody = JSON.stringify({ targetVotes: 3 });
      const voteHeaders = signHeaders({
        method: 'POST',
        path: votePath,
        rawBody: voteBody,
        privateKey: user.privateKey,
        pubkeyHex: user.pubkeyHex,
      });
      await request(app.getHttpServer())
        .post(votePath)
        .set(voteHeaders)
        .set('Content-Type', 'application/json')
        .send(voteBody)
        .expect(200);

      // Prune the root argument
      const prunedAt = new Date();
      await prisma.argument.update({
        where: { topicId_id: { topicId, id: rootArgumentId } },
        data: { prunedAt },
      });

      // Check stakes/me - should still include pruned stake
      const stakesPath = `/v1/topics/${topicId}/stakes/me`;
      const stakesHeaders = signHeaders({
        method: 'GET',
        path: stakesPath,
        privateKey: user.privateKey,
        pubkeyHex: user.pubkeyHex,
      });

      const res = await request(app.getHttpServer())
        .get(stakesPath)
        .set(stakesHeaders);

      expect(res.status).toBe(200);
      const parsed = zStakesMeResponse.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.items.length).toBe(1);
        const stake = parsed.data.items[0];
        expect(stake.argumentId).toBe(rootArgumentId);
        expect(stake.votes).toBe(3);
        expect(stake.argumentPrunedAt).not.toBeNull();
        // argumentPrunedAt should be an ISO string
        expect(typeof stake.argumentPrunedAt).toBe('string');
      }
    });

    it('should return 409 NONCE_REPLAY when same nonce is used twice', async () => {
      const { topicId } = await createTopic(app);
      const user = generateUser();
      const path = `/v1/topics/${topicId}/stakes/me`;
      const fixedNonce = `stakes-nonce-${Date.now()}`;

      // First request should succeed
      const headers1 = signHeaders({
        method: 'GET',
        path,
        privateKey: user.privateKey,
        pubkeyHex: user.pubkeyHex,
        nonce: fixedNonce,
      });
      const res1 = await request(app.getHttpServer())
        .get(path)
        .set(headers1);
      expect(res1.status).toBe(200);

      // Second request with same nonce should fail
      const headers2 = signHeaders({
        method: 'GET',
        path,
        privateKey: user.privateKey,
        pubkeyHex: user.pubkeyHex,
        nonce: fixedNonce,
      });
      const res2 = await request(app.getHttpServer())
        .get(path)
        .set(headers2);

      expect(res2.status).toBe(409);
      expect(res2.body.error.code).toBe('NONCE_REPLAY');
    });

    it('should return 404 TOPIC_NOT_FOUND when topic does not exist', async () => {
      const user = generateUser();
      const missingTopicId = uuidv7();
      const path = `/v1/topics/${missingTopicId}/stakes/me`;
      const headers = signHeaders({
        method: 'GET',
        path,
        privateKey: user.privateKey,
        pubkeyHex: user.pubkeyHex,
      });

      const res = await request(app.getHttpServer())
        .get(path)
        .set(headers);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('TOPIC_NOT_FOUND');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // POST /v1/user/batch-balance
  // ─────────────────────────────────────────────────────────────────────────

  describe('POST /v1/user/batch-balance', () => {
    it('should not require request-level signature headers', async () => {
      // The endpoint itself doesn't require signature in headers
      // Signature is at item level
      const res = await request(app.getHttpServer())
        .post('/v1/user/batch-balance')
        .send({ items: [] });

      // Should not return 401 for missing headers
      expect(res.status).toBe(200);
      const parsed = zBatchBalanceResponse.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.results).toEqual([]);
      }
    });

    it('should return ok:true with balance for valid item signatures', async () => {
      const { topicId } = await createTopic(app);
      const user = generateUser();

      // Build item signature (canonical message equivalent to GET /v1/topics/{topicId}/ledger/me with empty body)
      const timestamp = Date.now();
      const nonce = randomBytes(16).toString('hex');
      const itemPath = `/v1/topics/${topicId}/ledger/me`;
      // Empty body means bodyHash is empty, canonical ends with |
      const canonical = `v1|GET|${itemPath}|${timestamp}|${nonce}|`;
      const signature = cryptoSign(null, Buffer.from(canonical, 'utf8'), user.privateKey).toString('hex');

      const res = await request(app.getHttpServer())
        .post('/v1/user/batch-balance')
        .send({
          items: [
            {
              topicId,
              pubkey: user.pubkeyHex,
              timestamp,
              nonce,
              signature,
            },
          ],
        });

      expect(res.status).toBe(200);
      const parsed = zBatchBalanceResponse.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.results.length).toBe(1);
        const result = parsed.data.results[0];
        expect(result.topicId).toBe(topicId);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.balance).toBe(100);
          expect(result.myTotalVotes).toBe(0);
          expect(result.myTotalCost).toBe(0);
        }
      }
    });

    it('should return ok:false with error for invalid signature', async () => {
      const { topicId } = await createTopic(app);
      const user = generateUser();

      const res = await request(app.getHttpServer())
        .post('/v1/user/batch-balance')
        .send({
          items: [
            {
              topicId,
              pubkey: user.pubkeyHex,
              timestamp: Date.now(),
              nonce: randomBytes(16).toString('hex'),
              signature: 'a'.repeat(128), // Invalid signature
            },
          ],
        });

      expect(res.status).toBe(200);
      const parsed = zBatchBalanceResponse.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.results.length).toBe(1);
        const result = parsed.data.results[0];
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe('INVALID_SIGNATURE');
        }
      }
    });

    it('should return ok:false with TOPIC_NOT_FOUND for missing topic', async () => {
      const user = generateUser();
      const missingTopicId = uuidv7();

      // Build valid signature for non-existent topic
      const timestamp = Date.now();
      const nonce = randomBytes(16).toString('hex');
      const itemPath = `/v1/topics/${missingTopicId}/ledger/me`;
      const canonical = `v1|GET|${itemPath}|${timestamp}|${nonce}|`;
      const signature = cryptoSign(null, Buffer.from(canonical, 'utf8'), user.privateKey).toString('hex');

      const res = await request(app.getHttpServer())
        .post('/v1/user/batch-balance')
        .send({
          items: [
            {
              topicId: missingTopicId,
              pubkey: user.pubkeyHex,
              timestamp,
              nonce,
              signature,
            },
          ],
        });

      expect(res.status).toBe(200);
      const parsed = zBatchBalanceResponse.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.results.length).toBe(1);
        const result = parsed.data.results[0];
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe('TOPIC_NOT_FOUND');
        }
      }
    });

    it('should isolate single item failure (one fails, others succeed)', async () => {
      const { topicId: topic1Id } = await createTopic(app);
      const { topicId: topic2Id } = await createTopic(app);
      const user = generateUser();
      const missingTopicId = uuidv7();

      // Build valid signatures
      const buildItem = (tid: string) => {
        const timestamp = Date.now();
        const nonce = randomBytes(16).toString('hex');
        const itemPath = `/v1/topics/${tid}/ledger/me`;
        const canonical = `v1|GET|${itemPath}|${timestamp}|${nonce}|`;
        const signature = cryptoSign(null, Buffer.from(canonical, 'utf8'), user.privateKey).toString('hex');
        return { topicId: tid, pubkey: user.pubkeyHex, timestamp, nonce, signature };
      };

      const res = await request(app.getHttpServer())
        .post('/v1/user/batch-balance')
        .send({
          items: [
            buildItem(topic1Id),       // should succeed
            buildItem(missingTopicId), // should fail (TOPIC_NOT_FOUND)
            buildItem(topic2Id),       // should succeed
          ],
        });

      expect(res.status).toBe(200);
      const parsed = zBatchBalanceResponse.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.results.length).toBe(3);

        const [result1, result2, result3] = parsed.data.results;

        // First item should succeed
        expect(result1.topicId).toBe(topic1Id);
        expect(result1.ok).toBe(true);
        if (result1.ok) expect(result1.balance).toBe(100);

        // Second item should fail
        expect(result2.topicId).toBe(missingTopicId);
        expect(result2.ok).toBe(false);
        if (!result2.ok) expect(result2.error.code).toBe('TOPIC_NOT_FOUND');

        // Third item should succeed (not affected by second item's failure)
        expect(result3.topicId).toBe(topic2Id);
        expect(result3.ok).toBe(true);
        if (result3.ok) expect(result3.balance).toBe(100);
      }
    });

    it('should return correct balance after voting', async () => {
      const { topicId, rootArgumentId } = await createTopic(app);
      const user = generateUser();

      // Vote on root argument (0 -> 4, cost 16)
      const votePath = `/v1/arguments/${rootArgumentId}/votes`;
      const voteBody = JSON.stringify({ targetVotes: 4 });
      const voteHeaders = signHeaders({
        method: 'POST',
        path: votePath,
        rawBody: voteBody,
        privateKey: user.privateKey,
        pubkeyHex: user.pubkeyHex,
      });
      await request(app.getHttpServer())
        .post(votePath)
        .set(voteHeaders)
        .set('Content-Type', 'application/json')
        .send(voteBody)
        .expect(200);

      // Now check batch-balance
      const timestamp = Date.now();
      const nonce = randomBytes(16).toString('hex');
      const itemPath = `/v1/topics/${topicId}/ledger/me`;
      const canonical = `v1|GET|${itemPath}|${timestamp}|${nonce}|`;
      const signature = cryptoSign(null, Buffer.from(canonical, 'utf8'), user.privateKey).toString('hex');

      const res = await request(app.getHttpServer())
        .post('/v1/user/batch-balance')
        .send({
          items: [
            {
              topicId,
              pubkey: user.pubkeyHex,
              timestamp,
              nonce,
              signature,
            },
          ],
        });

      expect(res.status).toBe(200);
      const parsed = zBatchBalanceResponse.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        const result = parsed.data.results[0];
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.balance).toBe(84); // 100 - 16
          expect(result.myTotalVotes).toBe(4);
          expect(result.myTotalCost).toBe(16);
        }
      }
    });

    it('should reject item with timestamp out of range', async () => {
      const { topicId } = await createTopic(app);
      const user = generateUser();

      // Build signature with old timestamp
      const timestamp = Date.now() - 61_000; // 61 seconds ago
      const nonce = randomBytes(16).toString('hex');
      const itemPath = `/v1/topics/${topicId}/ledger/me`;
      const canonical = `v1|GET|${itemPath}|${timestamp}|${nonce}|`;
      const signature = cryptoSign(null, Buffer.from(canonical, 'utf8'), user.privateKey).toString('hex');

      const res = await request(app.getHttpServer())
        .post('/v1/user/batch-balance')
        .send({
          items: [
            {
              topicId,
              pubkey: user.pubkeyHex,
              timestamp,
              nonce,
              signature,
            },
          ],
        });

      expect(res.status).toBe(200);
      const parsed = zBatchBalanceResponse.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        const result = parsed.data.results[0];
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe('TIMESTAMP_OUT_OF_RANGE');
        }
      }
    });
  });
});
