/**
 * @file auth.e2e-spec.ts
 * @description E2E tests for API authentication guard (Step 06)
 *
 * Tests cover:
 * - Missing signature → 401 INVALID_SIGNATURE
 * - Timestamp out of window → 401 TIMESTAMP_OUT_OF_RANGE
 * - Nonce replay → 409 NONCE_REPLAY
 * - Raw body hash verification
 * - PATH canonicalization (no query string)
 * - Error response structure
 * - Header validation
 */
import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Module,
  Injectable,
} from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createHash, createPrivateKey, sign } from 'crypto';

import { AuthGuard } from '../src/auth/auth.guard';
import { NonceService } from '../src/auth/nonce.service';
import { AllExceptionsFilter } from '../src/filters/all-exceptions.filter';
import { RawBodyMiddleware } from '../src/middleware/raw-body.middleware';

// ─────────────────────────────────────────────────────────────────────────────
// Test fixtures - Using test vectors from docs/stage01/crypto.md
// ─────────────────────────────────────────────────────────────────────────────

// Ed25519 seed from docs/stage01/crypto.md test vectors
const TEST_SEED_HEX =
  'bd923ee263d27b04fd56910eb07dc4c883b5f860625d188e0e14e95cb81c18d6';
// Expected pubkey from docs/stage01/crypto.md test vectors
const TEST_PUBKEY =
  'bc0f74935a3f33f1d2486174d9487611a65965dc2d699d7d911f84d1d4cd0cc9';

// Create Ed25519 private key from seed
function createEd25519PrivateKey(seedHex: string) {
  const seed = Buffer.from(seedHex, 'hex');
  // Ed25519 private key PKCS#8 DER prefix + seed
  const pkcs8Prefix = Buffer.from(
    '302e020100300506032b657004220420',
    'hex',
  );
  return createPrivateKey({
    key: Buffer.concat([pkcs8Prefix, seed]),
    format: 'der',
    type: 'pkcs8',
  });
}

const TEST_PRIVATE_KEY = createEd25519PrivateKey(TEST_SEED_HEX);

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

function buildCanonicalMessage(opts: {
  method: string;
  path: string;
  timestamp: number;
  nonce: string;
  rawBody?: string | null;
}): string {
  const bodyHash = opts.rawBody ? sha256Hex(opts.rawBody) : '';
  return `v1|${opts.method.toUpperCase()}|${opts.path}|${opts.timestamp}|${opts.nonce}|${bodyHash}`;
}

function signMessage(message: string): string {
  const messageBytes = Buffer.from(message, 'utf8');
  const signature = sign(null, messageBytes, TEST_PRIVATE_KEY);
  return signature.toString('hex');
}

