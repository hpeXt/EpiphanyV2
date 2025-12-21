import { Module } from '@nestjs/common';
import { ArgumentController } from './argument.controller.js';
import { ArgumentService } from './argument.service.js';

@Module({
  controllers: [ArgumentController],
  providers: [ArgumentService],
})
export class ArgumentModule {}

