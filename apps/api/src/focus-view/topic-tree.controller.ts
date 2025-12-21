/**
 * @file topic-tree.controller.ts
 * @description Public read: GET /v1/topics/:topicId/tree
 */
import { Controller, Get, Param, Query } from '@nestjs/common';
import { FocusViewService } from './focus-view.service.js';

@Controller('v1/topics')
export class TopicTreeController {
  constructor(private readonly focusViewService: FocusViewService) {}

  @Get(':topicId/tree')
  async getTopicTree(@Param('topicId') topicId: string, @Query('depth') depth?: string) {
    return this.focusViewService.getTopicTree(topicId, depth);
  }
}

