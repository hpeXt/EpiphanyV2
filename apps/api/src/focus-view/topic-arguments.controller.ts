/**
 * @file topic-arguments.controller.ts
 * @description Public read: GET /v1/topics/:topicId/arguments
 */
import { Controller, Get, Headers, Param, Query, UseGuards } from '@nestjs/common';
import { FocusViewService } from './focus-view.service.js';
import { TopicPrivacyGuard } from '../topic/topic-privacy.guard.js';
import { resolveRequestLocale } from '../common/locale.js';

@Controller('v1/topics')
export class TopicArgumentsController {
  constructor(private readonly focusViewService: FocusViewService) {}

  @Get(':topicId/arguments')
  @UseGuards(TopicPrivacyGuard)
  async listTopicArguments(
    @Param('topicId') topicId: string,
    @Query('beforeId') beforeId?: string,
    @Query('limit') limit?: string,
    @Headers('x-epiphany-locale') localeHeader?: string,
    @Headers('accept-language') acceptLanguage?: string,
  ) {
    const locale = resolveRequestLocale({ localeHeader, acceptLanguage });
    return this.focusViewService.listTopicArguments({ topicId, beforeId, limitRaw: limit, locale });
  }
}
