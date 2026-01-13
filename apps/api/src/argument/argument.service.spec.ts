import { ArgumentService } from './argument.service';

describe('ArgumentService.getArgument', () => {
  it('drops bodyRich when body is localized via overrides', async () => {
    const argumentId = 'arg-1';
    const originalBody = '目前没有证据表明，密码朋克具备某种可行的社会理论。';
    const translatedBody = 'There is currently no evidence indicating that cypherpunks…';
    const bodyRich = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: originalBody }] }] };

    const prisma = {
      argument: {
        findFirst: jest.fn().mockResolvedValue({
          id: argumentId,
          topicId: 'topic-1',
          parentId: null,
          title: null,
          body: originalBody,
          bodyRich,
          authorPubkey: new Uint8Array(32),
          analysisStatus: 'ready',
          stanceScore: null,
          totalVotes: 0,
          totalCost: 0,
          prunedAt: null,
          createdAt: new Date('2026-01-12T00:00:00.000Z'),
          updatedAt: new Date('2026-01-12T00:00:00.000Z'),
        }),
      },
      topicIdentityProfile: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    } as any;

    const translations = {
      getArgumentOverrides: jest
        .fn()
        .mockResolvedValue(new Map([[argumentId, { title: null, body: translatedBody }]])),
      getDisplayNameOverrides: jest.fn().mockResolvedValue(new Map()),
    } as any;

    const service = new ArgumentService(prisma, {} as any, {} as any, translations);
    const result = await service.getArgument(argumentId, 'en' as any);

    expect(result.argument.body).toBe(translatedBody);
    expect(result.argument.bodyRich).toBeNull();
  });

  it('keeps bodyRich when overrides do not change the body', async () => {
    const argumentId = 'arg-2';
    const body = 'Hello world';
    const bodyRich = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: body }] }] };

    const prisma = {
      argument: {
        findFirst: jest.fn().mockResolvedValue({
          id: argumentId,
          topicId: 'topic-1',
          parentId: null,
          title: null,
          body,
          bodyRich,
          authorPubkey: new Uint8Array(32),
          analysisStatus: 'ready',
          stanceScore: null,
          totalVotes: 0,
          totalCost: 0,
          prunedAt: null,
          createdAt: new Date('2026-01-12T00:00:00.000Z'),
          updatedAt: new Date('2026-01-12T00:00:00.000Z'),
        }),
      },
      topicIdentityProfile: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    } as any;

    const translations = {
      getArgumentOverrides: jest.fn().mockResolvedValue(new Map([[argumentId, { title: 'Title', body }]])),
      getDisplayNameOverrides: jest.fn().mockResolvedValue(new Map()),
    } as any;

    const service = new ArgumentService(prisma, {} as any, {} as any, translations);
    const result = await service.getArgument(argumentId, 'zh' as any);

    expect(result.argument.body).toBe(body);
    expect(result.argument.bodyRich).toEqual(bodyRich);
  });
});

