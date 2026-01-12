/**
 * @file topic-tree.controller.ts
 * @description Public read: GET /v1/topics/:topicId/tree
 */
import { Controller, Get, Headers, Param, Query, UseGuards } from '@nestjs/common';
import { FocusViewService } from './focus-view.service.js';
import { TopicPrivacyGuard } from '../topic/topic-privacy.guard.js';
import { resolveRequestLocale } from '../common/locale.js';

@Controller('v1/topics')
export class TopicTreeController {
  constructor(private readonly focusViewService: FocusViewService) {}

  @Get(':topicId/tree')
  @UseGuards(TopicPrivacyGuard)
  async getTopicTree(
    @Param('topicId') topicId: string,
    @Query('depth') depth?: string,
    @Headers('x-epiphany-locale') localeHeader?: string,
    @Headers('accept-language') acceptLanguage?: string,
  ) {
    const locale = resolveRequestLocale({ localeHeader, acceptLanguage });
    return this.focusViewService.getTopicTree(topicId, depth, locale);
  }
}
