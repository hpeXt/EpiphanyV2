import { Module } from '@nestjs/common';
import { ArgumentController } from './argument.controller.js';
import { ArgumentEditController } from './argument-edit.controller.js';
import { ArgumentReadController } from './argument-read.controller.js';
import { ArgumentService } from './argument.service.js';
import { TopicEventsModule } from '../sse/topic-events.module.js';

@Module({
  imports: [TopicEventsModule],
  controllers: [ArgumentController, ArgumentEditController, ArgumentReadController],
  providers: [ArgumentService],
})
export class ArgumentModule {}
