/**
 * @file topic-events.module.ts
 * @description Topic events module (publisher)
 */
import { Module } from '@nestjs/common';
import { RedisModule } from '../infrastructure/redis.module.js';
import { TopicEventsPublisher } from './topic-events.publisher.js';

@Module({
  imports: [RedisModule],
  providers: [TopicEventsPublisher],
  exports: [TopicEventsPublisher],
})
export class TopicEventsModule {}

