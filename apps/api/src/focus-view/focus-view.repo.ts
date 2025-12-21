/**
 * @file focus-view.repo.ts
 * @description Focus View read-path queries (tree + children)
 */
import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Argument, TopicSummary } from '@epiphany/shared-contracts';
import { PrismaService } from '../infrastructure/prisma.module.js';

const ARGUMENT_SELECT = {
  id: true,
  topicId: true,
  parentId: true,
  title: true,
  body: true,
  authorPubkey: true,
  analysisStatus: true,
  stanceScore: true,
  totalVotes: true,
  totalCost: true,
  prunedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

function deriveAuthorId(authorPubkey: Uint8Array): string {
  return createHash('sha256').update(authorPubkey).digest('hex').slice(0, 16);
}

function mapTopicSummary(row: {
  id: string;
  title: string;
  rootArgumentId: string | null;
  status: 'active' | 'frozen' | 'archived';
  ownerPubkey: Uint8Array | null;
  createdAt: Date;
  updatedAt: Date;
}): TopicSummary {
  return {
    id: row.id,
    title: row.title,
    rootArgumentId: row.rootArgumentId ?? '',
    status: row.status,
    ownerPubkey: row.ownerPubkey ? Buffer.from(row.ownerPubkey).toString('hex') : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapArgument(row: {
  id: string;
  topicId: string;
  parentId: string | null;
  title: string | null;
  body: string;
  authorPubkey: Uint8Array;
  analysisStatus: 'pending_analysis' | 'ready' | 'failed';
  stanceScore: number | null;
  totalVotes: number;
  totalCost: number;
  prunedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): Argument {
  return {
    id: row.id,
    topicId: row.topicId,
    parentId: row.parentId,
    title: row.title,
    body: row.body,
    authorId: deriveAuthorId(row.authorPubkey),
    analysisStatus: row.analysisStatus,
    stanceScore: row.stanceScore,
    totalVotes: row.totalVotes,
    totalCost: row.totalCost,
    prunedAt: row.prunedAt ? row.prunedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type ChildrenOrderBy = 'totalVotes_desc' | 'createdAt_desc';

@Injectable()
export class FocusViewRepo {
  constructor(private readonly prisma: PrismaService) {}

  async getTopicTree(topicId: string, depth: number): Promise<{
    topic: TopicSummary;
    depth: number;
    arguments: Argument[];
  } | null> {
    const topic = await this.prisma.topic.findUnique({
      where: { id: topicId },
      select: {
        id: true,
        title: true,
        rootArgumentId: true,
        status: true,
        ownerPubkey: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!topic?.rootArgumentId) return null;

    const root = await this.prisma.argument.findFirst({
      where: {
        id: topic.rootArgumentId,
        topicId,
        prunedAt: null,
      },
      select: ARGUMENT_SELECT,
    });

    if (!root) return null;

    const all: Array<typeof root> = [root];
    let currentParentIds: string[] = [root.id];

    for (let level = 2; level <= depth; level += 1) {
      const children = await this.prisma.argument.findMany({
        where: {
          topicId,
          parentId: { in: currentParentIds },
          prunedAt: null,
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: ARGUMENT_SELECT,
      });

      if (!children.length) break;
      all.push(...children);
      currentParentIds = children.map((c) => c.id);
    }

    return {
      topic: mapTopicSummary(topic),
      depth,
      arguments: all.map(mapArgument),
    };
  }

  async getChildren(params: {
    argumentId: string;
    orderBy: ChildrenOrderBy;
    beforeId?: string;
    limit: number;
  }): Promise<{
    parentArgumentId: string;
    items: Argument[];
    nextBeforeId: string | null;
  } | null> {
    const parent = await this.prisma.argument.findFirst({
      where: { id: params.argumentId, prunedAt: null },
      select: { id: true, topicId: true },
    });

    if (!parent) return null;

    const baseWhere = {
      topicId: parent.topicId,
      parentId: parent.id,
      prunedAt: null as null,
    };

    let where: Record<string, unknown> = baseWhere;

    if (params.beforeId) {
      const before = await this.prisma.argument.findFirst({
        where: {
          id: params.beforeId,
          topicId: parent.topicId,
          parentId: parent.id,
          prunedAt: null,
        },
        select: { id: true, totalVotes: true, createdAt: true },
      });

      if (before) {
        if (params.orderBy === 'createdAt_desc') {
          where = {
            ...baseWhere,
            OR: [
              { createdAt: { lt: before.createdAt } },
              { AND: [{ createdAt: before.createdAt }, { id: { lt: before.id } }] },
            ],
          };
        } else {
          where = {
            ...baseWhere,
            OR: [
              { totalVotes: { lt: before.totalVotes } },
              { AND: [{ totalVotes: before.totalVotes }, { createdAt: { lt: before.createdAt } }] },
              {
                AND: [
                  { totalVotes: before.totalVotes },
                  { createdAt: before.createdAt },
                  { id: { lt: before.id } },
                ],
              },
            ],
          };
        }
      }
    }

    const orderBy =
      params.orderBy === 'createdAt_desc'
        ? [{ createdAt: 'desc' as const }, { id: 'desc' as const }]
        : [
            { totalVotes: 'desc' as const },
            { createdAt: 'desc' as const },
            { id: 'desc' as const },
          ];

    const rows = await this.prisma.argument.findMany({
      where,
      orderBy,
      take: params.limit + 1,
      select: ARGUMENT_SELECT,
    });

    const hasMore = rows.length > params.limit;
    const page = hasMore ? rows.slice(0, params.limit) : rows;
    const nextBeforeId = hasMore && page.length ? page[page.length - 1].id : null;

    return {
      parentArgumentId: parent.id,
      items: page.map(mapArgument),
      nextBeforeId,
    };
  }
}
