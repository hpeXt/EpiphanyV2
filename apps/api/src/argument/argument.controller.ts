/**
 * @file argument.controller.ts
 * @description Argument write APIs (createArgument)
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
} from '@nestjs/common';
import { zCreateArgumentRequest } from '@epiphany/shared-contracts';
import { RequireSignature } from '../common/auth.guard.js';
import { RiskControl } from '../risk-control/risk-control.decorator.js';
import { ArgumentService } from './argument.service.js';

@Controller('v1/topics')
export class ArgumentController {
  constructor(private readonly argumentService: ArgumentService) {}

  /**
   * POST /v1/topics/:topicId/arguments - Create argument (signature required)
   */
  @Post(':topicId/arguments')
  @RequireSignature()
  @RiskControl({ endpoint: 'createArgument', topicResolver: { kind: 'param', paramName: 'topicId' } })
  @HttpCode(HttpStatus.OK)
  async createArgument(
    @Param('topicId') topicId: string,
    @Body() body: unknown,
    @Headers('x-pubkey') pubkey: string,
    @Headers('x-topic-access-key') accessKey: string | undefined,
  ) {
    const parsed = zCreateArgumentRequest.safeParse(body);
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

    const initialVotes = parsed.data.initialVotes ?? 0;
    if (initialVotes > 10) {
      throw new BadRequestException({
        error: {
          code: 'BAD_REQUEST',
          message: 'initialVotes must be an integer between 0 and 10',
        },
      });
    }

    return this.argumentService.createArgument({
      topicId,
      dto: { ...parsed.data, initialVotes },
      pubkeyHex: pubkey,
      accessKeyHex: accessKey,
    });
  }
}
