/**
 * @file common.module.ts
 * @description Common module exporting shared services and guards
 */
import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AuthService } from './auth.service.js';
import { AuthGuard } from './auth.guard.js';
import { HttpExceptionFilter } from './http-exception.filter.js';
import { RiskControlInterceptor } from '../risk-control/risk-control.interceptor.js';
import { RiskControlService } from '../risk-control/risk-control.service.js';
import { TopicPrivacyGuard } from '../topic/topic-privacy.guard.js';

@Global()
@Module({
  providers: [
    AuthService,
    RiskControlService,
    TopicPrivacyGuard,
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: RiskControlInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
  ],
  exports: [AuthService, TopicPrivacyGuard],
})
export class CommonModule {}
