/**
 * @file user.controller.ts
 * @description User API controller for batch-balance endpoint
 * @see docs/api-contract.md#3.10
 */
import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { UserService } from './user.service.js';
import { zBatchBalanceRequest } from '@epiphany/shared-contracts';

@Controller('v1/user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  /**
   * POST /v1/user/batch-balance - Batch balance query with item-level signatures
   *
   * Note: This endpoint does NOT require request-level signature headers.
   * Signature verification is done at the item level.
   *
   * @see docs/api-contract.md#3.10
   */
  @Post('batch-balance')
  @HttpCode(HttpStatus.OK)
  async batchBalance(@Body() body: unknown) {
    const parsed = zBatchBalanceRequest.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'BAD_REQUEST',
          message: parsed.error.errors.map((e: { message: string }) => e.message).join(', '),
        },
      });
    }

    return this.userService.batchBalance(parsed.data);
  }
}
