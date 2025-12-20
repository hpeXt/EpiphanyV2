/**
 * @file common.module.ts
 * @description Common module exporting shared services and guards
 */
import { Module } from '@nestjs/common';
import { APP_GUARD, APP_FILTER } from '@nestjs/core';
import { AuthService } from './auth.service.js';
import { AuthGuard } from './auth.guard.js';
import { HttpExceptionFilter } from './http-exception.filter.js';

@Module({
  providers: [
    AuthService,
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
  ],
  exports: [AuthService],
})
export class CommonModule {}
