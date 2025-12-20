/**
 * @file topic.e2e-spec.ts
 * @description Step 07 - Topic CRUD e2e tests
 *
 * TDD Red tests for:
 * - POST /v1/topics (create topic + root + claimToken)
 * - POST /v1/topics/:topicId/commands (CLAIM_OWNER)
 * - GET /v1/topics (list with beforeId/nextBeforeId pagination)
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import {
  zCreateTopicResponse,
  zListTopicsResponse,
  zTopicCommandResponse,
  zErrorResponse,
} from '@epiphany/shared-contracts';
import {
  createHash,
  randomBytes,
  generateKeyPairSync,
  sign as cryptoSign,
  KeyObject,
} from 'node:crypto';

interface TopicListItem {
  id: string;
  createdAt: string;
}

describe('Topic API (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /v1/topics', () => {
    it('should create topic and return topicId/rootArgumentId/claimToken/expiresAt', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/topics')
        .send({ title: 'Test Topic', body: 'This is the root argument body' })
        .expect(201);

      // Validate response against contract schema
      const parsed = zCreateTopicResponse.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;

      expect(parsed.data.topicId).toBeDefined();
      expect(parsed.data.rootArgumentId).toBeDefined();
      expect(parsed.data.claimToken).toBeDefined();
      expect(parsed.data.expiresAt).toBeDefined();

      // expiresAt should be ISO and in the future
      const expiresAt = new Date(parsed.data.expiresAt);
      expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('should return 400 BAD_REQUEST when title is missing', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/topics')
        .send({ body: 'Only body, no title' })
        .expect(400);

      const parsed = zErrorResponse.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.error.code).toBe('BAD_REQUEST');
      }
    });

    it('should return 400 BAD_REQUEST when body is missing', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/topics')
        .send({ title: 'Only title, no body' })
        .expect(400);

      const parsed = zErrorResponse.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.error.code).toBe('BAD_REQUEST');
      }
    });

    it('should return 400 BAD_REQUEST when title is empty string', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/topics')
        .send({ title: '', body: 'Some body' })
        .expect(400);

      const parsed = zErrorResponse.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.error.code).toBe('BAD_REQUEST');
      }
    });

    it('should return 400 BAD_REQUEST when body is empty string', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/topics')
        .send({ title: 'Some title', body: '' })
        .expect(400);

      const parsed = zErrorResponse.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.error.code).toBe('BAD_REQUEST');
      }
    });
  });

  describe('POST /v1/topics/:topicId/commands (CLAIM_OWNER)', () => {
    let topicId: string;
    let claimToken: string;
    let privateKey: KeyObject;
    let pubkeyHex: string;

    beforeEach(async () => {
      // Create a topic first
      const res = await request(app.getHttpServer())
        .post('/v1/topics')
        .send({ title: 'Topic for claim test', body: 'Root body' })
        .expect(201);

      topicId = res.body.topicId;
      claimToken = res.body.claimToken;

      // Generate a keypair for signing using Node.js crypto
      const keypair = generateKeyPairSync('ed25519');
      privateKey = keypair.privateKey;
      // Export raw public key (32 bytes)
      const pubkeyBuffer = keypair.publicKey.export({ type: 'spki', format: 'der' });
      // Skip the DER header (12 bytes) to get raw 32-byte public key
      pubkeyHex = (pubkeyBuffer as Buffer).subarray(12).toString('hex');
    });

    function signRequest(
      method: string,
      path: string,
      body: object | null,
      privKey: KeyObject,
      pubHex: string,
    ): {
      'X-Pubkey': string;
      'X-Signature': string;
      'X-Timestamp': string;
      'X-Nonce': string;
    } {
      const timestamp = Date.now().toString();
      const nonce = randomBytes(16).toString('hex');
      const bodyStr = body ? JSON.stringify(body) : '';
      const bodyHash = bodyStr
        ? createHash('sha256').update(bodyStr).digest('hex')
        : '';

      const canonical = `v1|${method}|${path}|${timestamp}|${nonce}|${bodyHash}`;
      const signature = cryptoSign(null, Buffer.from(canonical, 'utf8'), privKey);

      return {
        'X-Pubkey': pubHex,
        'X-Signature': signature.toString('hex'),
        'X-Timestamp': timestamp,
        'X-Nonce': nonce,
      };
    }

    it('should claim owner with valid token and signature', async () => {
      const body = { type: 'CLAIM_OWNER', payload: {} };
      const path = `/v1/topics/${topicId}/commands`;
      const headers = signRequest('POST', path, body, privateKey, pubkeyHex);

      const res = await request(app.getHttpServer())
        .post(path)
        .set(headers)
        .set('X-Claim-Token', claimToken)
        .send(body)
        .expect(200);

      const parsed = zTopicCommandResponse.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.topic.ownerPubkey).toBe(pubkeyHex);
      }
    });

    it('should return 400 CLAIM_TOKEN_INVALID when token is reused', async () => {
      const body = { type: 'CLAIM_OWNER', payload: {} };
      const path = `/v1/topics/${topicId}/commands`;
      const headers = signRequest('POST', path, body, privateKey, pubkeyHex);

      // First claim should succeed
      await request(app.getHttpServer())
        .post(path)
        .set(headers)
        .set('X-Claim-Token', claimToken)
        .send(body)
        .expect(200);

      // Second claim with same token should fail
      const headers2 = signRequest('POST', path, body, privateKey, pubkeyHex);
      const res = await request(app.getHttpServer())
        .post(path)
        .set(headers2)
        .set('X-Claim-Token', claimToken)
        .send(body)
        .expect(400);

      const parsed = zErrorResponse.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.error.code).toBe('CLAIM_TOKEN_INVALID');
      }
    });

    it('should return 400 CLAIM_TOKEN_INVALID when token is wrong', async () => {
      const body = { type: 'CLAIM_OWNER', payload: {} };
      const path = `/v1/topics/${topicId}/commands`;
      const headers = signRequest('POST', path, body, privateKey, pubkeyHex);

      const res = await request(app.getHttpServer())
        .post(path)
        .set(headers)
        .set('X-Claim-Token', 'wrong-token-value')
        .send(body)
        .expect(400);

      const parsed = zErrorResponse.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.error.code).toBe('CLAIM_TOKEN_INVALID');
      }
    });

    it('should return 401 INVALID_SIGNATURE without signature headers', async () => {
      const body = { type: 'CLAIM_OWNER', payload: {} };
      const path = `/v1/topics/${topicId}/commands`;

      const res = await request(app.getHttpServer())
        .post(path)
        .set('X-Claim-Token', claimToken)
        .send(body)
        .expect(401);

      const parsed = zErrorResponse.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.error.code).toBe('INVALID_SIGNATURE');
      }
    });

    it('should consume token after successful claim (cannot claim again)', async () => {
      const body = { type: 'CLAIM_OWNER', payload: {} };
      const path = `/v1/topics/${topicId}/commands`;
      const headers = signRequest('POST', path, body, privateKey, pubkeyHex);

      // First claim
      await request(app.getHttpServer())
        .post(path)
        .set(headers)
        .set('X-Claim-Token', claimToken)
        .send(body)
        .expect(200);

      // Another user tries to claim with same token
      const newKeypair = generateKeyPairSync('ed25519');
      const newPubkeyBuffer = newKeypair.publicKey.export({ type: 'spki', format: 'der' });
      const newPubkeyHex = (newPubkeyBuffer as Buffer).subarray(12).toString('hex');
      const headers2 = signRequest('POST', path, body, newKeypair.privateKey, newPubkeyHex);

      const res = await request(app.getHttpServer())
        .post(path)
        .set(headers2)
        .set('X-Claim-Token', claimToken)
        .send(body)
        .expect(400);

      const parsed = zErrorResponse.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.error.code).toBe('CLAIM_TOKEN_INVALID');
      }
    });
  });

  describe('GET /v1/topics', () => {
    beforeAll(async () => {
      // Create several topics for pagination testing
      for (let i = 0; i < 5; i++) {
        await request(app.getHttpServer())
          .post('/v1/topics')
          .send({ title: `Pagination Topic ${i}`, body: `Body ${i}` })
          .expect(201);
      }
    });

    it('should return topics list with items and nextBeforeId', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/topics')
        .expect(200);

      const parsed = zListTopicsResponse.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(Array.isArray(parsed.data.items)).toBe(true);
        expect(parsed.data.items.length).toBeGreaterThan(0);
        // nextBeforeId can be null or string
        expect(
          parsed.data.nextBeforeId === null ||
            typeof parsed.data.nextBeforeId === 'string',
        ).toBe(true);
      }
    });

    it('should respect limit parameter (default 20, max 100)', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/topics?limit=2')
        .expect(200);

      const parsed = zListTopicsResponse.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.items.length).toBeLessThanOrEqual(2);
      }
    });

    it('should clamp limit > 100 or return 400', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/topics?limit=200')
        .expect((response) => {
          // Either 200 with clamped result or 400
          expect([200, 400]).toContain(response.status);
        });

      if (res.status === 200) {
        const parsed = zListTopicsResponse.safeParse(res.body);
        expect(parsed.success).toBe(true);
        if (parsed.success) {
          expect(parsed.data.items.length).toBeLessThanOrEqual(100);
        }
      } else {
        const parsed = zErrorResponse.safeParse(res.body);
        expect(parsed.success).toBe(true);
      }
    });

    it('should support beforeId cursor for stable pagination', async () => {
      // Get first page
      const res1 = await request(app.getHttpServer())
        .get('/v1/topics?limit=2')
        .expect(200);

      const parsed1 = zListTopicsResponse.parse(res1.body);
      const firstPageIds = parsed1.items.map((t: TopicListItem) => t.id);

      if (parsed1.nextBeforeId) {
        // Get second page
        const res2 = await request(app.getHttpServer())
          .get(`/v1/topics?limit=2&beforeId=${parsed1.nextBeforeId}`)
          .expect(200);

        const parsed2 = zListTopicsResponse.parse(res2.body);
        const secondPageIds = parsed2.items.map((t: TopicListItem) => t.id);

        // No overlap between pages
        for (const id of secondPageIds) {
          expect(firstPageIds).not.toContain(id);
        }
      }
    });

    it('should order by createdAt_desc by default', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/topics')
        .expect(200);

      const parsed = zListTopicsResponse.parse(res.body);
      if (parsed.items.length >= 2) {
        const dates = parsed.items.map((t: TopicListItem) => new Date(t.createdAt).getTime());
        for (let i = 1; i < dates.length; i++) {
          expect(dates[i - 1]).toBeGreaterThanOrEqual(dates[i]);
        }
      }
    });
  });
});
