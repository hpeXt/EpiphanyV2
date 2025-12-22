/**
 * @file votes.controller.ts
 * @description QV votes endpoints (setVotes)
 */
import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { zSetVotesRequest } from '@epiphany/shared-contracts';
import { RequireSignature, AllowNonceReplay } from '../common/auth.guard.js';
import { RiskControl } from '../risk-control/risk-control.decorator.js';
import { VotesService } from './votes.service.js';
import type { Request } from 'express';

@Controller('v1/arguments')
export class VotesController {
  constructor(private readonly votesService: VotesService) {}

  /**
   * POST /v1/arguments/:argumentId/votes - QV setVotes (signature required, strongly idempotent)
   */
  @Post(':argumentId/votes')
  @RequireSignature()
  @AllowNonceReplay()
  @RiskControl({ endpoint: 'setVotes', topicResolver: { kind: 'argumentIdParam', paramName: 'argumentId' } })
  @HttpCode(HttpStatus.OK)
  async setVotes(
    @Param('argumentId') argumentId: string,
    @Body() body: unknown,
    @Headers('x-pubkey') pubkey: string,
    @Headers('x-nonce') nonce: string,
    @Req() request: Request & { nonceReplay?: boolean },
  ) {
    const parsed = zSetVotesRequest.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'BAD_REQUEST',
          message: parsed.error.errors
            .map((e: { message: string }) => e.message)
            .join(', '),
        },
      });
    }

    return this.votesService.setVotes({
      argumentId,
      targetVotes: parsed.data.targetVotes,
      pubkey,
      nonce,
      nonceReplay: request.nonceReplay ?? false,
    });
  }
}
