/**
 * @file translation.service.ts
 * @description Read-path localization + write-path translation enqueue (zh/en).
 */

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { PrismaService } from '../infrastructure/prisma.module.js';
import { QueueService } from '../infrastructure/queue.module.js';
import { otherLocale, type Locale } from '../common/locale.js';

export type TranslationResourceType =
  | 'topic_title'
  | 'argument'
  | 'consensus_report'
  | 'camp'
  | 'topic_profile_display_name';

function hasCjk(text: string): boolean {
  return /[\u4E00-\u9FFF]/.test(text);
}

function hasTranslatableChars(text: string): boolean {
  // Only count letters + CJK as meaningful for translation.
  return /[A-Za-z\u4E00-\u9FFF]/.test(text);
}

function guessLocaleFromText(text: string): Locale {
  return hasCjk(text) ? 'zh' : 'en';
}

function sha256Json(value: unknown): Buffer {
  return createHash('sha256').update(JSON.stringify(value)).digest();
}

function toBuffer(value: Uint8Array | null): Buffer | null {
  return value ? Buffer.from(value) : null;
}

function toPrismaBytes(bytes: Buffer): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(bytes.length));
  out.set(bytes);
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readStringField(obj: Record<string, unknown>, key: string): string | null {
  const value = obj[key];
  if (typeof value !== 'string') return null;
  return value;
}

function readNullableStringField(obj: Record<string, unknown>, key: string): string | null | undefined {
  const value = obj[key];
  if (value === null) return null;
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return undefined;
  return value;
}

