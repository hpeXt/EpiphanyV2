/**
 * @file focus-view.repo.ts
 * @description Focus View read-path queries (tree + children)
 */
import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Argument, TopicSummary } from '@epiphany/shared-contracts';
import { PrismaService } from '../infrastructure/prisma.module.js';
import { TranslationService } from '../translation/translation.service.js';
import type { Locale } from '../common/locale.js';

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

function toPubkeyHex(pubkey: Uint8Array): string {
  return Buffer.from(pubkey).toString('hex');
}

function mapTopicSummary(row: {
  id: string;
  title: string;
  rootArgumentId: string | null;
  status: 'active' | 'frozen' | 'archived';
  ownerPubkey: Uint8Array | null;
  visibility: 'public' | 'unlisted' | 'private';
  createdAt: Date;
  updatedAt: Date;
}): TopicSummary {
  return {
    id: row.id,
    title: row.title,
    rootArgumentId: row.rootArgumentId ?? '',
    status: row.status,
    ownerPubkey: row.ownerPubkey ? Buffer.from(row.ownerPubkey).toString('hex') : null,
    visibility: row.visibility,
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
}, authorDisplayName: string | null): Argument {
  return {
    id: row.id,
    topicId: row.topicId,
    parentId: row.parentId,
    title: row.title,
    body: row.body,
    authorId: deriveAuthorId(row.authorPubkey),
    authorDisplayName,
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly translations: TranslationService,
  ) {}

  async getTopicTree(topicId: string, depth: number, locale: Locale): Promise<{
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
        visibility: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!topic?.rootArgumentId) return null;

    const topicTitleOverrides = await this.translations.getTopicTitleOverrides({
      items: [{ id: topic.id, title: topic.title }],
      targetLocale: locale,
    });
    const localizedTopic = {
      ...topic,
      title: topicTitleOverrides.get(topic.id) ?? topic.title,
    };

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

    const argumentOverrides = await this.translations.getArgumentOverrides({
      items: all.map((row) => ({ id: row.id, title: row.title, body: row.body })),
      targetLocale: locale,
    });
    const localizedArguments = all.map((row) => {
      const override = argumentOverrides.get(row.id);
      if (!override) return row;
      return { ...row, title: override.title, body: override.body };
    });

    const uniquePubkeys = Array.from(
      new Set(localizedArguments.map((row) => toPubkeyHex(row.authorPubkey))),
    ).map((hex) => Buffer.from(hex, 'hex'));

    const profiles = uniquePubkeys.length
      ? await this.prisma.topicIdentityProfile.findMany({
          where: { topicId, pubkey: { in: uniquePubkeys } },
          select: { pubkey: true, displayName: true },
        })
      : [];

    const displayNameByPubkeyHex = new Map<string, string | null>();
    for (const profile of profiles) {
      displayNameByPubkeyHex.set(toPubkeyHex(profile.pubkey), profile.displayName);
    }

    const displayNameOverrides = await this.translations.getDisplayNameOverrides({
      items: profiles.map((profile) => ({
        topicId,
        pubkeyHex: toPubkeyHex(profile.pubkey),
        displayName: profile.displayName,
      })),
      targetLocale: locale,
    });
    for (const [resourceId, displayName] of displayNameOverrides) {
      const pubkeyHex = resourceId.split(':')[1];
      if (!pubkeyHex) continue;
      displayNameByPubkeyHex.set(pubkeyHex, displayName);
    }

    return {
      topic: mapTopicSummary(localizedTopic),
      depth,
      arguments: localizedArguments.map((row) =>
        mapArgument(row, displayNameByPubkeyHex.get(toPubkeyHex(row.authorPubkey)) ?? null),
      ),
    };
  }

  async listTopicArguments(params: {
    topicId: string;
    beforeId?: string;
    limit: number;
    locale: Locale;
  }): Promise<{
    topic: TopicSummary;
    items: Argument[];
    nextBeforeId: string | null;
  } | null> {
    const topic = await this.prisma.topic.findUnique({
      where: { id: params.topicId },
      select: {
        id: true,
        title: true,
        rootArgumentId: true,
        status: true,
        ownerPubkey: true,
        visibility: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!topic?.rootArgumentId) return null;

    const topicTitleOverrides = await this.translations.getTopicTitleOverrides({
      items: [{ id: topic.id, title: topic.title }],
      targetLocale: params.locale,
    });
    const localizedTopic = {
      ...topic,
      title: topicTitleOverrides.get(topic.id) ?? topic.title,
    };

    const baseWhere = {
      topicId: params.topicId,
      prunedAt: null as null,
    };

    let where: Record<string, unknown> = baseWhere;

    if (params.beforeId) {
      const before = await this.prisma.argument.findFirst({
        where: {
          id: params.beforeId,
          topicId: params.topicId,
          prunedAt: null,
        },
        select: { id: true, createdAt: true },
      });

      if (before) {
        where = {
          ...baseWhere,
          OR: [
            { createdAt: { lt: before.createdAt } },
            { AND: [{ createdAt: before.createdAt }, { id: { lt: before.id } }] },
          ],
        };
      }
    }

    const rows = await this.prisma.argument.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: params.limit + 1,
      select: ARGUMENT_SELECT,
    });

    const hasMore = rows.length > params.limit;
    const page = hasMore ? rows.slice(0, params.limit) : rows;
    const nextBeforeId = hasMore && page.length ? page[page.length - 1].id : null;

    const argumentOverrides = await this.translations.getArgumentOverrides({
      items: page.map((row) => ({ id: row.id, title: row.title, body: row.body })),
      targetLocale: params.locale,
    });
    const localizedPage = page.map((row) => {
      const override = argumentOverrides.get(row.id);
      if (!override) return row;
      return { ...row, title: override.title, body: override.body };
    });

    const uniquePubkeys = Array.from(
      new Set(page.map((row) => toPubkeyHex(row.authorPubkey))),
    ).map((hex) => Buffer.from(hex, 'hex'));

    const profiles = uniquePubkeys.length
      ? await this.prisma.topicIdentityProfile.findMany({
          where: { topicId: params.topicId, pubkey: { in: uniquePubkeys } },
          select: { pubkey: true, displayName: true },
        })
      : [];

    const displayNameByPubkeyHex = new Map<string, string | null>();
    for (const profile of profiles) {
      displayNameByPubkeyHex.set(toPubkeyHex(profile.pubkey), profile.displayName);
    }

    const displayNameOverrides = await this.translations.getDisplayNameOverrides({
      items: profiles.map((profile) => ({
        topicId: params.topicId,
        pubkeyHex: toPubkeyHex(profile.pubkey),
        displayName: profile.displayName,
      })),
      targetLocale: params.locale,
    });
    for (const [resourceId, displayName] of displayNameOverrides) {
      const pubkeyHex = resourceId.split(':')[1];
      if (!pubkeyHex) continue;
      displayNameByPubkeyHex.set(pubkeyHex, displayName);
    }

    return {
      topic: mapTopicSummary(localizedTopic),
      items: localizedPage.map((row) =>
        mapArgument(row, displayNameByPubkeyHex.get(toPubkeyHex(row.authorPubkey)) ?? null),
      ),
      nextBeforeId,
    };
  }

  async getChildren(params: {
    argumentId: string;
    orderBy: ChildrenOrderBy;
    beforeId?: string;
    limit: number;
    locale: Locale;
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

    const argumentOverrides = await this.translations.getArgumentOverrides({
      items: page.map((row) => ({ id: row.id, title: row.title, body: row.body })),
      targetLocale: params.locale,
    });
    const localizedPage = page.map((row) => {
      const override = argumentOverrides.get(row.id);
      if (!override) return row;
      return { ...row, title: override.title, body: override.body };
    });

    const uniquePubkeys = Array.from(
      new Set(page.map((row) => toPubkeyHex(row.authorPubkey))),
    ).map((hex) => Buffer.from(hex, 'hex'));

    const profiles = uniquePubkeys.length
      ? await this.prisma.topicIdentityProfile.findMany({
          where: { topicId: parent.topicId, pubkey: { in: uniquePubkeys } },
          select: { pubkey: true, displayName: true },
        })
      : [];

    const displayNameByPubkeyHex = new Map<string, string | null>();
    for (const profile of profiles) {
      displayNameByPubkeyHex.set(toPubkeyHex(profile.pubkey), profile.displayName);
    }

    const displayNameOverrides = await this.translations.getDisplayNameOverrides({
      items: profiles.map((profile) => ({
        topicId: parent.topicId,
        pubkeyHex: toPubkeyHex(profile.pubkey),
        displayName: profile.displayName,
      })),
      targetLocale: params.locale,
    });
    for (const [resourceId, displayName] of displayNameOverrides) {
      const pubkeyHex = resourceId.split(':')[1];
      if (!pubkeyHex) continue;
      displayNameByPubkeyHex.set(pubkeyHex, displayName);
    }

    return {
      parentArgumentId: parent.id,
      items: localizedPage.map((row) =>
        mapArgument(row, displayNameByPubkeyHex.get(toPubkeyHex(row.authorPubkey)) ?? null),
      ),
      nextBeforeId,
    };
  }
}
