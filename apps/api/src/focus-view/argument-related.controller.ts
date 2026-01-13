/**
 * @file argument-related.controller.ts
 * @description Public read: GET /v1/arguments/:argumentId/related
 */
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { FocusViewService } from './focus-view.service.js';
import { TopicPrivacyGuard } from '../topic/topic-privacy.guard.js';

@Controller('v1/arguments')
export class ArgumentRelatedController {
  constructor(private readonly focusViewService: FocusViewService) {}

  @Get(':argumentId/related')
  @UseGuards(TopicPrivacyGuard)
  async getRelated(
    @Param('argumentId') argumentId: string,
    @Query('limit') limit?: string,
  ) {
    return this.focusViewService.getRelated({ argumentId, limitRaw: limit });
  }
}

