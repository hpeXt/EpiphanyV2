/**
 * @file votes.module.ts
 * @description Votes module (QV setVotes)
 */
import { Module } from '@nestjs/common';
import { VotesController } from './votes.controller.js';
import { VotesService } from './votes.service.js';

@Module({
  controllers: [VotesController],
  providers: [VotesService],
})
export class VotesModule {}

