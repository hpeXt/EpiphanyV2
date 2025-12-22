/**
 * @file risk-control.e2e-spec.ts
 * @description Step 23 - Risk control: rate limiting (pubkey/IP) + topic blacklist (Host-managed)
 */
import { type INestApplication } from '@nestjs/common';
import { type App } from 'supertest/types';
import request from 'supertest';

import {
  zErrorResponse,
  zTopicCommandResponse,
} from '@epiphany/shared-contracts';

import {
  createE2eApp,
  generateEd25519Keypair,
  makeSignedHeaders,
} from './e2e-helpers';

describe('Risk Control (Step 23) (e2e)', () => {
  let app: INestApplication<App>;

  const originalEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const key of [
      'RISK_RL_WINDOW_SECONDS',
      'RISK_RL_CREATE_ARGUMENT_PUBKEY_LIMIT',
      'RISK_RL_CREATE_ARGUMENT_IP_LIMIT',
      'RISK_RL_SET_VOTES_PUBKEY_LIMIT',
      'RISK_RL_SET_VOTES_IP_LIMIT',
      'RISK_RL_COMMANDS_PUBKEY_LIMIT',
      'RISK_RL_COMMANDS_IP_LIMIT',
      'RISK_IP_HASH_SALT',
    ]) {
      originalEnv[key] = process.env[key];
    }

    // Deterministic low limits so we can hit the threshold quickly.
    process.env.RISK_RL_WINDOW_SECONDS = '60';
    process.env.RISK_RL_CREATE_ARGUMENT_PUBKEY_LIMIT = '2';
    process.env.RISK_RL_CREATE_ARGUMENT_IP_LIMIT = '2';
    process.env.RISK_RL_SET_VOTES_PUBKEY_LIMIT = '2';
    process.env.RISK_RL_SET_VOTES_IP_LIMIT = '2';
    process.env.RISK_RL_COMMANDS_PUBKEY_LIMIT = '5';
    process.env.RISK_RL_COMMANDS_IP_LIMIT = '5';
    process.env.RISK_IP_HASH_SALT = 'test-salt';

    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  async function createTopic(): Promise<{
    topicId: string;
    rootArgumentId: string;
    claimToken: string;
  }> {
    const res = await request(app.getHttpServer())
      .post('/v1/topics')
      .send({ title: 'E2E::risk-control', body: 'root' })
      .expect(201);

    expect(typeof res.body.topicId).toBe('string');
    expect(typeof res.body.rootArgumentId).toBe('string');
    expect(typeof res.body.claimToken).toBe('string');

    return {
      topicId: res.body.topicId,
      rootArgumentId: res.body.rootArgumentId,
      claimToken: res.body.claimToken,
    };
  }

  async function claimOwner(params: {
    topicId: string;
    claimToken: string;
    ownerPubkeyHex: string;
    ownerPrivateKey: Parameters<typeof makeSignedHeaders>[0]['privateKey'];
  }) {
    const path = `/v1/topics/${params.topicId}/commands`;
    const body = { type: 'CLAIM_OWNER', payload: {} };
    const headers = makeSignedHeaders({
      method: 'POST',
      path,
      body,
      privateKey: params.ownerPrivateKey,
      pubkeyHex: params.ownerPubkeyHex,
    });

    const res = await request(app.getHttpServer())
      .post(path)
      .set({ ...headers, 'X-Claim-Token': params.claimToken })
      .send(body)
      .expect(200);

    const parsed = zTopicCommandResponse.safeParse(res.body);
    expect(parsed.success).toBe(true);
    return parsed.success ? parsed.data.topic : null;
  }

  it('same pubkey over limit -> 429 RATE_LIMITED (+ Retry-After)', async () => {
    const { topicId, rootArgumentId } = await createTopic();
    const { privateKey, pubkeyHex } = generateEd25519Keypair();
    const path = `/v1/topics/${topicId}/arguments`;
    const body = { parentId: rootArgumentId, title: null, body: 'Hello' };

    for (let i = 0; i < 2; i++) {
      const headers = makeSignedHeaders({
        method: 'POST',
        path,
        body,
        privateKey,
        pubkeyHex,
      });
      await request(app.getHttpServer()).post(path).set(headers).send(body).expect(200);
    }

    const headers3 = makeSignedHeaders({
      method: 'POST',
      path,
      body,
      privateKey,
      pubkeyHex,
    });

    const res = await request(app.getHttpServer())
      .post(path)
      .set(headers3)
      .send(body)
      .expect(429);

    const parsed = zErrorResponse.safeParse(res.body);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.error.code).toBe('RATE_LIMITED');
    }

    expect(res.headers['retry-after']).toBeDefined();
  });

  it('same IP over limit -> 429 RATE_LIMITED (even with different pubkeys)', async () => {
    const { topicId, rootArgumentId } = await createTopic();
    const path = `/v1/topics/${topicId}/arguments`;
    const body = { parentId: rootArgumentId, title: null, body: 'Hello' };

    for (const { privateKey, pubkeyHex } of [
      generateEd25519Keypair(),
      generateEd25519Keypair(),
    ]) {
      const headers = makeSignedHeaders({
        method: 'POST',
        path,
        body,
        privateKey,
        pubkeyHex,
      });
      await request(app.getHttpServer()).post(path).set(headers).send(body).expect(200);
    }

    const third = generateEd25519Keypair();
    const headers3 = makeSignedHeaders({
      method: 'POST',
      path,
      body,
      privateKey: third.privateKey,
      pubkeyHex: third.pubkeyHex,
    });

    const res = await request(app.getHttpServer())
      .post(path)
      .set(headers3)
      .send(body)
      .expect(429);

    const parsed = zErrorResponse.safeParse(res.body);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.error.code).toBe('RATE_LIMITED');
    }
  });

  it('rate limiting does not affect public read', async () => {
    // Even if write endpoints are rate-limited, public read must remain unaffected.
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer()).get('/v1/topics').expect(200);
    }
  });

  it('blacklisted pubkey is rejected on write endpoints with a fixed error code', async () => {
    const { topicId, rootArgumentId, claimToken } = await createTopic();

    const owner = generateEd25519Keypair();
    await claimOwner({
      topicId,
      claimToken,
      ownerPrivateKey: owner.privateKey,
      ownerPubkeyHex: owner.pubkeyHex,
    });

    const blacklisted = generateEd25519Keypair();
    const commandsPath = `/v1/topics/${topicId}/commands`;

    const blacklistBody = {
      type: 'BLACKLIST_PUBKEY',
      payload: { pubkey: blacklisted.pubkeyHex, reason: 'spam' },
    };
    const blacklistHeaders = makeSignedHeaders({
      method: 'POST',
      path: commandsPath,
      body: blacklistBody,
      privateKey: owner.privateKey,
      pubkeyHex: owner.pubkeyHex,
    });

    await request(app.getHttpServer())
      .post(commandsPath)
      .set(blacklistHeaders)
      .send(blacklistBody)
      .expect(200);

    const createArgumentPath = `/v1/topics/${topicId}/arguments`;
    const createArgumentBody = {
      parentId: rootArgumentId,
      title: null,
      body: 'Blocked',
    };
    const blockedHeaders = makeSignedHeaders({
      method: 'POST',
      path: createArgumentPath,
      body: createArgumentBody,
      privateKey: blacklisted.privateKey,
      pubkeyHex: blacklisted.pubkeyHex,
    });

    const res = await request(app.getHttpServer())
      .post(createArgumentPath)
      .set(blockedHeaders)
      .send(createArgumentBody)
      .expect(403);

    const parsed = zErrorResponse.safeParse(res.body);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.error.code).toBe('TOPIC_PUBKEY_BLACKLISTED');
    }
  });

  it('setVotes is rate-limited and returns 429 RATE_LIMITED', async () => {
    const { rootArgumentId } = await createTopic();
    const { privateKey, pubkeyHex } = generateEd25519Keypair();
    const path = `/v1/arguments/${rootArgumentId}/votes`;
    const body = { targetVotes: 1 };

    for (let i = 0; i < 2; i++) {
      const headers = makeSignedHeaders({
        method: 'POST',
        path,
        body,
        privateKey,
        pubkeyHex,
      });
      await request(app.getHttpServer()).post(path).set(headers).send(body).expect(200);
    }

    const headers3 = makeSignedHeaders({
      method: 'POST',
      path,
      body,
      privateKey,
      pubkeyHex,
    });

    const res = await request(app.getHttpServer())
      .post(path)
      .set(headers3)
      .send(body)
      .expect(429);

    const parsed = zErrorResponse.safeParse(res.body);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.error.code).toBe('RATE_LIMITED');
    }
  });
});

