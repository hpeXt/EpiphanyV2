/**
 * @file sse.module.ts
 * @description SSE module
 */
import { Module } from '@nestjs/common';
import { SseController } from './sse.controller.js';
import { SseService } from './sse.service.js';
import { TopicEventsModule } from './topic-events.module.js';

@Module({
  imports: [TopicEventsModule],
  controllers: [SseController],
  providers: [SseService],
})
export class SseModule {}
