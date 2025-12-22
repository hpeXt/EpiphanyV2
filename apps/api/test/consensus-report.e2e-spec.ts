/**
 * @file consensus-report.e2e-spec.ts
 * @description Step 22 - Consensus report read + host trigger e2e tests
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  zConsensusReportLatestResponse,
  zCreateTopicResponse,
  zErrorResponse,
  zTopicCommandResponse,
} from '@epiphany/shared-contracts';
import { KeyObject } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { createE2eApp, generateEd25519Keypair, makeSignedHeaders } from './e2e-helpers';

describe('Consensus Report API (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /v1/topics/:topicId/consensus-report/latest should return report:null when none exists', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/v1/topics')
      .send({ title: 'Topic for report test', body: 'Root body' })
      .expect(201);

    const createParsed = zCreateTopicResponse.safeParse(createRes.body);
    expect(createParsed.success).toBe(true);
    if (!createParsed.success) return;

    const topicId = createParsed.data.topicId;

    const res = await request(app.getHttpServer())
      .get(`/v1/topics/${topicId}/consensus-report/latest`)
      .expect(200);

    const parsed = zConsensusReportLatestResponse.safeParse(res.body);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.report).toBeNull();
    }
  });

  it('Host command GENERATE_CONSENSUS_REPORT should create a generating latest report', async () => {
    // Create a topic first
    const createRes = await request(app.getHttpServer())
      .post('/v1/topics')
      .send({ title: 'Topic for report trigger', body: 'Root body' })
      .expect(201);

    const createParsed = zCreateTopicResponse.safeParse(createRes.body);
    expect(createParsed.success).toBe(true);
    if (!createParsed.success) return;

    const { topicId, claimToken } = createParsed.data;

    // Claim ownership
    const keypair = generateEd25519Keypair();
    const privateKey: KeyObject = keypair.privateKey;
    const pubkeyHex = keypair.pubkeyHex;

    const claimBody = { type: 'CLAIM_OWNER', payload: {} };
    const claimPath = `/v1/topics/${topicId}/commands`;
    const claimHeaders = makeSignedHeaders({
      method: 'POST',
      path: claimPath,
      body: claimBody,
      privateKey,
      pubkeyHex,
    });

    const claimRes = await request(app.getHttpServer())
      .post(claimPath)
      .set(claimHeaders)
      .set('X-Claim-Token', claimToken)
      .send(claimBody)
      .expect(200);

    expect(zTopicCommandResponse.safeParse(claimRes.body).success).toBe(true);

    // Trigger report generation
    const triggerBody = { type: 'GENERATE_CONSENSUS_REPORT', payload: {} };
    const triggerHeaders = makeSignedHeaders({
      method: 'POST',
      path: claimPath,
      body: triggerBody,
      privateKey,
      pubkeyHex,
    });

    const triggerRes = await request(app.getHttpServer())
      .post(claimPath)
      .set(triggerHeaders)
      .send(triggerBody)
      .expect(200);

    expect(zTopicCommandResponse.safeParse(triggerRes.body).success).toBe(true);

    // Latest report should now exist and be generating
    const latestRes = await request(app.getHttpServer())
      .get(`/v1/topics/${topicId}/consensus-report/latest`)
      .expect(200);

    const latestParsed = zConsensusReportLatestResponse.safeParse(latestRes.body);
    expect(latestParsed.success).toBe(true);
    if (!latestParsed.success) return;

    expect(latestParsed.data.report).not.toBeNull();
    if (!latestParsed.data.report) return;
    expect(latestParsed.data.report.status).toBe('generating');
    expect(latestParsed.data.report.contentMd).toBeNull();
    expect(latestParsed.data.report.computedAt).toBeNull();
  });

  it('GET /v1/topics/:topicId/consensus-report/latest should return 404 TOPIC_NOT_FOUND for unknown topic', async () => {
    const missingTopicId = uuidv7();
    const res = await request(app.getHttpServer())
      .get(`/v1/topics/${missingTopicId}/consensus-report/latest`)
      .expect(404);

    const parsed = zErrorResponse.safeParse(res.body);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.error.code).toBe('TOPIC_NOT_FOUND');
    }
  });
});

