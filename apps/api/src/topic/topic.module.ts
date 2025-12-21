/**
 * @file topic.module.ts
 * @description Topic module
 */
import { Module } from '@nestjs/common';
import { TopicController } from './topic.controller.js';
import { TopicService } from './topic.service.js';
import { TopicEventsModule } from '../sse/topic-events.module.js';

@Module({
  imports: [TopicEventsModule],
  controllers: [TopicController],
  providers: [TopicService],
  exports: [TopicService],
})
export class TopicModule {}
