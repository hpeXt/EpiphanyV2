/**
 * @file topic.controller.ts
 * @description Topic API controller
 */
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Headers,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { TopicService } from './topic.service.js';
import { RequireSignature } from '../common/auth.guard.js';
import { RiskControl } from '../risk-control/risk-control.decorator.js';
import {
  zCreateTopicRequest,
  zTopicCommand,
  type CreateTopicRequest,
  type TopicCommand,
} from '@epiphany/shared-contracts';

@Controller('v1/topics')
export class TopicController {
  constructor(private readonly topicService: TopicService) {}

  /**
   * POST /v1/topics - Create topic (no signature required)
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createTopic(@Body() body: unknown) {
    const parsed = zCreateTopicRequest.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'BAD_REQUEST',
          message: parsed.error.errors.map((e: { message: string }) => e.message).join(', '),
        },
      });
    }

    return this.topicService.createTopic(parsed.data);
  }

  /**
   * GET /v1/topics - List topics (public, no signature)
   */
  @Get()
  async listTopics(
    @Query('limit') limitStr?: string,
    @Query('beforeId') beforeId?: string,
    @Query('orderBy') orderBy?: string,
  ) {
    const limit = limitStr ? parseInt(limitStr, 10) : undefined;

    return this.topicService.listTopics({
      limit: isNaN(limit as number) ? undefined : limit,
      beforeId,
      orderBy: orderBy as 'createdAt_desc' | undefined,
    });
  }

  /**
   * GET /v1/topics/:topicId/cluster-map - God View data (public read)
   * @see docs/stage01/api-contract.md#3.11
   */
  @Get(':topicId/cluster-map')
  async getClusterMap(@Param('topicId') topicId: string) {
    return this.topicService.getClusterMap(topicId);
  }

  /**
   * GET /v1/topics/:topicId/consensus-report/latest - Latest consensus report (public read)
   * @see docs/stage01/api-contract.md#3.13
   */
  @Get(':topicId/consensus-report/latest')
  async getLatestConsensusReport(@Param('topicId') topicId: string) {
    return this.topicService.getLatestConsensusReport(topicId);
  }

  /**
   * POST /v1/topics/:topicId/commands - Execute topic command
   */
  @Post(':topicId/commands')
  @RequireSignature()
  @RiskControl({ endpoint: 'topicCommands', topicResolver: { kind: 'param', paramName: 'topicId' } })
  @HttpCode(HttpStatus.OK)
  async executeCommand(
    @Param('topicId') topicId: string,
    @Body() body: unknown,
    @Headers('x-claim-token') claimToken: string | undefined,
    @Headers('x-pubkey') pubkey: string,
  ) {
    const parsed = zTopicCommand.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'BAD_REQUEST',
          message: parsed.error.errors.map((e: { message: string }) => e.message).join(', '),
        },
      });
    }

    const command = parsed.data;

    switch (command.type) {
      case 'CLAIM_OWNER': {
        if (!claimToken) {
          throw new BadRequestException({
            error: {
              code: 'CLAIM_TOKEN_INVALID',
              message: 'X-Claim-Token header is required for CLAIM_OWNER',
            },
          });
        }
        const topic = await this.topicService.claimOwner(topicId, claimToken, pubkey);
        return { topic };
      }

      case 'SET_STATUS':
        return { topic: await this.topicService.setStatus(topicId, command.payload.status, pubkey) };

      case 'EDIT_ROOT':
        return { topic: await this.topicService.editRoot(topicId, command.payload, pubkey) };

      case 'PRUNE_ARGUMENT':
        return { topic: await this.topicService.pruneArgument(topicId, command.payload, pubkey) };

      case 'UNPRUNE_ARGUMENT':
        return { topic: await this.topicService.unpruneArgument(topicId, command.payload, pubkey) };

      case 'BLACKLIST_PUBKEY':
        return { topic: await this.topicService.blacklistPubkey(topicId, command.payload, pubkey) };

      case 'UNBLACKLIST_PUBKEY':
        return { topic: await this.topicService.unblacklistPubkey(topicId, command.payload, pubkey) };

      case 'GENERATE_CONSENSUS_REPORT':
        return { topic: await this.topicService.generateConsensusReport(topicId, pubkey) };

      default:
        throw new BadRequestException({
          error: {
            code: 'BAD_REQUEST',
            message: 'Unknown command type',
          },
        });
    }
  }

  /**
   * GET /v1/topics/:topicId/ledger/me - Get my ledger (signature required)
   * @see docs/stage01/api-contract.md#3.8
   */
  @Get(':topicId/ledger/me')
  @RequireSignature()
  async getLedgerMe(
    @Param('topicId') topicId: string,
    @Headers('x-pubkey') pubkey: string,
  ) {
    return this.topicService.getLedgerMe(topicId, pubkey);
  }

  /**
   * GET /v1/topics/:topicId/stakes/me - Get my stakes (signature required)
   * @see docs/stage01/api-contract.md#3.9
   */
  @Get(':topicId/stakes/me')
  @RequireSignature()
  async getStakesMe(
    @Param('topicId') topicId: string,
    @Headers('x-pubkey') pubkey: string,
  ) {
    return this.topicService.getStakesMe(topicId, pubkey);
  }
}
