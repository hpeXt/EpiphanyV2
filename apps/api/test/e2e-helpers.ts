import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { json } from 'express';
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign as cryptoSign,
  type KeyObject,
} from 'node:crypto';

export function ensureTestEnv(): void {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ??
    'postgresql://postgres:postgres@localhost:5432/epiphany_test';
  process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379/1';

  const dbName = (() => {
    try {
      const url = new URL(process.env.DATABASE_URL);
      const name = url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname;
      return name || null;
    } catch {
      const match = (process.env.DATABASE_URL ?? '').match(/\/([^/?#]+)(?:[?#]|$)/);
      return match?.[1] ?? null;
    }
  })();

  if (!dbName || (!dbName.endsWith('_test') && !dbName.endsWith('_e2e'))) {
    throw new Error(
      `Refusing to run e2e tests against DATABASE_URL=${process.env.DATABASE_URL} (expected db name to end with _test or _e2e).`,
    );
  }

  const redisDb = (() => {
    try {
      const url = new URL(process.env.REDIS_URL ?? '');
      const raw = url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname;
      if (!raw) return 0;
      const num = Number.parseInt(raw, 10);
      return Number.isFinite(num) ? num : 0;
    } catch {
      return null;
    }
  })();

  if (redisDb === null || redisDb === 0) {
    throw new Error(
      `Refusing to run e2e tests against REDIS_URL=${process.env.REDIS_URL} (expected redis db index != 0, e.g. redis://localhost:6379/1).`,
    );
  }
}

export async function createE2eApp(): Promise<INestApplication> {
  ensureTestEnv();

  const { AppModule } = await import('../src/app.module');

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication({ bodyParser: false });

  app.use(
    json({
      verify: (req, _res, buf) => {
        (req as Express.Request & { rawBody?: string }).rawBody = buf.toString(
          'utf8',
        );
      },
    }),
  );

  app.useGlobalPipes(new ValidationPipe({ transform: true }));
  await app.init();
  return app;
}

function sha256HexBytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function computeAuthorId(pubkeyHex: string): string {
  const pubkeyBytes = Buffer.from(pubkeyHex, 'hex');
  return sha256HexBytes(pubkeyBytes).slice(0, 16);
}

export interface Ed25519Keypair {
  privateKey: KeyObject;
  pubkeyHex: string;
}

export function generateEd25519Keypair(): Ed25519Keypair {
  const keypair = generateKeyPairSync('ed25519');
  const pubkeyDer = keypair.publicKey.export({ type: 'spki', format: 'der' });
  const pubkeyHex = (pubkeyDer as Buffer).subarray(12).toString('hex');
  return { privateKey: keypair.privateKey, pubkeyHex };
}

export function makeSignedHeaders(opts: {
  method: string;
  path: string;
  body: unknown;
  privateKey: KeyObject;
  pubkeyHex: string;
  nonce?: string;
  timestampMs?: number;
}): Record<string, string> {
  const timestampMs = opts.timestampMs ?? Date.now();
  const nonce = opts.nonce ?? randomBytes(16).toString('hex');
  const rawBody = opts.body ? JSON.stringify(opts.body) : '';
  const bodyHash = rawBody
    ? createHash('sha256').update(rawBody).digest('hex')
    : '';

  const canonical = `v1|${opts.method.toUpperCase()}|${opts.path}|${timestampMs}|${nonce}|${bodyHash}`;
  const signature = cryptoSign(
    null,
    Buffer.from(canonical, 'utf8'),
    opts.privateKey,
  );

  return {
    'X-Pubkey': opts.pubkeyHex,
    'X-Signature': signature.toString('hex'),
    'X-Timestamp': String(timestampMs),
    'X-Nonce': nonce,
  };
}
