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

import { AppModule } from '../src/app.module';

export function ensureTestEnv(): void {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ??
    'postgresql://postgres:postgres@localhost:5432/epiphany';
  process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
}

export async function createE2eApp(): Promise<INestApplication> {
  ensureTestEnv();

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

