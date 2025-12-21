import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { loadEnv } from './env.js';
import { HealthModule } from './health/health.module.js';
import { PrismaModule } from './infrastructure/prisma.module.js';
import { RedisModule } from './infrastructure/redis.module.js';
import { CommonModule } from './common/common.module.js';
import { TopicModule } from './topic/topic.module.js';
import { ArgumentModule } from './argument/argument.module.js';
import { FocusViewModule } from './focus-view/focus-view.module.js';
import { VotesModule } from './votes/votes.module.js';
import { UserModule } from './user/user.module.js';
import { SseModule } from './sse/sse.module.js';

loadEnv();

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    CommonModule,
    HealthModule,
    TopicModule,
    ArgumentModule,
    FocusViewModule,
    VotesModule,
    UserModule,
    SseModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
