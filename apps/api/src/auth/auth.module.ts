/**
 * @file auth.module.ts
 * @description Authentication module with Redis nonce deduplication
 */
import { Module, Global } from '@nestjs/common';
import { RedisModule } from '@nestjs-modules/ioredis';
import { AuthGuard } from './auth.guard';
import { NonceService, REDIS_CLIENT } from './nonce.service';

@Global()
@Module({
  imports: [
    RedisModule.forRootAsync({
      useFactory: () => ({
        type: 'single',
        url: process.env.REDIS_URL || 'redis://localhost:6379',
      }),
    }),
  ],
  providers: [AuthGuard, NonceService],
  exports: [AuthGuard, NonceService],
})
export class AuthModule {}
