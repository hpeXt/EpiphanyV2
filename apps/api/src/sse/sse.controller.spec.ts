import { Test, type TestingModule } from '@nestjs/testing';
import { EventEmitter } from 'node:events';
import { zSseEnvelope } from '@epiphany/shared-contracts';
import type { Request, Response } from 'express';
import { SseController } from './sse.controller';
import { SseModule } from './sse.module';
import { RedisService } from '../infrastructure/redis.module';

type MockRedisReader = {
  xinfo: jest.Mock;
  xrange: jest.Mock;
  xread: jest.Mock;
  disconnect: jest.Mock;
};

async function readFirstSseDataEvent(opts: {
  subscribe: (req: Request, res: Response) => Promise<void>;
  timeoutMs?: number;
}): Promise<{
  statusCode: number;
  contentType: string | undefined;
  id: string | undefined;
  data: string;
}> {
  const timeoutMs = opts.timeoutMs ?? 2_000;

  return new Promise((resolve, reject) => {
    const req = new EventEmitter() as unknown as Request;
    const headers: Record<string, string> = {};
    let statusCode = 0;

    let buffer = '';
    let settled = false;
    let subscribePromise: Promise<void> | null = null;

    const finish = (result: {
      statusCode: number;
      contentType: string | undefined;
      id: string | undefined;
      data: string;
    }) => {
      if (settled) return;
      settled = true;
      (req as unknown as EventEmitter).emit('close');

      if (!subscribePromise) {
        resolve(result);
        return;
      }

      subscribePromise
        .catch(() => {
          // Ignore errors during disconnect (e.g., aborted request).
        })
        .finally(() => resolve(result));
    };

    const res = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      setHeader(name: string, value: unknown) {
        headers[name.toLowerCase()] = String(value);
      },
      flushHeaders() {
        // no-op
      },
      write(chunk: unknown) {
        buffer += String(chunk);

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
            statusCode,
            contentType: headers['content-type'],
            id,
            data: dataLines.join('\n'),
          });
          return true;
        }

        return true;
      },
      end() {
        // no-op
      },
    } as unknown as Response;

    subscribePromise = opts.subscribe(req, res);

    const timer = setTimeout(() => {
      if (settled) return;
      (req as unknown as EventEmitter).emit('close');
      reject(new Error(`Timed out waiting for SSE data event (${timeoutMs}ms)`));
    }, timeoutMs);

    (req as unknown as EventEmitter).on('close', () => clearTimeout(timer));

    subscribePromise.catch((err) => {
      if (settled) return;
      reject(err);
    });
  });
}

describe('GET /v1/sse/:topicId (integration)', () => {
  let moduleFixture: TestingModule;
  let controller: SseController;
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

    moduleFixture = await Test.createTestingModule({
      imports: [SseModule],
    })
      .overrideProvider(RedisService)
      .useValue(redisServiceMock)
      .compile();
    controller = moduleFixture.get(SseController);
  });

  afterEach(async () => {
    await moduleFixture.close();
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
      subscribe: (req, res) => controller.subscribe('topic_1', undefined, req, res),
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
      subscribe: (req, res) => controller.subscribe('topic_1', '1-0', req, res),
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
      subscribe: (req, res) => controller.subscribe('topic_1', '1-0', req, res),
    });

    expect(result.id).toBe('2-0');
    expect(JSON.parse(result.data)).toEqual({
      event: 'reload_required',
      data: { reason: 'trimmed' },
    });
  });
});
