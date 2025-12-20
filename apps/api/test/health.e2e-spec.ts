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
});

