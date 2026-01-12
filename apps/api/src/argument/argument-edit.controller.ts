/**
 * @file argument-edit.controller.ts
 * @description Argument edit APIs (editArgument)
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
import { zEditArgumentRequest } from '@epiphany/shared-contracts';
import { RequireSignature } from '../common/auth.guard.js';
import { resolveRequestLocale } from '../common/locale.js';
import { RiskControl } from '../risk-control/risk-control.decorator.js';
import { ArgumentService } from './argument.service.js';

@Controller('v1/arguments')
export class ArgumentEditController {
  constructor(private readonly argumentService: ArgumentService) {}

  /**
   * POST /v1/arguments/:argumentId/edit - Edit argument (signature required)
   */
  @Post(':argumentId/edit')
  @RequireSignature()
  @RiskControl({ endpoint: 'editArgument', topicResolver: { kind: 'argumentIdParam', paramName: 'argumentId' } })
  @HttpCode(HttpStatus.OK)
  async editArgument(
    @Param('argumentId') argumentId: string,
    @Body() body: unknown,
    @Headers('x-pubkey') pubkey: string,
    @Headers('x-epiphany-locale') localeHeader?: string,
    @Headers('accept-language') acceptLanguage?: string,
  ) {
    const parsed = zEditArgumentRequest.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'BAD_REQUEST',
          message: parsed.error.errors.map((e) => e.message).join(', '),
        },
      });
    }

    const locale = resolveRequestLocale({ localeHeader, acceptLanguage });

    return this.argumentService.editArgument({
      argumentId,
      dto: parsed.data,
      pubkeyHex: pubkey,
      locale,
    });
  }
}
