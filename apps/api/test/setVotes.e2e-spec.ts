/**
 * @file setVotes.e2e-spec.ts
 * @description Step 10 - QV setVotes (POST /v1/arguments/:argumentId/votes) e2e tests
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
  zSetVotesResponse,
} from '@epiphany/shared-contracts';

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
    .send({ title: 'E2E::setVotes', body: 'root' })
    .expect(201);

  const parsed = zCreateTopicResponse.safeParse(res.body);
  expect(parsed.success).toBe(true);
  if (!parsed.success) throw new Error('createTopic response contract mismatch');

  return { topicId: parsed.data.topicId, rootArgumentId: parsed.data.rootArgumentId };
}

describe('QV setVotes (e2e)', () => {
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

  it('should require signature (missing headers -> 401 INVALID_SIGNATURE)', async () => {
    const { rootArgumentId } = await createTopic(app);

    const res = await request(app.getHttpServer())
      .post(`/v1/arguments/${rootArgumentId}/votes`)
      .send({ targetVotes: 1 });

    expect(res.status).toBe(401);
    const parsed = zErrorResponse.safeParse(res.body);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.error.code).toBe('INVALID_SIGNATURE');
    }
  });

  it('should reject timestamp out of range -> 401 TIMESTAMP_OUT_OF_RANGE', async () => {
    const { rootArgumentId } = await createTopic(app);
    const user = generateUser();
    const path = `/v1/arguments/${rootArgumentId}/votes`;
    const rawBody = JSON.stringify({ targetVotes: 1 });
    const headers = signHeaders({
      method: 'POST',
      path,
      rawBody,
      privateKey: user.privateKey,
      pubkeyHex: user.pubkeyHex,
      timestampOffsetMs: -61_000,
    });

    const res = await request(app.getHttpServer())
      .post(path)
      .set(headers)
      .set('Content-Type', 'application/json')
      .send(rawBody);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TIMESTAMP_OUT_OF_RANGE');
  });

  it('should return 404 ARGUMENT_NOT_FOUND for missing argument', async () => {
    const user = generateUser();
    const missingArgumentId = uuidv7();
    const path = `/v1/arguments/${missingArgumentId}/votes`;
    const rawBody = JSON.stringify({ targetVotes: 1 });
    const headers = signHeaders({
      method: 'POST',
      path,
      rawBody,
      privateKey: user.privateKey,
      pubkeyHex: user.pubkeyHex,
    });

    const res = await request(app.getHttpServer())
      .post(path)
      .set(headers)
      .set('Content-Type', 'application/json')
      .send(rawBody);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ARGUMENT_NOT_FOUND');
  });

  it('should validate targetVotes (out of range / non-integer) -> 400 BAD_REQUEST', async () => {
    const { rootArgumentId } = await createTopic(app);
    const user = generateUser();
    const path = `/v1/arguments/${rootArgumentId}/votes`;

    for (const rawBody of [JSON.stringify({ targetVotes: 11 }), JSON.stringify({ targetVotes: 1.2 })]) {
      const headers = signHeaders({
        method: 'POST',
        path,
        rawBody,
        privateKey: user.privateKey,
        pubkeyHex: user.pubkeyHex,
      });

      const res = await request(app.getHttpServer())
        .post(path)
        .set(headers)
        .set('Content-Type', 'application/json')
        .send(rawBody);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('BAD_REQUEST');
    }
  });

  it('should handle increase/decrease/withdraw and preserve balance invariant', async () => {
    const { topicId, rootArgumentId } = await createTopic(app);
    const user = generateUser();
    const pubkeyBytes = Buffer.from(user.pubkeyHex, 'hex');
    const path = `/v1/arguments/${rootArgumentId}/votes`;

    // 0 -> 4
    {
      const rawBody = JSON.stringify({ targetVotes: 4 });
      const headers = signHeaders({
        method: 'POST',
        path,
        rawBody,
        privateKey: user.privateKey,
        pubkeyHex: user.pubkeyHex,
      });
      const res = await request(app.getHttpServer())
        .post(path)
        .set(headers)
        .set('Content-Type', 'application/json')
        .send(rawBody)
        .expect(200);

      const parsed = zSetVotesResponse.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;

      expect(parsed.data).toMatchObject({
        argumentId: rootArgumentId,
        previousVotes: 0,
        targetVotes: 4,
        deltaVotes: 4,
        previousCost: 0,
        targetCost: 16,
        deltaCost: 16,
      });
      expect(parsed.data.ledger.balance + parsed.data.ledger.myTotalCost).toBe(100);
      expect(parsed.data.ledger.balance).toBe(84);
      expect(parsed.data.ledger.myTotalVotes).toBe(4);
      expect(parsed.data.ledger.myTotalCost).toBe(16);

      const stake = await prisma.stake.findUnique({
        where: {
          topicId_argumentId_voterPubkey: {
            topicId,
            argumentId: rootArgumentId,
            voterPubkey: pubkeyBytes,
          },
        },
      });
      expect(stake).toMatchObject({ votes: 4, cost: 16 });

      const ledger = await prisma.ledger.findUnique({
        where: { topicId_pubkey: { topicId, pubkey: pubkeyBytes } },
      });
      expect(ledger).toMatchObject({ balance: 84, totalVotesStaked: 4, totalCostStaked: 16 });

      const argument = await prisma.argument.findUnique({
        where: { topicId_id: { topicId, id: rootArgumentId } },
      });
      expect(argument).toMatchObject({ totalVotes: 4, totalCost: 16 });
    }

    // 4 -> 1
    {
      const rawBody = JSON.stringify({ targetVotes: 1 });
      const headers = signHeaders({
        method: 'POST',
        path,
        rawBody,
        privateKey: user.privateKey,
        pubkeyHex: user.pubkeyHex,
      });
      const res = await request(app.getHttpServer())
        .post(path)
        .set(headers)
        .set('Content-Type', 'application/json')
        .send(rawBody)
        .expect(200);

      const parsed = zSetVotesResponse.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;

      expect(parsed.data).toMatchObject({
        argumentId: rootArgumentId,
        previousVotes: 4,
        targetVotes: 1,
        deltaVotes: -3,
        previousCost: 16,
        targetCost: 1,
        deltaCost: -15,
      });
      expect(parsed.data.ledger.balance + parsed.data.ledger.myTotalCost).toBe(100);
      expect(parsed.data.ledger.balance).toBe(99);
      expect(parsed.data.ledger.myTotalVotes).toBe(1);
      expect(parsed.data.ledger.myTotalCost).toBe(1);

      const stake = await prisma.stake.findUnique({
        where: {
          topicId_argumentId_voterPubkey: {
            topicId,
            argumentId: rootArgumentId,
            voterPubkey: pubkeyBytes,
          },
        },
      });
      expect(stake).toMatchObject({ votes: 1, cost: 1 });
    }

    // 1 -> 0 (withdraw; delete stake)
    {
      const rawBody = JSON.stringify({ targetVotes: 0 });
      const headers = signHeaders({
        method: 'POST',
        path,
        rawBody,
        privateKey: user.privateKey,
        pubkeyHex: user.pubkeyHex,
      });
      const res = await request(app.getHttpServer())
        .post(path)
        .set(headers)
        .set('Content-Type', 'application/json')
        .send(rawBody)
        .expect(200);

      const parsed = zSetVotesResponse.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;

      expect(parsed.data).toMatchObject({
        argumentId: rootArgumentId,
        previousVotes: 1,
        targetVotes: 0,
        deltaVotes: -1,
        previousCost: 1,
        targetCost: 0,
        deltaCost: -1,
      });
      expect(parsed.data.ledger.balance + parsed.data.ledger.myTotalCost).toBe(100);
      expect(parsed.data.ledger.balance).toBe(100);
      expect(parsed.data.ledger.myTotalVotes).toBe(0);
      expect(parsed.data.ledger.myTotalCost).toBe(0);

      const stake = await prisma.stake.findUnique({
        where: {
          topicId_argumentId_voterPubkey: {
            topicId,
            argumentId: rootArgumentId,
            voterPubkey: pubkeyBytes,
          },
        },
      });
      expect(stake).toBeNull();
    }
  });

  it('should return 402 INSUFFICIENT_BALANCE and not mutate stake/ledger/totals', async () => {
    const { topicId, rootArgumentId } = await createTopic(app);
    const user = generateUser();
    const pubkeyBytes = Buffer.from(user.pubkeyHex, 'hex');

    // Create a second argument under the root directly in DB (Step 09 not required for Step 10 tests)
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

    // Spend full balance on root (0 -> 10, cost 100)
    {
      const path = `/v1/arguments/${rootArgumentId}/votes`;
      const rawBody = JSON.stringify({ targetVotes: 10 });
      const headers = signHeaders({
        method: 'POST',
        path,
        rawBody,
        privateKey: user.privateKey,
        pubkeyHex: user.pubkeyHex,
      });
      await request(app.getHttpServer())
        .post(path)
        .set(headers)
        .set('Content-Type', 'application/json')
        .send(rawBody)
        .expect(200);
    }

    const ledgerBefore = await prisma.ledger.findUnique({
      where: { topicId_pubkey: { topicId, pubkey: pubkeyBytes } },
    });
    const arg2Before = await prisma.argument.findUnique({
      where: { topicId_id: { topicId, id: secondArgumentId } },
    });
    const stake2Before = await prisma.stake.findUnique({
      where: {
        topicId_argumentId_voterPubkey: {
          topicId,
          argumentId: secondArgumentId,
          voterPubkey: pubkeyBytes,
        },
      },
    });
    expect(stake2Before).toBeNull();

    // Try to stake on second argument (0 -> 1, need cost 1 but balance is 0)
    {
      const path = `/v1/arguments/${secondArgumentId}/votes`;
      const rawBody = JSON.stringify({ targetVotes: 1 });
      const headers = signHeaders({
        method: 'POST',
        path,
        rawBody,
        privateKey: user.privateKey,
        pubkeyHex: user.pubkeyHex,
      });

      const res = await request(app.getHttpServer())
        .post(path)
        .set(headers)
        .set('Content-Type', 'application/json')
        .send(rawBody);

      expect(res.status).toBe(402);
      expect(res.body.error.code).toBe('INSUFFICIENT_BALANCE');
    }

    const ledgerAfter = await prisma.ledger.findUnique({
      where: { topicId_pubkey: { topicId, pubkey: pubkeyBytes } },
    });
    const arg2After = await prisma.argument.findUnique({
      where: { topicId_id: { topicId, id: secondArgumentId } },
    });
    const stake2After = await prisma.stake.findUnique({
      where: {
        topicId_argumentId_voterPubkey: {
          topicId,
          argumentId: secondArgumentId,
          voterPubkey: pubkeyBytes,
        },
      },
    });

    expect(ledgerAfter).toEqual(ledgerBefore);
    expect(arg2After).toEqual(arg2Before);
    expect(stake2After).toBeNull();
  });

  it('should forbid increase when argument is pruned but allow withdraw', async () => {
    const { topicId, rootArgumentId } = await createTopic(app);
    const user = generateUser();
    const pubkeyBytes = Buffer.from(user.pubkeyHex, 'hex');
    const path = `/v1/arguments/${rootArgumentId}/votes`;

    // First stake 0 -> 3
    {
      const rawBody = JSON.stringify({ targetVotes: 3 });
      const headers = signHeaders({
        method: 'POST',
        path,
        rawBody,
        privateKey: user.privateKey,
        pubkeyHex: user.pubkeyHex,
      });
      await request(app.getHttpServer())
        .post(path)
        .set(headers)
        .set('Content-Type', 'application/json')
        .send(rawBody)
        .expect(200);
    }

    // Prune argument
    await prisma.argument.update({
      where: { topicId_id: { topicId, id: rootArgumentId } },
      data: { prunedAt: new Date() },
    });

    // Increase 3 -> 4 forbidden
    {
      const rawBody = JSON.stringify({ targetVotes: 4 });
      const headers = signHeaders({
        method: 'POST',
        path,
        rawBody,
        privateKey: user.privateKey,
        pubkeyHex: user.pubkeyHex,
      });
      const res = await request(app.getHttpServer())
        .post(path)
        .set(headers)
        .set('Content-Type', 'application/json')
        .send(rawBody);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ARGUMENT_PRUNED_INCREASE_FORBIDDEN');

      const stake = await prisma.stake.findUnique({
        where: {
          topicId_argumentId_voterPubkey: {
            topicId,
            argumentId: rootArgumentId,
            voterPubkey: pubkeyBytes,
          },
        },
      });
      expect(stake).toMatchObject({ votes: 3, cost: 9 });
    }

    // Withdraw 3 -> 0 allowed
    {
      const rawBody = JSON.stringify({ targetVotes: 0 });
      const headers = signHeaders({
        method: 'POST',
        path,
        rawBody,
        privateKey: user.privateKey,
        pubkeyHex: user.pubkeyHex,
      });
      const res = await request(app.getHttpServer())
        .post(path)
        .set(headers)
        .set('Content-Type', 'application/json')
        .send(rawBody)
        .expect(200);

      const parsed = zSetVotesResponse.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.ledger.balance + parsed.data.ledger.myTotalCost).toBe(100);
        expect(parsed.data.targetVotes).toBe(0);
      }
    }
  });

  it('should forbid increase when topic is frozen but allow withdraw', async () => {
    const { topicId, rootArgumentId } = await createTopic(app);
    const user = generateUser();
    const path = `/v1/arguments/${rootArgumentId}/votes`;

    // First stake 0 -> 3
    {
      const rawBody = JSON.stringify({ targetVotes: 3 });
      const headers = signHeaders({
        method: 'POST',
        path,
        rawBody,
        privateKey: user.privateKey,
        pubkeyHex: user.pubkeyHex,
      });
      await request(app.getHttpServer())
        .post(path)
        .set(headers)
        .set('Content-Type', 'application/json')
        .send(rawBody)
        .expect(200);
    }

    // Freeze topic
    await prisma.topic.update({
      where: { id: topicId },
      data: { status: 'frozen' },
    });

    // Increase 3 -> 4 forbidden
    {
      const rawBody = JSON.stringify({ targetVotes: 4 });
      const headers = signHeaders({
        method: 'POST',
        path,
        rawBody,
        privateKey: user.privateKey,
        pubkeyHex: user.pubkeyHex,
      });
      const res = await request(app.getHttpServer())
        .post(path)
        .set(headers)
        .set('Content-Type', 'application/json')
        .send(rawBody);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('TOPIC_STATUS_DISALLOWS_WRITE');
    }

    // Withdraw 3 -> 0 allowed
    {
      const rawBody = JSON.stringify({ targetVotes: 0 });
      const headers = signHeaders({
        method: 'POST',
        path,
        rawBody,
        privateKey: user.privateKey,
        pubkeyHex: user.pubkeyHex,
      });
      const res = await request(app.getHttpServer())
        .post(path)
        .set(headers)
        .set('Content-Type', 'application/json')
        .send(rawBody)
        .expect(200);

      const parsed = zSetVotesResponse.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.ledger.balance + parsed.data.ledger.myTotalCost).toBe(100);
        expect(parsed.data.targetVotes).toBe(0);
      }
    }
  });

  it('should be strongly idempotent by (pubkey, nonce) across bodies and arguments (cache success only)', async () => {
    const { topicId, rootArgumentId } = await createTopic(app);
    const user = generateUser();
    const pubkeyBytes = Buffer.from(user.pubkeyHex, 'hex');

    // Create another argument
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

    const sharedNonce = `idemp-${Date.now()}-${randomBytes(6).toString('hex')}`;

    // First request: root 0 -> 2
    const path1 = `/v1/arguments/${rootArgumentId}/votes`;
    const rawBody1 = JSON.stringify({ targetVotes: 2 });
    const headers1 = signHeaders({
      method: 'POST',
      path: path1,
      rawBody: rawBody1,
      privateKey: user.privateKey,
      pubkeyHex: user.pubkeyHex,
      nonce: sharedNonce,
    });
    const res1 = await request(app.getHttpServer())
      .post(path1)
      .set(headers1)
      .set('Content-Type', 'application/json')
      .send(rawBody1)
      .expect(200);

    const parsed1 = zSetVotesResponse.safeParse(res1.body);
    expect(parsed1.success).toBe(true);
    if (!parsed1.success) return;

    // TTL should be ~5min
    const idempKey = `idemp:setVotes:${user.pubkeyHex}:${sharedNonce}`;
    const ttl = await redis.ttl(idempKey);
    expect(ttl).toBeGreaterThanOrEqual(290);

    const ledgerAfter1 = await prisma.ledger.findUnique({
      where: { topicId_pubkey: { topicId, pubkey: pubkeyBytes } },
    });

    // Second request: same nonce, different body (targetVotes=1) => return first response, no DB change
    const rawBody2 = JSON.stringify({ targetVotes: 1 });
    const headers2 = signHeaders({
      method: 'POST',
      path: path1,
      rawBody: rawBody2,
      privateKey: user.privateKey,
      pubkeyHex: user.pubkeyHex,
      nonce: sharedNonce,
    });
    const res2 = await request(app.getHttpServer())
      .post(path1)
      .set(headers2)
      .set('Content-Type', 'application/json')
      .send(rawBody2)
      .expect(200);

    expect(res2.body).toEqual(res1.body);
    const ledgerAfter2 = await prisma.ledger.findUnique({
      where: { topicId_pubkey: { topicId, pubkey: pubkeyBytes } },
    });
    expect(ledgerAfter2).toEqual(ledgerAfter1);

    // Third request: same nonce, different argument => return first response; second argument untouched
    const path3 = `/v1/arguments/${secondArgumentId}/votes`;
    const rawBody3 = JSON.stringify({ targetVotes: 2 });
    const headers3 = signHeaders({
      method: 'POST',
      path: path3,
      rawBody: rawBody3,
      privateKey: user.privateKey,
      pubkeyHex: user.pubkeyHex,
      nonce: sharedNonce,
    });
    const res3 = await request(app.getHttpServer())
      .post(path3)
      .set(headers3)
      .set('Content-Type', 'application/json')
      .send(rawBody3)
      .expect(200);

    expect(res3.body).toEqual(res1.body);

    const stakeOnArg2 = await prisma.stake.findUnique({
      where: {
        topicId_argumentId_voterPubkey: {
          topicId,
          argumentId: secondArgumentId,
          voterPubkey: pubkeyBytes,
        },
      },
    });
    expect(stakeOnArg2).toBeNull();
  });
});

