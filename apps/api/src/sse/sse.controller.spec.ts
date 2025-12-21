import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import http from 'node:http';
import { zSseEnvelope } from '@epiphany/shared-contracts';
import { SseModule } from './sse.module';
import { RedisService } from '../infrastructure/redis.module';

type MockRedisReader = {
  xinfo: jest.Mock;
  xrange: jest.Mock;
  xread: jest.Mock;
  disconnect: jest.Mock;
};

async function readFirstSseDataEvent(opts: {
  url: string;
  headers: Record<string, string>;
  timeoutMs?: number;
}): Promise<{
  statusCode: number;
  contentType: string | undefined;
  id: string | undefined;
  data: string;
}> {
  const timeoutMs = opts.timeoutMs ?? 2_000;

  return new Promise((resolve, reject) => {
    const req = http.request(opts.url, { method: 'GET', headers: opts.headers }, (res) => {
      let buffer = '';
      let settled = false;

      const finish = (result: {
        statusCode: number;
        contentType: string | undefined;
        id: string | undefined;
        data: string;
      }) => {
        if (settled) return;
        settled = true;
        req.destroy();
        resolve(result);
      };

      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buffer += chunk;

        // SSE event ends with a blank line
        while (buffer.includes('\n\n')) {
          const idx = buffer.indexOf('\n\n');
          const rawEvent = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);

          const lines = rawEvent.split('\n');
          let id: string | undefined;
          const dataLines: string[] = [];
          for (const line of lines) {
            if (line.startsWith('id: ')) id = line.slice('id: '.length);
            if (line.startsWith('data: ')) dataLines.push(line.slice('data: '.length));
          }

          if (dataLines.length === 0) continue; // ignore keep-alives/comments

          finish({
            statusCode: res.statusCode ?? 0,
            contentType: Array.isArray(res.headers['content-type'])
              ? res.headers['content-type'][0]
              : res.headers['content-type'],
            id,
            data: dataLines.join('\n'),
          });
          return;
        }
      });

      res.on('error', (err) => {
        if (settled) return;
        settled = true;
        reject(err);
      });
    });

    const timer = setTimeout(() => {
      req.destroy();
      reject(new Error(`Timed out waiting for SSE data event (${timeoutMs}ms)`));
    }, timeoutMs);

    req.on('close', () => clearTimeout(timer));
    req.on('error', (err) => {
      // Ignore abort-related errors after we manually destroy the request.
      if ((err as NodeJS.ErrnoException).code === 'ECONNRESET') return;
      reject(err);
    });

    req.end();
  });
}

describe('GET /v1/sse/:topicId (integration)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let redisReader: MockRedisReader;
  let redisServiceMock: { duplicate: jest.Mock };

  beforeEach(async () => {
    redisReader = {
      xinfo: jest.fn(),
      xrange: jest.fn(),
      xread: jest.fn(),
      disconnect: jest.fn(),
    };
    redisReader.xread.mockResolvedValue(null);

    redisServiceMock = {
      duplicate: jest.fn(() => redisReader),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [SseModule],
    })
      .overrideProvider(RedisService)
      .useValue(redisServiceMock)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.listen(0);

    const address = app.getHttpServer().address();
    const port =
      typeof address === 'string' ? Number(address.split(':').pop()) : address?.port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await app.close();
  });

  it('should set text/event-stream header and stream new events when no Last-Event-ID', async () => {
    redisReader.xread.mockResolvedValueOnce([
      [
        'topic:events:topic_1',
        [
          [
            '10-0',
            [
              'data',
              JSON.stringify({
                event: 'argument_updated',
                data: { argumentId: 'arg_1', reason: 'new_vote' },
              }),
            ],
          ],
        ],
      ],
    ]);

    const result = await readFirstSseDataEvent({
      url: `${baseUrl}/v1/sse/topic_1`,
      headers: { Accept: 'text/event-stream' },
    });

    expect(result.statusCode).toBe(200);
    expect(result.contentType).toContain('text/event-stream');
    expect(result.id).toBe('10-0');

    const envelope = JSON.parse(result.data);
    expect(zSseEnvelope.safeParse(envelope).success).toBe(true);
    expect(result.data).not.toContain('ledger');
    expect(redisReader.xrange).not.toHaveBeenCalled();
  });

  it('should replay missed events after Last-Event-ID via XRANGE', async () => {
    redisReader.xinfo.mockResolvedValueOnce([
      'first-entry',
      [
        '1-0',
        [
          'data',
          JSON.stringify({
            event: 'argument_updated',
            data: { argumentId: 'arg_0', reason: 'new_vote' },
          }),
        ],
      ],
      'last-entry',
      [
        '2-0',
        [
          'data',
          JSON.stringify({
            event: 'topic_updated',
            data: { topicId: 'topic_1', reason: 'status_changed' },
          }),
        ],
      ],
    ]);

    redisReader.xrange.mockResolvedValueOnce([
      [
        '2-0',
        [
          'data',
          JSON.stringify({
            event: 'topic_updated',
            data: { topicId: 'topic_1', reason: 'status_changed' },
          }),
        ],
      ],
    ]);

    redisReader.xread.mockResolvedValue(null);

    const result = await readFirstSseDataEvent({
      url: `${baseUrl}/v1/sse/topic_1`,
      headers: { Accept: 'text/event-stream', 'Last-Event-ID': '1-0' },
    });

    expect(result.id).toBe('2-0');
    expect(zSseEnvelope.safeParse(JSON.parse(result.data)).success).toBe(true);
  });

  it('should send reload_required when Last-Event-ID is trimmed', async () => {
    redisReader.xinfo.mockResolvedValueOnce([
      'first-entry',
      [
        '2-0',
        [
          'data',
          JSON.stringify({
            event: 'topic_updated',
            data: { topicId: 'topic_1', reason: 'status_changed' },
          }),
        ],
      ],
      'last-entry',
      [
        '2-0',
        [
          'data',
          JSON.stringify({
            event: 'topic_updated',
            data: { topicId: 'topic_1', reason: 'status_changed' },
          }),
        ],
      ],
    ]);

    redisReader.xread.mockResolvedValue(null);

    const result = await readFirstSseDataEvent({
      url: `${baseUrl}/v1/sse/topic_1`,
      headers: { Accept: 'text/event-stream', 'Last-Event-ID': '1-0' },
    });

    expect(result.id).toBe('2-0');
    expect(JSON.parse(result.data)).toEqual({
      event: 'reload_required',
      data: { reason: 'trimmed' },
    });
  });
});
