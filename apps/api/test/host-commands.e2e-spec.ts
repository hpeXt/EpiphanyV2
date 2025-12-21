/**
 * @file host-commands.e2e-spec.ts
 * @description Step 21 - Host commands (EDIT_ROOT/SET_STATUS/PRUNE/UNPRUNE) + read-only semantics e2e tests
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import type { KeyObject } from 'node:crypto';
import {
  zArgumentChildrenResponse,
  zCreateArgumentResponse,
  zCreateTopicResponse,
  zErrorResponse,
  zListTopicsResponse,
  zSetVotesResponse,
  zStakesMeResponse,
  zTopicCommandResponse,
  zTopicTreeResponse,
  type TopicCommand,
} from '@epiphany/shared-contracts';
import { RedisService } from '../src/infrastructure/redis.module';
import { createE2eApp, generateEd25519Keypair, makeSignedHeaders } from './e2e-helpers';

type User = { privateKey: KeyObject; pubkeyHex: string };

function topicEventsKey(topicId: string): string {
  return `topic:events:${topicId}`;
}

async function readLastTopicEvent(redis: RedisService, topicId: string): Promise<unknown | null> {
  const entries = await redis.xrevrange(topicEventsKey(topicId), '+', '-', 'COUNT', 1);
  const row = entries?.[0];
  if (!row) return null;
  const fields = row[1] as string[];
  const dataIndex = fields.findIndex((value) => value === 'data');
  if (dataIndex === -1) return null;
  const payload = fields[dataIndex + 1];
  if (!payload) return null;
  return JSON.parse(payload);
}

async function createTopic(app: INestApplication<App>): Promise<{
  topicId: string;
  rootArgumentId: string;
  claimToken: string;
}> {
  const res = await request(app.getHttpServer())
    .post('/v1/topics')
    .send({ title: 'E2E::host-commands', body: 'root' })
    .expect(201);

  const parsed = zCreateTopicResponse.safeParse(res.body);
  expect(parsed.success).toBe(true);
  if (!parsed.success) throw new Error('createTopic response contract mismatch');

  return {
    topicId: parsed.data.topicId,
    rootArgumentId: parsed.data.rootArgumentId,
    claimToken: parsed.data.claimToken,
  };
}

async function claimOwner(app: INestApplication<App>, params: { topicId: string; claimToken: string; host: User }) {
  const body: TopicCommand = { type: 'CLAIM_OWNER', payload: {} };
  const path = `/v1/topics/${params.topicId}/commands`;
  const headers = makeSignedHeaders({
    method: 'POST',
    path,
    body,
    privateKey: params.host.privateKey,
    pubkeyHex: params.host.pubkeyHex,
  });

  const res = await request(app.getHttpServer())
    .post(path)
    .set(headers)
    .set('X-Claim-Token', params.claimToken)
    .send(body)
    .expect(200);

  const parsed = zTopicCommandResponse.safeParse(res.body);
  expect(parsed.success).toBe(true);
  if (parsed.success) {
    expect(parsed.data.topic.ownerPubkey).toBe(params.host.pubkeyHex);
  }
}

function executeTopicCommand(app: INestApplication<App>, params: { topicId: string; command: TopicCommand; signer: User }) {
  const path = `/v1/topics/${params.topicId}/commands`;
  const headers = makeSignedHeaders({
    method: 'POST',
    path,
    body: params.command,
    privateKey: params.signer.privateKey,
    pubkeyHex: params.signer.pubkeyHex,
  });

  return request(app.getHttpServer()).post(path).set(headers).send(params.command);
}

async function createArgument(app: INestApplication<App>, params: { topicId: string; parentId: string; body: string; signer: User }) {
  const body = {
    parentId: params.parentId,
    title: null,
    body: params.body,
    initialVotes: 0,
  };
  const path = `/v1/topics/${params.topicId}/arguments`;
  const headers = makeSignedHeaders({
    method: 'POST',
    path,
    body,
    privateKey: params.signer.privateKey,
    pubkeyHex: params.signer.pubkeyHex,
  });

  const res = await request(app.getHttpServer())
    .post(path)
    .set(headers)
    .send(body)
    .expect(200);

  const parsed = zCreateArgumentResponse.safeParse(res.body);
  expect(parsed.success).toBe(true);
  if (!parsed.success) throw new Error('createArgument response contract mismatch');
  return parsed.data.argument.id;
}

function setVotes(app: INestApplication<App>, params: { argumentId: string; topicId: string; targetVotes: number; signer: User }) {
  const body = { targetVotes: params.targetVotes };
  const path = `/v1/arguments/${params.argumentId}/votes`;
  const headers = makeSignedHeaders({
    method: 'POST',
    path,
    body,
    privateKey: params.signer.privateKey,
    pubkeyHex: params.signer.pubkeyHex,
  });

  return request(app.getHttpServer()).post(path).set(headers).send(body);
}

describe('Host commands + read-only semantics (e2e)', () => {
  let app: INestApplication<App>;
  let redis: RedisService;

  beforeAll(async () => {
    app = await createE2eApp();
    redis = app.get(RedisService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects non-owner commands -> 403 NOT_TOPIC_OWNER', async () => {
    const { topicId, claimToken } = await createTopic(app);
    const host = generateEd25519Keypair();
    const stranger = generateEd25519Keypair();
    await claimOwner(app, { topicId, claimToken, host });

    const res = await executeTopicCommand(app, {
      topicId,
      signer: stranger,
      command: { type: 'SET_STATUS', payload: { status: 'frozen' } },
    });

    expect(res.status).toBe(403);
    const parsed = zErrorResponse.safeParse(res.body);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.error.code).toBe('NOT_TOPIC_OWNER');
    }
  });

  it('validates command payload -> 400 BAD_REQUEST', async () => {
    const { topicId, claimToken } = await createTopic(app);
    const host = generateEd25519Keypair();
    await claimOwner(app, { topicId, claimToken, host });

    const command = { type: 'SET_STATUS', payload: {} } as unknown as TopicCommand;
    const res = await executeTopicCommand(app, { topicId, signer: host, command });

    expect(res.status).toBe(400);
    const parsed = zErrorResponse.safeParse(res.body);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.error.code).toBe('BAD_REQUEST');
    }
  });

  it('enforces Topic status restrictions on commands (active/frozen/archived)', async () => {
    const { topicId, claimToken, rootArgumentId } = await createTopic(app);
    const host = generateEd25519Keypair();
    await claimOwner(app, { topicId, claimToken, host });

    // active -> frozen OK
    await executeTopicCommand(app, {
      topicId,
      signer: host,
      command: { type: 'SET_STATUS', payload: { status: 'frozen' } },
    }).expect(200);

    // frozen: only allow SET_STATUS(active)
    await executeTopicCommand(app, {
      topicId,
      signer: host,
      command: { type: 'EDIT_ROOT', payload: { title: 'x', body: 'y' } },
    }).expect(409);

    // unfreeze OK
    await executeTopicCommand(app, {
      topicId,
      signer: host,
      command: { type: 'SET_STATUS', payload: { status: 'active' } },
    }).expect(200);

    // active -> archived OK
    await executeTopicCommand(app, {
      topicId,
      signer: host,
      command: { type: 'SET_STATUS', payload: { status: 'archived' } },
    }).expect(200);

    // archived: no commands allowed (including SET_STATUS)
    const archivedRes = await executeTopicCommand(app, {
      topicId,
      signer: host,
      command: { type: 'SET_STATUS', payload: { status: 'active' } },
    });

    expect(archivedRes.status).toBe(409);
    expect(archivedRes.body.error.code).toBe('TOPIC_STATUS_DISALLOWS_WRITE');

    // Ensure read path still works while archived
    const treeRes = await request(app.getHttpServer())
      .get(`/v1/topics/${topicId}/tree?depth=1`)
      .expect(200);
    const parsedTree = zTopicTreeResponse.safeParse(treeRes.body);
    expect(parsedTree.success).toBe(true);
    if (parsedTree.success) {
      expect(parsedTree.data.topic.rootArgumentId).toBe(rootArgumentId);
    }
  });

  it('EDIT_ROOT updates root + topic title and publishes SSE topic_updated(root_edited)', async () => {
    const resCreate = await request(app.getHttpServer())
      .post('/v1/topics')
      .send({ title: 'Old title', body: 'Old body' })
      .expect(201);

    const created = zCreateTopicResponse.parse(resCreate.body);
    const host = generateEd25519Keypair();
    await claimOwner(app, { topicId: created.topicId, claimToken: created.claimToken, host });

    await redis.del(topicEventsKey(created.topicId));

    const edit = await executeTopicCommand(app, {
      topicId: created.topicId,
      signer: host,
      command: { type: 'EDIT_ROOT', payload: { title: 'New title', body: 'New body' } },
    });

    expect(edit.status).toBe(200);
    const parsed = zTopicCommandResponse.safeParse(edit.body);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.topic.title).toBe('New title');
    }

    // Tree returns updated root content
    const treeRes = await request(app.getHttpServer())
      .get(`/v1/topics/${created.topicId}/tree?depth=1`)
      .expect(200);
    const tree = zTopicTreeResponse.parse(treeRes.body);
    expect(tree.arguments[0]?.id).toBe(created.rootArgumentId);
    expect(tree.arguments[0]?.title).toBe('New title');
    expect(tree.arguments[0]?.body).toBe('New body');

    // List uses Topic.title cache
    const listRes = await request(app.getHttpServer()).get('/v1/topics?limit=50').expect(200);
    const list = zListTopicsResponse.parse(listRes.body);
    const item = list.items.find((t) => t.id === created.topicId);
    expect(item?.title).toBe('New title');

    const lastEvent = await readLastTopicEvent(redis, created.topicId);
    expect(lastEvent).toMatchObject({
      event: 'topic_updated',
      data: { topicId: created.topicId, reason: 'root_edited' },
    });
  });

  it('SET_STATUS publishes SSE topic_updated(status_changed) and enforces read-only writes', async () => {
    const { topicId, claimToken, rootArgumentId } = await createTopic(app);
    const host = generateEd25519Keypair();
    const user = generateEd25519Keypair();
    await claimOwner(app, { topicId, claimToken, host });

    const childId = await createArgument(app, {
      topicId,
      parentId: rootArgumentId,
      body: 'child',
      signer: user,
    });

    // Ensure withdraw remains possible after frozen
    await setVotes(app, { topicId, argumentId: childId, targetVotes: 2, signer: user }).expect(200);

    await redis.del(topicEventsKey(topicId));

    await executeTopicCommand(app, {
      topicId,
      signer: host,
      command: { type: 'SET_STATUS', payload: { status: 'frozen' } },
    }).expect(200);

    const lastEvent = await readLastTopicEvent(redis, topicId);
    expect(lastEvent).toMatchObject({
      event: 'topic_updated',
      data: { topicId, reason: 'status_changed' },
    });

    // createArgument rejected
    const createBody = { parentId: rootArgumentId, title: null, body: 'nope', initialVotes: 0 };
    const createPath = `/v1/topics/${topicId}/arguments`;
    const createHeaders = makeSignedHeaders({
      method: 'POST',
      path: createPath,
      body: createBody,
      privateKey: user.privateKey,
      pubkeyHex: user.pubkeyHex,
    });
    const createRes = await request(app.getHttpServer()).post(createPath).set(createHeaders).send(createBody);
    expect(createRes.status).toBe(409);
    expect(createRes.body.error.code).toBe('TOPIC_STATUS_DISALLOWS_WRITE');

    // setVotes increase rejected, withdraw allowed
    const incRes = await setVotes(app, { topicId, argumentId: childId, targetVotes: 3, signer: user });
    expect(incRes.status).toBe(409);
    expect(incRes.body.error.code).toBe('TOPIC_STATUS_DISALLOWS_WRITE');

    const withdrawRes = await setVotes(app, { topicId, argumentId: childId, targetVotes: 0, signer: user });
    expect(withdrawRes.status).toBe(200);
    const parsedWithdraw = zSetVotesResponse.safeParse(withdrawRes.body);
    expect(parsedWithdraw.success).toBe(true);
  });

  it('PRUNE_ARGUMENT hides from public read, keeps stakes/me, blocks increase, publishes SSE argument_updated(pruned)', async () => {
    const { topicId, claimToken, rootArgumentId } = await createTopic(app);
    const host = generateEd25519Keypair();
    const voter = generateEd25519Keypair();
    await claimOwner(app, { topicId, claimToken, host });

    const childId = await createArgument(app, {
      topicId,
      parentId: rootArgumentId,
      body: 'to prune',
      signer: voter,
    });

    await setVotes(app, { topicId, argumentId: childId, targetVotes: 2, signer: voter }).expect(200);

    // isolate event assertions from voting events
    await redis.del(topicEventsKey(topicId));

    await executeTopicCommand(app, {
      topicId,
      signer: host,
      command: { type: 'PRUNE_ARGUMENT', payload: { argumentId: childId, reason: 'spam' } },
    }).expect(200);

    const pruneEvent = await readLastTopicEvent(redis, topicId);
    expect(pruneEvent).toMatchObject({
      event: 'argument_updated',
      data: { argumentId: childId, reason: 'pruned' },
    });

    // public tree does not include pruned node
    const treeRes = await request(app.getHttpServer())
      .get(`/v1/topics/${topicId}/tree?depth=3`)
      .expect(200);
    const tree = zTopicTreeResponse.parse(treeRes.body);
    expect(tree.arguments.some((arg) => arg.id === childId)).toBe(false);

    // public children does not include pruned node
    const childrenRes = await request(app.getHttpServer())
      .get(`/v1/arguments/${rootArgumentId}/children?orderBy=createdAt_desc&limit=30`)
      .expect(200);
    const children = zArgumentChildrenResponse.parse(childrenRes.body);
    expect(children.items.some((arg) => arg.id === childId)).toBe(false);

    // stakes/me still includes pruned stake + argumentPrunedAt
    const stakesPath = `/v1/topics/${topicId}/stakes/me`;
    const stakesHeaders = makeSignedHeaders({
      method: 'GET',
      path: stakesPath,
      body: null,
      privateKey: voter.privateKey,
      pubkeyHex: voter.pubkeyHex,
    });
    const stakesRes = await request(app.getHttpServer()).get(stakesPath).set(stakesHeaders).expect(200);
    const stakes = zStakesMeResponse.parse(stakesRes.body);
    const item = stakes.items.find((s) => s.argumentId === childId);
    expect(item?.votes).toBe(2);
    expect(item?.argumentPrunedAt).toEqual(expect.any(String));

    // pruned: increase forbidden
    const incRes = await setVotes(app, { topicId, argumentId: childId, targetVotes: 3, signer: voter });
    expect(incRes.status).toBe(409);
    expect(incRes.body.error.code).toBe('ARGUMENT_PRUNED_INCREASE_FORBIDDEN');

    // withdraw allowed
    const withdrawRes = await setVotes(app, { topicId, argumentId: childId, targetVotes: 0, signer: voter });
    expect(withdrawRes.status).toBe(200);
  });

  it('UNPRUNE_ARGUMENT restores public visibility', async () => {
    const { topicId, claimToken, rootArgumentId } = await createTopic(app);
    const host = generateEd25519Keypair();
    const user = generateEd25519Keypair();
    await claimOwner(app, { topicId, claimToken, host });

    const childId = await createArgument(app, {
      topicId,
      parentId: rootArgumentId,
      body: 'temporarily hidden',
      signer: user,
    });

    await executeTopicCommand(app, {
      topicId,
      signer: host,
      command: { type: 'PRUNE_ARGUMENT', payload: { argumentId: childId, reason: null } },
    }).expect(200);

    const hidden = await request(app.getHttpServer())
      .get(`/v1/arguments/${rootArgumentId}/children?orderBy=createdAt_desc&limit=30`)
      .expect(200);
    const hiddenParsed = zArgumentChildrenResponse.parse(hidden.body);
    expect(hiddenParsed.items.some((arg) => arg.id === childId)).toBe(false);

    await executeTopicCommand(app, {
      topicId,
      signer: host,
      command: { type: 'UNPRUNE_ARGUMENT', payload: { argumentId: childId } },
    }).expect(200);

    const restored = await request(app.getHttpServer())
      .get(`/v1/arguments/${rootArgumentId}/children?orderBy=createdAt_desc&limit=30`)
      .expect(200);
    const restoredParsed = zArgumentChildrenResponse.parse(restored.body);
    expect(restoredParsed.items.some((arg) => arg.id === childId)).toBe(true);
  });
});
