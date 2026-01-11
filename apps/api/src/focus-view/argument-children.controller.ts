/**
 * @file argument-children.controller.ts
 * @description Public read: GET /v1/arguments/:argumentId/children
 */
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { FocusViewService } from './focus-view.service.js';
import { TopicPrivacyGuard } from '../topic/topic-privacy.guard.js';

@Controller('v1/arguments')
export class ArgumentChildrenController {
  constructor(private readonly focusViewService: FocusViewService) {}

  @Get(':argumentId/children')
  @UseGuards(TopicPrivacyGuard)
  async getChildren(
    @Param('argumentId') argumentId: string,
    @Query('orderBy') orderBy?: string,
    @Query('beforeId') beforeId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.focusViewService.getChildren({
      argumentId,
      orderByRaw: orderBy,
      beforeId,
      limitRaw: limit,
    });
  }
}
