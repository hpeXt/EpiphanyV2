/**
 * @file argument-read.controller.ts
 * @description Argument public read APIs (getArgument)
 */
import { Controller, Get, Headers, Param, UseGuards } from '@nestjs/common';
import { ArgumentService } from './argument.service.js';
import { TopicPrivacyGuard } from '../topic/topic-privacy.guard.js';
import { resolveRequestLocale } from '../common/locale.js';

@Controller('v1/arguments')
export class ArgumentReadController {
  constructor(private readonly argumentService: ArgumentService) {}

  /**
   * GET /v1/arguments/:argumentId - Argument detail (public read)
   * @see docs/stage01/api-contract.md#3.5.1
   */
  @Get(':argumentId')
  @UseGuards(TopicPrivacyGuard)
  async getArgument(
    @Param('argumentId') argumentId: string,
    @Headers('x-epiphany-locale') localeHeader?: string,
    @Headers('accept-language') acceptLanguage?: string,
  ) {
    const locale = resolveRequestLocale({ localeHeader, acceptLanguage });
    return this.argumentService.getArgument(argumentId, locale);
  }
}
