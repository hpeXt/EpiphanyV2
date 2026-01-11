/**
 * @file topic-arguments.controller.ts
 * @description Public read: GET /v1/topics/:topicId/arguments
 */
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { FocusViewService } from './focus-view.service.js';
import { TopicPrivacyGuard } from '../topic/topic-privacy.guard.js';

@Controller('v1/topics')
export class TopicArgumentsController {
  constructor(private readonly focusViewService: FocusViewService) {}

  @Get(':topicId/arguments')
  @UseGuards(TopicPrivacyGuard)
  async listTopicArguments(
    @Param('topicId') topicId: string,
    @Query('beforeId') beforeId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.focusViewService.listTopicArguments({ topicId, beforeId, limitRaw: limit });
  }
}

