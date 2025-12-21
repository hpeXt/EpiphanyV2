/**
 * @file topic-events.publisher.ts
 * @description Publish Topic invalidation events to Redis Stream (Step 12)
 */
import { Injectable } from '@nestjs/common';
import { zSseEnvelope, type SseEnvelope } from '@epiphany/shared-contracts';
import { RedisService } from '../infrastructure/redis.module.js';

const TOPIC_EVENTS_MAXLEN = '1000';

@Injectable()
export class TopicEventsPublisher {
  constructor(private readonly redis: RedisService) {}

  streamKey(topicId: string): string {
    return `topic:events:${topicId}`;
  }

  async publish(topicId: string, envelope: SseEnvelope): Promise<string> {
    // Sanitize + freeze contract: only allow the shared-contracts union and strip unknown keys.
    const safe = zSseEnvelope.parse(envelope);

    const id = await this.redis.xadd(
      this.streamKey(topicId),
      'MAXLEN',
      '~',
      TOPIC_EVENTS_MAXLEN,
      '*',
      'data',
      JSON.stringify(safe),
    );

    if (!id) {
      throw new Error(`Failed to publish event to stream ${this.streamKey(topicId)}`);
    }

    return id;
  }
}

