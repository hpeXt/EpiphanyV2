/**
 * @file focus-view.module.ts
 * @description Focus View module (public read path: tree + children)
 */
import { Module } from '@nestjs/common';
import { FocusViewRepo } from './focus-view.repo.js';
import { FocusViewService } from './focus-view.service.js';
import { TopicTreeController } from './topic-tree.controller.js';
import { ArgumentChildrenController } from './argument-children.controller.js';
import { TopicArgumentsController } from './topic-arguments.controller.js';

@Module({
  controllers: [TopicTreeController, TopicArgumentsController, ArgumentChildrenController],
  providers: [FocusViewRepo, FocusViewService],
})
export class FocusViewModule {}
