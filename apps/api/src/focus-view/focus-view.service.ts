/**
 * @file focus-view.service.ts
 * @description Focus View read-path service (tree + children)
 */
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import type {
  ArgumentChildrenResponse,
  ArgumentRelatedResponse,
  TopicArgumentsResponse,
  TopicTreeResponse,
} from '@epiphany/shared-contracts';
import { FocusViewRepo, type ChildrenOrderBy } from './focus-view.repo.js';
import type { Locale } from '../common/locale.js';

function clampInt(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

@Injectable()
export class FocusViewService {
  private readonly DEFAULT_TREE_DEPTH = 3;
  private readonly MIN_TREE_DEPTH = 1;
  private readonly MAX_TREE_DEPTH = 10;

  private readonly DEFAULT_TOPIC_ARGUMENTS_LIMIT = 500;
  private readonly MAX_TOPIC_ARGUMENTS_LIMIT = 1000;

  private readonly DEFAULT_CHILDREN_LIMIT = 30;
  private readonly MAX_CHILDREN_LIMIT = 100;

  private readonly DEFAULT_RELATED_LIMIT = 10;
  private readonly MAX_RELATED_LIMIT = 50;

  constructor(private readonly repo: FocusViewRepo) {}

  async getTopicTree(topicId: string, depthRaw: string | undefined, locale: Locale): Promise<TopicTreeResponse> {
    const depthParsed = depthRaw ? parseInt(depthRaw, 10) : this.DEFAULT_TREE_DEPTH;
    const depth = clampInt(
      Number.isFinite(depthParsed) ? depthParsed : this.DEFAULT_TREE_DEPTH,
      this.MIN_TREE_DEPTH,
      this.MAX_TREE_DEPTH,
    );

    const result = await this.repo.getTopicTree(topicId, depth, locale);
    if (!result) {
      throw new NotFoundException({
        error: { code: 'TOPIC_NOT_FOUND', message: 'Topic not found' },
      });
    }

    return result;
  }

  async listTopicArguments(params: {
    topicId: string;
    beforeId?: string;
    limitRaw?: string;
    locale: Locale;
  }): Promise<TopicArgumentsResponse> {
    const limitParsed = params.limitRaw ? parseInt(params.limitRaw, 10) : this.DEFAULT_TOPIC_ARGUMENTS_LIMIT;
    const limit = clampInt(
      Number.isFinite(limitParsed) ? limitParsed : this.DEFAULT_TOPIC_ARGUMENTS_LIMIT,
      1,
      this.MAX_TOPIC_ARGUMENTS_LIMIT,
    );

    const result = await this.repo.listTopicArguments({
      topicId: params.topicId,
      beforeId: params.beforeId,
      limit,
      locale: params.locale,
    });

    if (!result) {
      throw new NotFoundException({
        error: { code: 'TOPIC_NOT_FOUND', message: 'Topic not found' },
      });
    }

    return result;
  }

  async getChildren(params: {
    argumentId: string;
    orderByRaw?: string;
    beforeId?: string;
    limitRaw?: string;
    locale: Locale;
  }): Promise<ArgumentChildrenResponse> {
    const orderBy = this.parseChildrenOrderBy(params.orderByRaw);

    const limitParsed = params.limitRaw ? parseInt(params.limitRaw, 10) : this.DEFAULT_CHILDREN_LIMIT;
    const limit = clampInt(
      Number.isFinite(limitParsed) ? limitParsed : this.DEFAULT_CHILDREN_LIMIT,
      1,
      this.MAX_CHILDREN_LIMIT,
    );

    const result = await this.repo.getChildren({
      argumentId: params.argumentId,
      orderBy,
      beforeId: params.beforeId,
      limit,
      locale: params.locale,
    });

    if (!result) {
      throw new NotFoundException({
        error: { code: 'ARGUMENT_NOT_FOUND', message: 'Argument not found' },
      });
    }

    return result;
  }

  async getRelated(params: { argumentId: string; limitRaw?: string }): Promise<ArgumentRelatedResponse> {
    const limitParsed = params.limitRaw ? parseInt(params.limitRaw, 10) : this.DEFAULT_RELATED_LIMIT;
    const limit = clampInt(
      Number.isFinite(limitParsed) ? limitParsed : this.DEFAULT_RELATED_LIMIT,
      1,
      this.MAX_RELATED_LIMIT,
    );

    const result = await this.repo.getRelated({ argumentId: params.argumentId, limit });
    if (!result) {
      throw new NotFoundException({
        error: { code: 'ARGUMENT_NOT_FOUND', message: 'Argument not found' },
      });
    }

    return result;
  }

  private parseChildrenOrderBy(raw?: string): ChildrenOrderBy {
    if (!raw || raw === 'totalVotes_desc') return 'totalVotes_desc';
    if (raw === 'createdAt_desc') return 'createdAt_desc';

    throw new BadRequestException({
      error: {
        code: 'BAD_REQUEST',
        message: 'Invalid orderBy (expected totalVotes_desc | createdAt_desc)',
      },
    });
  }
}
