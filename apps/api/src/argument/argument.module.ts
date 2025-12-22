import { Module } from '@nestjs/common';
import { ArgumentController } from './argument.controller.js';
import { ArgumentReadController } from './argument-read.controller.js';
import { ArgumentService } from './argument.service.js';

@Module({
  controllers: [ArgumentController, ArgumentReadController],
  providers: [ArgumentService],
})
export class ArgumentModule {}