function makeSignedHeaders(opts: {
  method: string;
  path: string;
  rawBody?: string | null;
  timestampOffset?: number;
  nonce?: string;
}): Record<string, string> {
  const timestamp = Date.now() + (opts.timestampOffset ?? 0);
  const nonce = opts.nonce ?? Math.random().toString(36).slice(2);
  const canonical = buildCanonicalMessage({
    method: opts.method,
    path: opts.path,
    timestamp,
    nonce,
    rawBody: opts.rawBody,
  });
  const signature = signMessage(canonical);

  return {
    'X-Pubkey': TEST_PUBKEY,
    'X-Signature': signature,
    'X-Timestamp': String(timestamp),
    'X-Nonce': nonce,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock NonceService using in-memory Map (for testing without Redis)
// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
class MockNonceService {
  private usedNonces = new Map<string, number>();

  async checkAndMarkNonce(nonce: string): Promise<boolean> {
    if (this.usedNonces.has(nonce)) {
      return false;
    }
    this.usedNonces.set(nonce, Date.now());
    return true;
  }

  clear() {
    this.usedNonces.clear();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Test-only protected controller (not exposed in production)
// ─────────────────────────────────────────────────────────────────────────────

@Controller('v1/test')
@UseGuards(AuthGuard)
class TestProtectedController {
  @Get('ping')
  ping() {
    return { ok: true };
  }

  @Post('echo')
  echo(@Body() body: any) {
    return { ok: true, body };
  }
}

@Module({
  controllers: [TestProtectedController],
  providers: [
    AuthGuard,
    { provide: NonceService, useClass: MockNonceService },
  ],
})
class TestModule {}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('AuthGuard (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [TestModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    // Apply raw body middleware
    app.use(RawBodyMiddleware);

    // Apply global exception filter
    app.useGlobalFilters(new AllExceptionsFilter());

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 1. Missing signature → 401 INVALID_SIGNATURE
  // ─────────────────────────────────────────────────────────────────────────

  describe('Missing/Invalid Signature', () => {
    it('should return 401 INVALID_SIGNATURE when no signature headers', async () => {
      const res = await request(app.getHttpServer()).get('/v1/test/ping');

      expect(res.status).toBe(401);
      expect(res.body).toEqual({
        error: {
          code: 'INVALID_SIGNATURE',
          message: expect.any(String),
        },
      });
    });

    it('should return 401 INVALID_SIGNATURE when signature is wrong', async () => {
      const headers = makeSignedHeaders({
        method: 'GET',
        path: '/v1/test/ping',
      });
      headers['X-Signature'] = 'a'.repeat(128); // wrong signature

      const res = await request(app.getHttpServer())
        .get('/v1/test/ping')
        .set(headers);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_SIGNATURE');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. Timestamp out of window → 401 TIMESTAMP_OUT_OF_RANGE
  // ─────────────────────────────────────────────────────────────────────────

  describe('Timestamp Window', () => {
    it('should return 401 TIMESTAMP_OUT_OF_RANGE when timestamp is too old', async () => {
      const headers = makeSignedHeaders({
        method: 'GET',
        path: '/v1/test/ping',
        timestampOffset: -61_000, // 61 seconds in the past
      });

      const res = await request(app.getHttpServer())
        .get('/v1/test/ping')
        .set(headers);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('TIMESTAMP_OUT_OF_RANGE');
    });

    it('should return 401 TIMESTAMP_OUT_OF_RANGE when timestamp is too far in future', async () => {
      const headers = makeSignedHeaders({
        method: 'GET',
        path: '/v1/test/ping',
        timestampOffset: 61_000, // 61 seconds in the future
      });

      const res = await request(app.getHttpServer())
        .get('/v1/test/ping')
        .set(headers);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('TIMESTAMP_OUT_OF_RANGE');
    });

    it('should accept timestamp within 60 second window', async () => {
      const headers = makeSignedHeaders({
        method: 'GET',
        path: '/v1/test/ping',
        timestampOffset: 30_000, // 30 seconds in the future
      });

      const res = await request(app.getHttpServer())
        .get('/v1/test/ping')
        .set(headers);

      expect(res.status).toBe(200);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. Nonce replay → 409 NONCE_REPLAY
  // ─────────────────────────────────────────────────────────────────────────

  describe('Nonce Replay Protection', () => {
    it('should return 409 NONCE_REPLAY when same nonce is used twice', async () => {
      const fixedNonce = 'test-nonce-' + Date.now();

      // First request should succeed
      const headers1 = makeSignedHeaders({
        method: 'GET',
        path: '/v1/test/ping',
        nonce: fixedNonce,
      });

      const res1 = await request(app.getHttpServer())
        .get('/v1/test/ping')
        .set(headers1);

      expect(res1.status).toBe(200);

      // Second request with same nonce should fail
      const headers2 = makeSignedHeaders({
        method: 'GET',
        path: '/v1/test/ping',
        nonce: fixedNonce,
      });

      const res2 = await request(app.getHttpServer())
        .get('/v1/test/ping')
        .set(headers2);

      expect(res2.status).toBe(409);
      expect(res2.body.error.code).toBe('NONCE_REPLAY');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 4. Raw body hash verification
  // ─────────────────────────────────────────────────────────────────────────

  describe('Raw Body Hash', () => {
    it('should verify signature based on raw body string', async () => {
      const rawBody = '{"targetVotes":3}';
      const headers = makeSignedHeaders({
        method: 'POST',
        path: '/v1/test/echo',
        rawBody,
      });

      const res = await request(app.getHttpServer())
        .post('/v1/test/echo')
        .set(headers)
        .set('Content-Type', 'application/json')
        .send(rawBody);

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ ok: true, body: { targetVotes: 3 } });
    });

    it('should reject when body is modified after signing', async () => {
      const signedBody = '{"targetVotes":3}';
      const modifiedBody = '{"targetVotes":  3}'; // added space

      const headers = makeSignedHeaders({
        method: 'POST',
        path: '/v1/test/echo',
        rawBody: signedBody,
      });

      const res = await request(app.getHttpServer())
        .post('/v1/test/echo')
        .set(headers)
        .set('Content-Type', 'application/json')
        .send(modifiedBody);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_SIGNATURE');
    });

    it('should produce different hashes for same JSON with different formatting', async () => {
      // These are semantically equal JSON but different raw strings
      const body1 = '{"a":1,"b":2}';
      const body2 = '{"b":2,"a":1}';

      const hash1 = sha256Hex(body1);
      const hash2 = sha256Hex(body2);

      expect(hash1).not.toBe(hash2);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 5. PATH canonicalization (no query string)
  // ─────────────────────────────────────────────────────────────────────────

  describe('PATH Canonicalization', () => {
    it('should verify signature based on PATH without query string', async () => {
      // Sign with path only (no query string)
      const headers = makeSignedHeaders({
        method: 'GET',
        path: '/v1/test/ping',
      });

      // Request with query string should still pass (query not in canonical)
      const res = await request(app.getHttpServer())
        .get('/v1/test/ping?foo=bar&baz=123')
        .set(headers);

      expect(res.status).toBe(200);
    });

    it('should accept same signature for different query strings', async () => {
      const headers = makeSignedHeaders({
        method: 'GET',
        path: '/v1/test/ping',
      });

      const res1 = await request(app.getHttpServer())
        .get('/v1/test/ping?a=1')
        .set(headers);

      // Use different nonce to avoid replay protection
      const headers2 = makeSignedHeaders({
        method: 'GET',
        path: '/v1/test/ping',
      });

      const res2 = await request(app.getHttpServer())
        .get('/v1/test/ping?a=2')
        .set(headers2);

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 6. Error response structure
  // ─────────────────────────────────────────────────────────────────────────

  describe('Error Response Structure', () => {
    it('should return error in correct structure: { error: { code, message, details? } }', async () => {
      const res = await request(app.getHttpServer()).get('/v1/test/ping');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toHaveProperty('code');
      expect(res.body.error).toHaveProperty('message');
      expect(typeof res.body.error.code).toBe('string');
      expect(typeof res.body.error.message).toBe('string');

      // details is optional
      if (res.body.error.details !== undefined) {
        expect(typeof res.body.error.details).toBe('object');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 7. Header validation
  // ─────────────────────────────────────────────────────────────────────────

  describe('Header Validation', () => {
    it('should return 401 when X-Pubkey is invalid hex (wrong length)', async () => {
      const headers = makeSignedHeaders({
        method: 'GET',
        path: '/v1/test/ping',
      });
      headers['X-Pubkey'] = 'abc123'; // too short

      const res = await request(app.getHttpServer())
        .get('/v1/test/ping')
        .set(headers);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_SIGNATURE');
    });

    it('should return 401 when X-Pubkey is not valid hex', async () => {
      const headers = makeSignedHeaders({
        method: 'GET',
        path: '/v1/test/ping',
      });
      headers['X-Pubkey'] = 'g'.repeat(64); // 'g' is not hex

      const res = await request(app.getHttpServer())
        .get('/v1/test/ping')
        .set(headers);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_SIGNATURE');
    });

    it('should return 401 when X-Signature is invalid hex (wrong length)', async () => {
      const headers = makeSignedHeaders({
        method: 'GET',
        path: '/v1/test/ping',
      });
      headers['X-Signature'] = 'abc123'; // too short

      const res = await request(app.getHttpServer())
        .get('/v1/test/ping')
        .set(headers);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_SIGNATURE');
    });

    it('should return 400 when X-Nonce contains pipe character', async () => {
      const headers = makeSignedHeaders({
        method: 'GET',
        path: '/v1/test/ping',
      });
      headers['X-Nonce'] = 'invalid|nonce';

      const res = await request(app.getHttpServer())
        .get('/v1/test/ping')
        .set(headers);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('BAD_REQUEST');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 8. Valid signature should pass
  // ─────────────────────────────────────────────────────────────────────────

  describe('Valid Signature', () => {
    it('should return 200 when all headers are valid', async () => {
      const headers = makeSignedHeaders({
        method: 'GET',
        path: '/v1/test/ping',
      });

      const res = await request(app.getHttpServer())
        .get('/v1/test/ping')
        .set(headers);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    });

    it('should verify POST request with body correctly', async () => {
      const rawBody = '{"test":"value"}';
      const headers = makeSignedHeaders({
        method: 'POST',
        path: '/v1/test/echo',
        rawBody,
      });

      const res = await request(app.getHttpServer())
        .post('/v1/test/echo')
        .set(headers)
        .set('Content-Type', 'application/json')
        .send(rawBody);

      expect(res.status).toBe(201);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 9. Tampering detection
  // ─────────────────────────────────────────────────────────────────────────

  describe('Tampering Detection', () => {
    it('should reject when METHOD is tampered', async () => {
      const headers = makeSignedHeaders({
        method: 'POST', // signed for POST
        path: '/v1/test/ping',
      });

      const res = await request(app.getHttpServer())
        .get('/v1/test/ping') // but sending GET
        .set(headers);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_SIGNATURE');
    });

    it('should reject when PATH is tampered', async () => {
      const headers = makeSignedHeaders({
        method: 'GET',
        path: '/v1/test/other', // signed for different path
      });

      const res = await request(app.getHttpServer())
        .get('/v1/test/ping')
        .set(headers);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_SIGNATURE');
    });

    it('should reject when TIMESTAMP is tampered', async () => {
      const headers = makeSignedHeaders({
        method: 'GET',
        path: '/v1/test/ping',
      });
      headers['X-Timestamp'] = String(Date.now() + 1000); // change timestamp

      const res = await request(app.getHttpServer())
        .get('/v1/test/ping')
        .set(headers);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_SIGNATURE');
    });

    it('should reject when NONCE is tampered', async () => {
      const headers = makeSignedHeaders({
        method: 'GET',
        path: '/v1/test/ping',
      });
      headers['X-Nonce'] = 'tampered-nonce'; // change nonce

      const res = await request(app.getHttpServer())
        .get('/v1/test/ping')
        .set(headers);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_SIGNATURE');
    });
  });
});
