/**
 * @file argument-read.controller.ts
 * @description Argument public read APIs (getArgument)
 */
import { Controller, Get, Param } from '@nestjs/common';
import { ArgumentService } from './argument.service.js';

@Controller('v1/arguments')
export class ArgumentReadController {
  constructor(private readonly argumentService: ArgumentService) {}

  /**
   * GET /v1/arguments/:argumentId - Argument detail (public read)
   * @see docs/stage01/api-contract.md#3.5.1
   */
  @Get(':argumentId')
  async getArgument(@Param('argumentId') argumentId: string) {
    return this.argumentService.getArgument(argumentId);
  }
}

