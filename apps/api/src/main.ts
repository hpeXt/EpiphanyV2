import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { json } from 'express';

type TrustProxyValue = boolean | number | string;

// Extend Express Request to include rawBody
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      rawBody?: string;
    }
  }
}

function parseCorsOrigin(value: string): boolean | string[] {
  const normalized = value.trim();
  const lower = normalized.toLowerCase();

  if (!normalized || lower === '*' || lower === 'true') return true;

  const origins = normalized
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return origins.length ? origins : true;
}

function parseTrustProxy(value: string | undefined): TrustProxyValue | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const lower = trimmed.toLowerCase();
  if (lower === 'true') return true;
  if (lower === 'false') return false;
  if (/^\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10);

  return trimmed;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // Disable default body parser to use custom one with raw body capture
    bodyParser: false,
  });

  const DEFAULT_TRUST_PROXY =
    '127.0.0.1/8,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,::1/128,fc00::/7';
  const trustProxy =
    parseTrustProxy(process.env.TRUST_PROXY) ??
    (process.env.NODE_ENV === 'production' ? DEFAULT_TRUST_PROXY : undefined);
  if (trustProxy !== undefined) {
    // Ensure req.ip honors forwarded headers only from trusted proxies.
    // This prevents client-supplied X-Forwarded-For spoofing when directly reachable.
    (app.getHttpAdapter().getInstance() as { set: (k: string, v: unknown) => void }).set(
      'trust proxy',
      trustProxy,
    );
  }

  // Custom JSON body parser that captures raw body for signature verification
  app.use(
    json({
      verify: (req, _res, buf) => {
        (req as Express.Request).rawBody = buf.toString('utf8');
      },
    }),
  );

  const corsOrigin = process.env.CORS_ORIGIN;

  if (corsOrigin) {
    app.enableCors({
      origin: parseCorsOrigin(corsOrigin),
      credentials: process.env.CORS_CREDENTIALS === 'true',
    });
  } else if (process.env.NODE_ENV !== 'production') {
    app.enableCors();
  }

  await app.listen(process.env.API_PORT ?? process.env.PORT ?? 3001);
}
bootstrap();
