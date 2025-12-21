/**
 * @file focus-view.e2e-spec.ts
 * @description Step 08 - Focus View read-path e2e tests (tree + children)
 *
 * TDD Red tests for:
 * - GET /v1/topics/:topicId/tree?depth=...
 * - GET /v1/arguments/:argumentId/children?orderBy=...&beforeId=...&limit=...
 *
 * Coverage:
 * - depth semantics (1/2/3) + root always included
 * - sorting (totalVotes_desc | createdAt_desc) + default orderBy
 * - cursor pagination stability (nextBeforeId/beforeId)
 * - 404 TOPIC_NOT_FOUND / ARGUMENT_NOT_FOUND
 * - pruned filtering (public read excludes pruned)
 * - shared-contracts response parsing + authorId format
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { v7 as uuidv7 } from 'uuid';
import { randomBytes } from 'node:crypto';
import {
  zArgumentChildrenResponse,
  zErrorResponse,
  zTopicTreeResponse,
} from '@epiphany/shared-contracts';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/prisma.module';

describe('Focus View (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    jest.setTimeout(30_000);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function createTopicSeed(title: string) {
    const res = await request(app.getHttpServer())
      .post('/v1/topics')
      .send({ title, body: 'root' })
      .expect(201);
    return {
      topicId: res.body.topicId as string,
      rootArgumentId: res.body.rootArgumentId as string,
    };
  }

  function expectAuthorIdsValid(args: Array<{ authorId: string }>) {
    for (const a of args) {
      expect(a.authorId).toMatch(/^[0-9a-f]{16}$/);
    }
  }

  describe('GET /v1/topics/:topicId/tree', () => {
    it('returns depth-limited tree (1/2/3), always includes Root, and excludes pruned + subtree; response matches shared-contracts', async () => {
      const { topicId, rootArgumentId } = await createTopicSeed(
        `E2E::tree::${uuidv7()}`,
      );

      const child1Id = uuidv7();
      const childPrunedId = uuidv7();
      const grandchild1Id = uuidv7();
      const grandchildUnderPrunedId = uuidv7();
      const greatGrandchildDepth4Id = uuidv7();

      await prisma.argument.createMany({
        data: [
          {
            id: child1Id,
            topicId,
            parentId: rootArgumentId,
            title: null,
            body: 'child-1',
            authorPubkey: randomBytes(32),
            analysisStatus: 'pending_analysis',
            totalVotes: 0,
            totalCost: 0,
          },
          {
            id: childPrunedId,
            topicId,
            parentId: rootArgumentId,
            title: null,
            body: 'child-pruned',
            authorPubkey: randomBytes(32),
            analysisStatus: 'pending_analysis',
            totalVotes: 0,
            totalCost: 0,
            prunedAt: new Date(),
          },
          {
            id: grandchild1Id,
            topicId,
            parentId: child1Id,
            title: null,
            body: 'grandchild-1',
            authorPubkey: randomBytes(32),
            analysisStatus: 'pending_analysis',
            totalVotes: 0,
            totalCost: 0,
          },
          {
            id: grandchildUnderPrunedId,
            topicId,
            parentId: childPrunedId,
            title: null,
            body: 'grandchild-under-pruned',
            authorPubkey: randomBytes(32),
            analysisStatus: 'pending_analysis',
            totalVotes: 0,
            totalCost: 0,
          },
          {
            id: greatGrandchildDepth4Id,
            topicId,
            parentId: grandchild1Id,
            title: null,
            body: 'great-grandchild-depth-4',
            authorPubkey: randomBytes(32),
            analysisStatus: 'pending_analysis',
            totalVotes: 0,
            totalCost: 0,
          },
        ],
      });

      const depth1 = await request(app.getHttpServer())
        .get(`/v1/topics/${topicId}/tree?depth=1`)
        .expect(200);
      const depth1Parsed = zTopicTreeResponse.safeParse(depth1.body);
      expect(depth1Parsed.success).toBe(true);
      if (!depth1Parsed.success) return;
      expect(depth1Parsed.data.topic.id).toBe(topicId);
      expect(depth1Parsed.data.topic.rootArgumentId).toBe(rootArgumentId);
      expect(depth1Parsed.data.depth).toBe(1);
      expect(depth1Parsed.data.arguments.map((a) => a.id)).toEqual([
        rootArgumentId,
      ]);
      expectAuthorIdsValid(depth1Parsed.data.arguments);

      const depth2 = await request(app.getHttpServer())
        .get(`/v1/topics/${topicId}/tree?depth=2`)
        .expect(200);
      const depth2Parsed = zTopicTreeResponse.safeParse(depth2.body);
      expect(depth2Parsed.success).toBe(true);
      if (!depth2Parsed.success) return;
      expect(depth2Parsed.data.depth).toBe(2);
      expect(depth2Parsed.data.arguments.map((a) => a.id)).toEqual([
        rootArgumentId,
        child1Id,
      ]);
      expectAuthorIdsValid(depth2Parsed.data.arguments);

      const depth3 = await request(app.getHttpServer())
        .get(`/v1/topics/${topicId}/tree?depth=3`)
        .expect(200);
      const depth3Parsed = zTopicTreeResponse.safeParse(depth3.body);
      expect(depth3Parsed.success).toBe(true);
      if (!depth3Parsed.success) return;
      expect(depth3Parsed.data.depth).toBe(3);

      const idsDepth3 = depth3Parsed.data.arguments.map((a) => a.id);
      expect(idsDepth3).toEqual([rootArgumentId, child1Id, grandchild1Id]);
      expect(idsDepth3).not.toContain(childPrunedId);
      expect(idsDepth3).not.toContain(grandchildUnderPrunedId);
      expect(idsDepth3).not.toContain(greatGrandchildDepth4Id);
      expectAuthorIdsValid(depth3Parsed.data.arguments);
    });

    it('returns 404 TOPIC_NOT_FOUND when topicId does not exist', async () => {
      const missingTopicId = uuidv7();
      const res = await request(app.getHttpServer())
        .get(`/v1/topics/${missingTopicId}/tree?depth=3`)
        .expect(404);

      const parsed = zErrorResponse.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.error.code).toBe('TOPIC_NOT_FOUND');
      }
    });
  });

  describe('GET /v1/arguments/:argumentId/children', () => {
    it('orderBy=totalVotes_desc sorts by arguments.total_votes (default orderBy is totalVotes_desc), excludes pruned, and matches shared-contracts', async () => {
      const { topicId, rootArgumentId } = await createTopicSeed(
        `E2E::children::votes::${uuidv7()}`,
      );

      const childA = uuidv7();
      const childB = uuidv7();
      const childC = uuidv7();
      const childD = uuidv7();
      const childPruned = uuidv7();

      await prisma.argument.createMany({
        data: [
          {
            id: childA,
            topicId,
            parentId: rootArgumentId,
            title: null,
            body: 'A',
            authorPubkey: randomBytes(32),
            analysisStatus: 'pending_analysis',
            totalVotes: 10,
            totalCost: 100,
            createdAt: new Date('2025-01-01T00:00:00.000Z'),
          },
          {
            id: childB,
            topicId,
            parentId: rootArgumentId,
            title: null,
            body: 'B',
            authorPubkey: randomBytes(32),
            analysisStatus: 'pending_analysis',
            totalVotes: 7,
            totalCost: 49,
            createdAt: new Date('2025-01-02T00:00:00.000Z'),
          },
          {
            id: childC,
            topicId,
            parentId: rootArgumentId,
            title: null,
            body: 'C',
            authorPubkey: randomBytes(32),
            analysisStatus: 'pending_analysis',
            totalVotes: 5,
            totalCost: 25,
            createdAt: new Date('2025-01-03T00:00:00.000Z'),
          },
          {
            id: childD,
            topicId,
            parentId: rootArgumentId,
            title: null,
            body: 'D',
            authorPubkey: randomBytes(32),
            analysisStatus: 'pending_analysis',
            totalVotes: 1,
            totalCost: 1,
            createdAt: new Date('2025-01-04T00:00:00.000Z'),
          },
          {
            id: childPruned,
            topicId,
            parentId: rootArgumentId,
            title: null,
            body: 'PRUNED',
            authorPubkey: randomBytes(32),
            analysisStatus: 'pending_analysis',
            totalVotes: 100,
            totalCost: 10_000,
            prunedAt: new Date(),
            createdAt: new Date('2025-01-05T00:00:00.000Z'),
          },
        ],
      });

      const explicit = await request(app.getHttpServer())
        .get(`/v1/arguments/${rootArgumentId}/children?orderBy=totalVotes_desc`)
        .expect(200);

      const explicitParsed = zArgumentChildrenResponse.safeParse(explicit.body);
      expect(explicitParsed.success).toBe(true);
      if (!explicitParsed.success) return;
      expect(explicitParsed.data.parentArgumentId).toBe(rootArgumentId);
      expect(explicitParsed.data.items.map((a) => a.id)).toEqual([
        childA,
        childB,
        childC,
        childD,
      ]);
      expect(explicitParsed.data.nextBeforeId).toBeNull();
      expectAuthorIdsValid(explicitParsed.data.items);

      const implicit = await request(app.getHttpServer())
        .get(`/v1/arguments/${rootArgumentId}/children`)
        .expect(200);

      const implicitParsed = zArgumentChildrenResponse.safeParse(implicit.body);
      expect(implicitParsed.success).toBe(true);
      if (!implicitParsed.success) return;
      expect(implicitParsed.data.items.map((a) => a.id)).toEqual(
        explicitParsed.data.items.map((a) => a.id),
      );
    });

    it('orderBy=createdAt_desc paginates stably with beforeId/nextBeforeId (no duplicates), excludes pruned, and matches shared-contracts', async () => {
      const { topicId, rootArgumentId } = await createTopicSeed(
        `E2E::children::createdAt::${uuidv7()}`,
      );

      const c1 = uuidv7();
      const c2 = uuidv7();
      const c3 = uuidv7();
      const c4 = uuidv7();
      const c5 = uuidv7();
      const pruned = uuidv7();

      await prisma.argument.createMany({
        data: [
          {
            id: c1,
            topicId,
            parentId: rootArgumentId,
            title: null,
            body: 'c1',
            authorPubkey: randomBytes(32),
            analysisStatus: 'pending_analysis',
            totalVotes: 1,
            totalCost: 1,
            createdAt: new Date('2025-01-01T00:00:00.000Z'),
          },
          {
            id: c2,
            topicId,
            parentId: rootArgumentId,
            title: null,
            body: 'c2',
            authorPubkey: randomBytes(32),
            analysisStatus: 'pending_analysis',
            totalVotes: 2,
            totalCost: 4,
            createdAt: new Date('2025-01-02T00:00:00.000Z'),
          },
          {
            id: c3,
            topicId,
            parentId: rootArgumentId,
            title: null,
            body: 'c3',
            authorPubkey: randomBytes(32),
            analysisStatus: 'pending_analysis',
            totalVotes: 3,
            totalCost: 9,
            createdAt: new Date('2025-01-03T00:00:00.000Z'),
          },
          {
            id: c4,
            topicId,
            parentId: rootArgumentId,
            title: null,
            body: 'c4',
            authorPubkey: randomBytes(32),
            analysisStatus: 'pending_analysis',
            totalVotes: 4,
            totalCost: 16,
            createdAt: new Date('2025-01-04T00:00:00.000Z'),
          },
          {
            id: c5,
            topicId,
            parentId: rootArgumentId,
            title: null,
            body: 'c5',
            authorPubkey: randomBytes(32),
            analysisStatus: 'pending_analysis',
            totalVotes: 5,
            totalCost: 25,
            createdAt: new Date('2025-01-05T00:00:00.000Z'),
          },
          {
            id: pruned,
            topicId,
            parentId: rootArgumentId,
            title: null,
            body: 'pruned',
            authorPubkey: randomBytes(32),
            analysisStatus: 'pending_analysis',
            totalVotes: 999,
            totalCost: 999,
            prunedAt: new Date(),
            createdAt: new Date('2025-01-06T00:00:00.000Z'),
          },
        ],
      });

      const expectedOrder = [c5, c4, c3, c2, c1];

      const page1 = await request(app.getHttpServer())
        .get(
          `/v1/arguments/${rootArgumentId}/children?orderBy=createdAt_desc&limit=2`,
        )
        .expect(200);
      const page1Parsed = zArgumentChildrenResponse.safeParse(page1.body);
      expect(page1Parsed.success).toBe(true);
      if (!page1Parsed.success) return;
      expect(page1Parsed.data.items.map((a) => a.id)).toEqual(
        expectedOrder.slice(0, 2),
      );
      expect(page1Parsed.data.nextBeforeId).toBe(expectedOrder[1]);

      const page2 = await request(app.getHttpServer())
        .get(
          `/v1/arguments/${rootArgumentId}/children?orderBy=createdAt_desc&limit=2&beforeId=${page1Parsed.data.nextBeforeId}`,
        )
        .expect(200);
      const page2Parsed = zArgumentChildrenResponse.safeParse(page2.body);
      expect(page2Parsed.success).toBe(true);
      if (!page2Parsed.success) return;
      expect(page2Parsed.data.items.map((a) => a.id)).toEqual(
        expectedOrder.slice(2, 4),
      );
      expect(page2Parsed.data.nextBeforeId).toBe(expectedOrder[3]);

      const page3 = await request(app.getHttpServer())
        .get(
          `/v1/arguments/${rootArgumentId}/children?orderBy=createdAt_desc&limit=2&beforeId=${page2Parsed.data.nextBeforeId}`,
        )
        .expect(200);
      const page3Parsed = zArgumentChildrenResponse.safeParse(page3.body);
      expect(page3Parsed.success).toBe(true);
      if (!page3Parsed.success) return;
      expect(page3Parsed.data.items.map((a) => a.id)).toEqual(
        expectedOrder.slice(4, 5),
      );
      expect(page3Parsed.data.nextBeforeId).toBeNull();

      const all = [
        ...page1Parsed.data.items.map((a) => a.id),
        ...page2Parsed.data.items.map((a) => a.id),
        ...page3Parsed.data.items.map((a) => a.id),
      ];
      expect(new Set(all).size).toBe(all.length);
      expect(all).toEqual(expectedOrder);

      expectAuthorIdsValid([
        ...page1Parsed.data.items,
        ...page2Parsed.data.items,
        ...page3Parsed.data.items,
      ]);
    });

    it('clamps limit to 100 (max) and returns nextBeforeId when more items exist', async () => {
      const { topicId, rootArgumentId } = await createTopicSeed(
        `E2E::children::limit::${uuidv7()}`,
      );

      const authorPubkey = Buffer.alloc(32);

      const many = Array.from({ length: 101 }, () => ({
        id: uuidv7(),
        topicId,
        parentId: rootArgumentId,
        title: null,
        body: 'child',
        authorPubkey,
        analysisStatus: 'pending_analysis' as const,
        totalVotes: 0,
        totalCost: 0,
      }));

      await prisma.argument.createMany({ data: many });

      const res = await request(app.getHttpServer())
        .get(`/v1/arguments/${rootArgumentId}/children?limit=1000`)
        .expect(200);

      const parsed = zArgumentChildrenResponse.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;

      expect(parsed.data.items.length).toBe(100);
      expect(parsed.data.nextBeforeId).not.toBeNull();
    });

    it('returns 404 ARGUMENT_NOT_FOUND when argumentId does not exist', async () => {
      const missingArgumentId = uuidv7();
      const res = await request(app.getHttpServer())
        .get(`/v1/arguments/${missingArgumentId}/children`)
        .expect(404);

      const parsed = zErrorResponse.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.error.code).toBe('ARGUMENT_NOT_FOUND');
      }
    });
  });
});

