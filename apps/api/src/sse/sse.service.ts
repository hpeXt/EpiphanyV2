/**
 * @file sse.service.ts
 * @description SSE stream reader (Redis Stream -> SSE chunks)
 */
import { Injectable } from '@nestjs/common';
import { zSseEnvelope } from '@epiphany/shared-contracts';
import type Redis from 'ioredis';
import { RedisService } from '../infrastructure/redis.module.js';
import {
  compareRedisStreamIds,
  redisStreamEntryToSseChunk,
  toSseComment,
  toSseDataChunk,
  type RedisStreamEntry,
} from './sse.utils.js';

const STREAM_BLOCK_MS = 25_000;
const STREAM_READ_COUNT = 50;
const EMPTY_READ_BACKOFF_MS = 200;

type StreamRange = { firstId: string | null; lastId: string | null };

@Injectable()
export class SseService {
  constructor(private readonly redis: RedisService) {}

  async *streamTopicEvents(opts: {
    topicId: string;
    lastEventId?: string;
    signal: AbortSignal;
  }): AsyncGenerator<string, void, void> {
    const streamKey = `topic:events:${opts.topicId}`;
    const reader = this.redis.duplicate() as unknown as Redis;

    const abort = () => {
      try {
        reader.disconnect();
      } catch {
        // ignore
      }
    };
    opts.signal.addEventListener('abort', abort, { once: true });

    try {
      // Helps intermediaries establish the stream immediately.
      yield toSseComment('connected');

      let cursor: string;

      if (opts.lastEventId) {
        const range = await this.getStreamRange(reader, streamKey);
        const isTrimmed =
          range.firstId && range.lastId
            ? compareRedisStreamIds(opts.lastEventId, range.firstId) === -1
            : false;

        if (isTrimmed && range.lastId) {
          yield toSseDataChunk(range.lastId, {
            event: 'reload_required',
            data: { reason: 'trimmed' },
          });
          cursor = range.lastId;
        } else {
          const backlog = await this.readBacklog(reader, streamKey, opts.lastEventId);
          for (const entry of backlog) {
            const chunk = redisStreamEntryToSseChunk(entry);
            if (chunk) yield chunk;
          }
          cursor =
            backlog.length > 0 ? backlog[backlog.length - 1][0] : opts.lastEventId;
        }
      } else {
        // v1.0: without Last-Event-ID, start from "now" (new events only).
        cursor = '$';
      }

      while (!opts.signal.aborted) {
        const reply = await reader.xread(
          'COUNT',
          STREAM_READ_COUNT,
          'BLOCK',
          STREAM_BLOCK_MS,
          'STREAMS',
          streamKey,
          cursor,
        );

        const entries = this.extractEntriesFromXReadReply(reply);
        if (!entries || entries.length === 0) {
          yield toSseComment('keep-alive');
          await sleep(EMPTY_READ_BACKOFF_MS);
          continue;
        }

        for (const entry of entries) {
          const chunk = redisStreamEntryToSseChunk(entry);
          if (!chunk) continue;
          cursor = entry[0];
          yield chunk;
        }
      }
    } catch (err) {
      // When the client disconnects, the Redis blocking read may error - treat as normal.
      if (!opts.signal.aborted) throw err;
    } finally {
      opts.signal.removeEventListener('abort', abort);
      try {
        reader.disconnect();
      } catch {
        // ignore
      }
    }
  }

  private async getStreamRange(reader: Redis, streamKey: string): Promise<StreamRange> {
    try {
      const info = await reader.xinfo('STREAM', streamKey);
      const firstEntry = this.getXInfoEntryId(info, 'first-entry');
      const lastEntry = this.getXInfoEntryId(info, 'last-entry');
      return { firstId: firstEntry, lastId: lastEntry };
    } catch {
      return { firstId: null, lastId: null };
    }
  }

  private getXInfoEntryId(info: unknown, key: 'first-entry' | 'last-entry'): string | null {
    if (!Array.isArray(info)) return null;

    for (let i = 0; i < info.length - 1; i += 2) {
      if (info[i] !== key) continue;
      const entry = info[i + 1];
      if (!Array.isArray(entry)) return null;
      const [id] = entry;
      return typeof id === 'string' ? id : null;
    }
    return null;
  }

  private async readBacklog(
    reader: Redis,
    streamKey: string,
    lastEventId: string,
  ): Promise<RedisStreamEntry[]> {
    try {
      // Exclusive start: "(<lastId>"
      return (await reader.xrange(streamKey, `(${lastEventId}`, '+')) as RedisStreamEntry[];
    } catch {
      return [];
    }
  }

  private extractEntriesFromXReadReply(reply: unknown): RedisStreamEntry[] | null {
    if (!Array.isArray(reply) || reply.length === 0) return null;

    const first = reply[0];
    if (!Array.isArray(first) || first.length < 2) return null;

    const entries = first[1];
    if (!Array.isArray(entries)) return null;

    const parsed: RedisStreamEntry[] = [];
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length < 2) continue;
      const [id, fields] = entry;
      if (typeof id !== 'string' || !Array.isArray(fields)) continue;

      const stringFields: string[] = [];
      for (const item of fields) {
        if (typeof item === 'string') stringFields.push(item);
      }

      const chunk = redisStreamEntryToSseChunk([id, stringFields]);
      if (!chunk) continue;

      // Re-parse for safety: redisStreamEntryToSseChunk already validated and sanitized.
      const dataLine = chunk
        .split('\n')
        .find((line) => line.startsWith('data: '))
        ?.slice('data: '.length);

      if (!dataLine) continue;
      const envelope = zSseEnvelope.safeParse(JSON.parse(dataLine));
      if (!envelope.success) continue;

      parsed.push([id, stringFields]);
    }
    return parsed;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
