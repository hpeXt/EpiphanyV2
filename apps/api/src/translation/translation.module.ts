/**
 * @file translation.module.ts
 * @description Global translation module (read localization + write enqueue).
 */

import { Global, Module } from '@nestjs/common';
import { TranslationService } from './translation.service.js';

@Global()
@Module({
  providers: [TranslationService],
  exports: [TranslationService],
})
export class TranslationModule {}