@Injectable()
export class TranslationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  private computeSourceHash(params:
    | { resourceType: 'topic_title'; source: { title: string } }
    | { resourceType: 'argument'; source: { title: string | null; body: string } }
    | { resourceType: 'topic_profile_display_name'; source: { displayName: string | null } }
    | { resourceType: 'consensus_report'; source: { contentMd: string } }
    | { resourceType: 'camp'; source: { label: string; summary: string } }
  ): Buffer {
    switch (params.resourceType) {
      case 'topic_title':
        return sha256Json({ title: params.source.title.trim() });
      case 'argument':
        return sha256Json({
          title: params.source.title === null ? null : params.source.title.trim(),
          body: params.source.body.trim(),
        });
      case 'topic_profile_display_name':
        return sha256Json({
          displayName: params.source.displayName === null ? null : params.source.displayName.trim(),
        });
      case 'consensus_report':
        return sha256Json({ contentMd: params.source.contentMd.trim() });
      case 'camp':
        return sha256Json({ label: params.source.label.trim(), summary: params.source.summary.trim() });
      default: {
        const _exhaustive: never = params;
        return _exhaustive;
      }
    }
  }

  private async getReadyTranslations(params: {
    resourceType: TranslationResourceType;
    resourceIds: string[];
    targetLocale: Locale;
  }): Promise<
    Array<{
      resourceId: string;
      sourceHash: Buffer | null;
      data: Prisma.JsonValue | null;
    }>
  > {
    if (!params.resourceIds.length) return [];

    const rows = await this.prisma.translation.findMany({
      where: {
        resourceType: params.resourceType,
        resourceId: { in: params.resourceIds },
        targetLocale: params.targetLocale,
        status: 'ready',
      },
      select: {
        resourceId: true,
        sourceHash: true,
        data: true,
      },
    });

    return rows.map((row) => ({
      resourceId: row.resourceId,
      sourceHash: toBuffer(row.sourceHash),
      data: row.data,
    }));
  }

  async getTopicTitleOverrides(params: {
    items: Array<{ id: string; title: string }>;
    targetLocale: Locale;
  }): Promise<Map<string, string>> {
    const topicIds = params.items.map((item) => item.id);
    const translations = await this.getReadyTranslations({
      resourceType: 'topic_title',
      resourceIds: topicIds,
      targetLocale: params.targetLocale,
    });

    const byId = new Map(translations.map((row) => [row.resourceId, row] as const));
    const overrides = new Map<string, string>();

    for (const item of params.items) {
      const row = byId.get(item.id);
      if (!row?.data || !row.sourceHash) continue;

      const expectedHash = this.computeSourceHash({
        resourceType: 'topic_title',
        source: { title: item.title },
      });

      if (!row.sourceHash.equals(expectedHash)) continue;
      if (!isRecord(row.data)) continue;

      const title = readStringField(row.data, 'title');
      if (!title?.trim()) continue;
      overrides.set(item.id, title);
    }

    return overrides;
  }

  async getArgumentOverrides(params: {
    items: Array<{ id: string; title: string | null; body: string }>;
    targetLocale: Locale;
  }): Promise<Map<string, { title: string | null; body: string }>> {
    const ids = params.items.map((item) => item.id);
    const translations = await this.getReadyTranslations({
      resourceType: 'argument',
      resourceIds: ids,
      targetLocale: params.targetLocale,
    });

    const byId = new Map(translations.map((row) => [row.resourceId, row] as const));
    const overrides = new Map<string, { title: string | null; body: string }>();

    for (const item of params.items) {
      const row = byId.get(item.id);
      if (!row?.data || !row.sourceHash) continue;

      const expectedHash = this.computeSourceHash({
        resourceType: 'argument',
        source: { title: item.title, body: item.body },
      });

      if (!row.sourceHash.equals(expectedHash)) continue;
      if (!isRecord(row.data)) continue;

      const title = readNullableStringField(row.data, 'title');
      const body = readStringField(row.data, 'body');

      const nextTitle = title === undefined ? item.title : title;
      const nextBody = body?.trim() ? body : item.body;

      if (nextTitle !== item.title || nextBody !== item.body) {
        overrides.set(item.id, { title: nextTitle, body: nextBody });
      }
    }

    return overrides;
  }

  async getDisplayNameOverrides(params: {
    items: Array<{ topicId: string; pubkeyHex: string; displayName: string | null }>;
    targetLocale: Locale;
  }): Promise<Map<string, string>> {
    const resourceIds = params.items.map((item) => `${item.topicId}:${item.pubkeyHex}`);
    const translations = await this.getReadyTranslations({
      resourceType: 'topic_profile_display_name',
      resourceIds,
      targetLocale: params.targetLocale,
    });

    const byResourceId = new Map(translations.map((row) => [row.resourceId, row] as const));
    const overrides = new Map<string, string>();

    for (const item of params.items) {
      if (!item.displayName) continue;
      const resourceId = `${item.topicId}:${item.pubkeyHex}`;
      const row = byResourceId.get(resourceId);
      if (!row?.data || !row.sourceHash) continue;

      const expectedHash = this.computeSourceHash({
        resourceType: 'topic_profile_display_name',
        source: { displayName: item.displayName },
      });

      if (!row.sourceHash.equals(expectedHash)) continue;
      if (!isRecord(row.data)) continue;

      const displayName = readStringField(row.data, 'displayName');
      if (!displayName?.trim()) continue;
      overrides.set(resourceId, displayName);
    }

    return overrides;
  }

  async getConsensusReportOverrides(params: {
    items: Array<{ id: string; contentMd: string }>;
    targetLocale: Locale;
  }): Promise<Map<string, string>> {
    const ids = params.items.map((item) => item.id);
    const translations = await this.getReadyTranslations({
      resourceType: 'consensus_report',
      resourceIds: ids,
      targetLocale: params.targetLocale,
    });

    const byId = new Map(translations.map((row) => [row.resourceId, row] as const));
    const overrides = new Map<string, string>();

    for (const item of params.items) {
      const row = byId.get(item.id);
      if (!row?.data || !row.sourceHash) continue;

      const expectedHash = this.computeSourceHash({
        resourceType: 'consensus_report',
        source: { contentMd: item.contentMd },
      });

      if (!row.sourceHash.equals(expectedHash)) continue;
      if (!isRecord(row.data)) continue;

      const contentMd = readStringField(row.data, 'contentMd');
      if (!contentMd?.trim()) continue;
      overrides.set(item.id, contentMd);
    }

    return overrides;
  }

  async requestTopicTitleTranslation(params: {
    topicId: string;
    title: string;
  }): Promise<void> {
    const title = params.title.trim();
    if (!title) return;
    if (!hasTranslatableChars(title)) return;

    const sourceLocale = guessLocaleFromText(title);
    const targetLocale = otherLocale(sourceLocale);
    const sourceHash = this.computeSourceHash({ resourceType: 'topic_title', source: { title } });

    await this.upsertAndEnqueue({
      resourceType: 'topic_title',
      resourceId: params.topicId,
      sourceLocale,
      sourceHash,
      targetLocale,
    });
  }

  async requestArgumentTranslation(params: {
    argumentId: string;
    title: string | null;
    body: string;
  }): Promise<void> {
    const body = params.body.trim();
    if (!body) return;

    const combined = `${params.title ?? ''}\n${body}`.trim();
    if (!hasTranslatableChars(combined)) return;

    const sourceLocale = guessLocaleFromText(combined);
    const targetLocale = otherLocale(sourceLocale);
    const sourceHash = this.computeSourceHash({
      resourceType: 'argument',
      source: { title: params.title, body },
    });

    await this.upsertAndEnqueue({
      resourceType: 'argument',
      resourceId: params.argumentId,
      sourceLocale,
      sourceHash,
      targetLocale,
    });
  }

  async requestDisplayNameTranslation(params: {
    topicId: string;
    pubkeyHex: string;
    displayName: string | null;
  }): Promise<void> {
    const displayName = params.displayName?.trim() ? params.displayName.trim() : null;
    if (!displayName) return;
    if (!hasTranslatableChars(displayName)) return;

    const sourceLocale = guessLocaleFromText(displayName);
    const targetLocale = otherLocale(sourceLocale);
    const sourceHash = this.computeSourceHash({
      resourceType: 'topic_profile_display_name',
      source: { displayName },
    });

    await this.upsertAndEnqueue({
      resourceType: 'topic_profile_display_name',
      resourceId: `${params.topicId}:${params.pubkeyHex}`,
      sourceLocale,
      sourceHash,
      targetLocale,
    });
  }

  async requestConsensusReportTranslation(params: {
    reportId: string;
    contentMd: string;
    targetLocale: Locale;
  }): Promise<void> {
    const contentMd = params.contentMd.trim();
    if (!contentMd) return;
    if (!hasTranslatableChars(contentMd)) return;

    const sourceLocale = guessLocaleFromText(contentMd);
    if (params.targetLocale === sourceLocale) return;

    const sourceHash = this.computeSourceHash({
      resourceType: 'consensus_report',
      source: { contentMd },
    });

    await this.upsertAndEnqueue({
      resourceType: 'consensus_report',
      resourceId: params.reportId,
      sourceLocale,
      sourceHash,
      targetLocale: params.targetLocale,
    });
  }

  private async upsertAndEnqueue(params: {
    resourceType: TranslationResourceType;
    resourceId: string;
    targetLocale: Locale;
    sourceLocale: Locale;
    sourceHash: Buffer;
  }): Promise<void> {
    const existing = await this.prisma.translation.findUnique({
      where: {
        resourceType_resourceId_targetLocale: {
          resourceType: params.resourceType,
          resourceId: params.resourceId,
          targetLocale: params.targetLocale,
        },
      },
      select: { id: true, status: true, sourceHash: true },
    });

    const existingHash = toBuffer(existing?.sourceHash ?? null);
    const sameHash = existingHash ? existingHash.equals(params.sourceHash) : false;

    if (existing?.status === 'ready' && sameHash) {
      return;
    }

    if (!existing) {
      await this.prisma.translation.create({
        data: {
          id: uuidv7(),
          resourceType: params.resourceType,
          resourceId: params.resourceId,
          targetLocale: params.targetLocale,
          status: 'pending',
          sourceLocale: params.sourceLocale,
          sourceHash: toPrismaBytes(params.sourceHash),
          data: Prisma.DbNull,
          model: null,
          provider: null,
          error: null,
        },
      });
    } else if (!sameHash || existing.status === 'failed' || existing.status === 'skipped_budget') {
      await this.prisma.translation.update({
        where: { id: existing.id },
        data: {
          status: 'pending',
          sourceLocale: params.sourceLocale,
          sourceHash: toPrismaBytes(params.sourceHash),
          data: Prisma.DbNull,
          model: null,
          provider: null,
          error: null,
        },
      });
    }

    await this.queue.enqueueTranslation({
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      targetLocale: params.targetLocale,
    });
  }
}
