import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('Health (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/health (GET) - ok', async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ??
      'postgresql://postgres:postgres@localhost:5432/epiphany';
    process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body).toMatchObject({ ok: true, db: 'ok', redis: 'ok' });
  });

  it('/health (GET) - fail when deps unreachable', async () => {
    const prevDatabaseUrl = process.env.DATABASE_URL;
    const prevRedisUrl = process.env.REDIS_URL;

    process.env.DATABASE_URL =
      'postgresql://postgres:postgres@127.0.0.1:59999/epiphany';
    process.env.REDIS_URL = 'redis://127.0.0.1:59998';

    try {
      const res = await request(app.getHttpServer())
        .get('/health')
        .expect(503);
      expect(res.body).toMatchObject({ ok: false, db: 'fail', redis: 'fail' });
    } finally {
      process.env.DATABASE_URL = prevDatabaseUrl;
      process.env.REDIS_URL = prevRedisUrl;
    }
  });

  it('/health (GET) - should not leak sensitive info', async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ??
      'postgresql://postgres:postgres@localhost:5432/epiphany';
    process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

    const res = await request(app.getHttpServer()).get('/health');

    const body = JSON.stringify(res.body);

    // Should not contain DATABASE_URL or its parts
    expect(body).not.toContain('DATABASE_URL');
    expect(body).not.toContain('postgresql://');
    expect(body).not.toContain('postgres:postgres');

    // Should not contain REDIS_URL or its parts
    expect(body).not.toContain('REDIS_URL');
    expect(body).not.toContain('redis://');

    // Should not contain internal IPs (common patterns)
    expect(body).not.toMatch(/\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
    expect(body).not.toMatch(/\b172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b/);
    expect(body).not.toMatch(/\b192\.168\.\d{1,3}\.\d{1,3}\b/);

    // Should only contain expected fields
    expect(Object.keys(res.body).sort()).toEqual(
      ['db', 'ok', 'redis', 'timestamp'].sort(),
    );
  });
});

