/**
 * @file objects.test.ts
 * @description Tests for core DTO schemas: TopicSummary, Argument, LedgerMe, StakeMeItem
 * @see docs/api-contract.md#2.3-2.6
 */
import {
  zTopicSummary,
  zArgument,
  zLedgerMe,
  zStakeMeItem,
  zClusterMap,
  type TopicSummary,
  type Argument,
  type LedgerMe,
  type StakeMeItem,
  type ClusterMap,
} from '../index.js';

describe('TopicSummary', () => {
  it('should parse a valid TopicSummary', () => {
    const fixture: TopicSummary = {
      id: '0193e3a6-0b7d-7a8d-9f2c-1234567890ab',
      title: 'Test Topic',
      rootArgumentId: '0193e3a6-0b7d-7a8d-9f2c-abcdef123456',
      status: 'active',
      ownerPubkey: null,
      createdAt: '2025-12-19T12:34:56.789Z',
      updatedAt: '2025-12-19T12:34:56.789Z',
    };

    const result = zTopicSummary.safeParse(fixture);
    expect(result.success).toBe(true);
  });

  it('should accept all valid status values', () => {
    const statuses = ['active', 'frozen', 'archived'] as const;

    statuses.forEach((status) => {
      const fixture = {
        id: '0193e3a6-0b7d-7a8d-9f2c-1234567890ab',
        title: 'Test',
        rootArgumentId: '0193e3a6-0b7d-7a8d-9f2c-abcdef123456',
        status,
        ownerPubkey: null,
        createdAt: '2025-12-19T12:34:56.789Z',
        updatedAt: '2025-12-19T12:34:56.789Z',
      };
      expect(zTopicSummary.safeParse(fixture).success).toBe(true);
    });
  });

  it('should accept ownerPubkey as hex string', () => {
    const fixture = {
      id: '0193e3a6-0b7d-7a8d-9f2c-1234567890ab',
      title: 'Test',
      rootArgumentId: '0193e3a6-0b7d-7a8d-9f2c-abcdef123456',
      status: 'active',
      ownerPubkey: 'abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234',
      createdAt: '2025-12-19T12:34:56.789Z',
      updatedAt: '2025-12-19T12:34:56.789Z',
    };
    expect(zTopicSummary.safeParse(fixture).success).toBe(true);
  });

  it('should use ISO 8601 format for dates', () => {
    const fixture = {
      id: '0193e3a6-0b7d-7a8d-9f2c-1234567890ab',
      title: 'Test',
      rootArgumentId: '0193e3a6-0b7d-7a8d-9f2c-abcdef123456',
      status: 'active',
      ownerPubkey: null,
      createdAt: '2025-12-19T12:34:56.789Z',
      updatedAt: '2025-12-20T00:00:00.000Z',
    };

    const result = zTopicSummary.safeParse(fixture);
    expect(result.success).toBe(true);
  });
});

describe('Argument', () => {
  it('should parse a valid Argument', () => {
    const fixture: Argument = {
      id: '0193e3a6-0b7d-7a8d-9f2c-1234567890ab',
      topicId: '0193e3a6-0b7d-7a8d-9f2c-abcdef123456',
      parentId: null,
      title: 'Root argument title',
      body: 'This is the body of the argument.',
      authorId: 'abcd1234abcd1234', // 16 hex chars, lowercase
      analysisStatus: 'pending_analysis',
      stanceScore: null,
      totalVotes: 0,
      totalCost: 0,
      prunedAt: null,
      createdAt: '2025-12-19T12:34:56.789Z',
      updatedAt: '2025-12-19T12:34:56.789Z',
    };

    const result = zArgument.safeParse(fixture);
    expect(result.success).toBe(true);
  });

  it('should require authorId to be 16 hex chars lowercase', () => {
    const validAuthorIds = [
      'abcd1234abcd1234',
      '0123456789abcdef',
      'deadbeefcafebabe',
    ];

    validAuthorIds.forEach((authorId) => {
      const fixture = {
        id: '0193e3a6-0b7d-7a8d-9f2c-1234567890ab',
        topicId: '0193e3a6-0b7d-7a8d-9f2c-abcdef123456',
        parentId: null,
        title: null,
        body: 'Test body',
        authorId,
        analysisStatus: 'ready',
        stanceScore: 0.5,
        totalVotes: 10,
        totalCost: 100,
        prunedAt: null,
        createdAt: '2025-12-19T12:34:56.789Z',
        updatedAt: '2025-12-19T12:34:56.789Z',
      };
      expect(zArgument.safeParse(fixture).success).toBe(true);
    });
  });

  it('should reject uppercase authorId', () => {
    const fixture = {
      id: '0193e3a6-0b7d-7a8d-9f2c-1234567890ab',
      topicId: '0193e3a6-0b7d-7a8d-9f2c-abcdef123456',
      parentId: null,
      title: null,
      body: 'Test body',
      authorId: 'ABCD1234ABCD1234', // uppercase - should fail
      analysisStatus: 'ready',
      stanceScore: 0.5,
      totalVotes: 10,
      totalCost: 100,
      prunedAt: null,
      createdAt: '2025-12-19T12:34:56.789Z',
      updatedAt: '2025-12-19T12:34:56.789Z',
    };
    expect(zArgument.safeParse(fixture).success).toBe(false);
  });

  it('should accept all valid analysisStatus values', () => {
    const statuses = ['pending_analysis', 'ready', 'failed'] as const;

    statuses.forEach((analysisStatus) => {
      const fixture = {
        id: '0193e3a6-0b7d-7a8d-9f2c-1234567890ab',
        topicId: '0193e3a6-0b7d-7a8d-9f2c-abcdef123456',
        parentId: null,
        title: null,
        body: 'Test',
        authorId: 'abcd1234abcd1234',
        analysisStatus,
        stanceScore: analysisStatus === 'ready' ? 0 : null,
        totalVotes: 0,
        totalCost: 0,
        prunedAt: null,
        createdAt: '2025-12-19T12:34:56.789Z',
        updatedAt: '2025-12-19T12:34:56.789Z',
      };
      expect(zArgument.safeParse(fixture).success).toBe(true);
    });
  });

  it('should accept stanceScore in range [-1, 1]', () => {
    const scores = [-1, -0.5, 0, 0.5, 1];

    scores.forEach((stanceScore) => {
      const fixture = {
        id: '0193e3a6-0b7d-7a8d-9f2c-1234567890ab',
        topicId: '0193e3a6-0b7d-7a8d-9f2c-abcdef123456',
        parentId: null,
        title: null,
        body: 'Test',
        authorId: 'abcd1234abcd1234',
        analysisStatus: 'ready',
        stanceScore,
        totalVotes: 0,
        totalCost: 0,
        prunedAt: null,
        createdAt: '2025-12-19T12:34:56.789Z',
        updatedAt: '2025-12-19T12:34:56.789Z',
      };
      expect(zArgument.safeParse(fixture).success).toBe(true);
    });
  });

  it('should accept parentId for non-root arguments', () => {
    const fixture = {
      id: '0193e3a6-0b7d-7a8d-9f2c-1234567890ab',
      topicId: '0193e3a6-0b7d-7a8d-9f2c-abcdef123456',
      parentId: '0193e3a6-0b7d-7a8d-9f2c-parent123456',
      title: 'Reply title',
      body: 'This is a reply.',
      authorId: 'abcd1234abcd1234',
      analysisStatus: 'pending_analysis',
      stanceScore: null,
      totalVotes: 5,
      totalCost: 25,
      prunedAt: null,
      createdAt: '2025-12-19T12:34:56.789Z',
      updatedAt: '2025-12-19T12:34:56.789Z',
    };

    const result = zArgument.safeParse(fixture);
    expect(result.success).toBe(true);
  });

  it('should accept prunedAt as ISO string', () => {
    const fixture = {
      id: '0193e3a6-0b7d-7a8d-9f2c-1234567890ab',
      topicId: '0193e3a6-0b7d-7a8d-9f2c-abcdef123456',
      parentId: null,
      title: null,
      body: 'Test',
      authorId: 'abcd1234abcd1234',
      analysisStatus: 'ready',
      stanceScore: 0,
      totalVotes: 0,
      totalCost: 0,
      prunedAt: '2025-12-19T15:00:00.000Z',
      createdAt: '2025-12-19T12:34:56.789Z',
      updatedAt: '2025-12-19T12:34:56.789Z',
    };

    const result = zArgument.safeParse(fixture);
    expect(result.success).toBe(true);
  });
});

describe('LedgerMe', () => {
  it('should parse a valid LedgerMe', () => {
    const fixture: LedgerMe = {
      topicId: '0193e3a6-0b7d-7a8d-9f2c-1234567890ab',
      pubkey: 'abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234',
      balance: 100,
      myTotalVotes: 0,
      myTotalCost: 0,
      lastInteractionAt: null,
    };

    const result = zLedgerMe.safeParse(fixture);
    expect(result.success).toBe(true);
  });

  it('should use integer values for numeric fields', () => {
    const fixture = {
      topicId: '0193e3a6-0b7d-7a8d-9f2c-1234567890ab',
      pubkey: 'abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234',
      balance: 92,
      myTotalVotes: 5,
      myTotalCost: 25,
      lastInteractionAt: '2025-12-19T12:34:56.789Z',
    };

    const result = zLedgerMe.safeParse(fixture);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Number.isInteger(result.data.balance)).toBe(true);
      expect(Number.isInteger(result.data.myTotalVotes)).toBe(true);
      expect(Number.isInteger(result.data.myTotalCost)).toBe(true);
    }
  });
});

describe('StakeMeItem', () => {
  it('should parse a valid StakeMeItem', () => {
    const fixture: StakeMeItem = {
      argumentId: '0193e3a6-0b7d-7a8d-9f2c-1234567890ab',
      votes: 3,
      cost: 9,
      argumentPrunedAt: null,
      updatedAt: '2025-12-19T12:34:56.789Z',
      argumentTitle: null,
      argumentExcerpt: 'This is an excerpt of the argument...',
    };

    const result = zStakeMeItem.safeParse(fixture);
    expect(result.success).toBe(true);
  });

  it('should use integer values for votes and cost', () => {
    const fixture = {
      argumentId: '0193e3a6-0b7d-7a8d-9f2c-1234567890ab',
      votes: 5,
      cost: 25, // 5^2
      argumentPrunedAt: null,
      updatedAt: '2025-12-19T12:34:56.789Z',
      argumentTitle: 'Some title',
      argumentExcerpt: null,
    };

    const result = zStakeMeItem.safeParse(fixture);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Number.isInteger(result.data.votes)).toBe(true);
      expect(Number.isInteger(result.data.cost)).toBe(true);
    }
  });

  it('should accept argumentPrunedAt as ISO string', () => {
    const fixture = {
      argumentId: '0193e3a6-0b7d-7a8d-9f2c-1234567890ab',
      votes: 2,
      cost: 4,
      argumentPrunedAt: '2025-12-19T15:00:00.000Z',
      updatedAt: '2025-12-19T12:34:56.789Z',
      argumentTitle: null,
      argumentExcerpt: 'Excerpt',
    };

    const result = zStakeMeItem.safeParse(fixture);
    expect(result.success).toBe(true);
  });
});

describe('ClusterMap', () => {
  it('should parse a valid ClusterMap', () => {
    const fixture: ClusterMap = {
      topicId: '0193e3a6-0b7d-7a8d-9f2c-1234567890ab',
      modelVersion: 'v1-2025-12-19T12:00:00.000Z',
      computedAt: '2025-12-19T12:34:56.789Z',
      points: [
        {
          argumentId: '0193e3a6-0b7d-7a8d-9f2c-point0000001',
          x: -0.5,
          y: 0.3,
          clusterId: 'cluster-1',
          stance: -1,
          weight: 1.5,
        },
        {
          argumentId: '0193e3a6-0b7d-7a8d-9f2c-point0000002',
          x: 0.7,
          y: -0.2,
          clusterId: 'cluster-2',
          stance: 1,
          weight: 2.3,
        },
      ],
      clusters: [
        {
          id: 'cluster-1',
          label: 'Opposition',
          summary: 'Arguments against the topic',
          centroid: { x: -0.6, y: 0.2 },
        },
        {
          id: 'cluster-2',
          label: 'Support',
          summary: null,
          centroid: { x: 0.8, y: -0.1 },
        },
      ],
    };

    const result = zClusterMap.safeParse(fixture);
    expect(result.success).toBe(true);
  });

  it('should accept x and y in range [-1, 1]', () => {
    const fixture = {
      topicId: '0193e3a6-0b7d-7a8d-9f2c-1234567890ab',
      modelVersion: 'v1',
      computedAt: '2025-12-19T12:34:56.789Z',
      points: [
        {
          argumentId: '0193e3a6-0b7d-7a8d-9f2c-point0000001',
          x: -1,
          y: 1,
          clusterId: 'c1',
          stance: 0,
          weight: 1.0,
        },
        {
          argumentId: '0193e3a6-0b7d-7a8d-9f2c-point0000002',
          x: 1,
          y: -1,
          clusterId: 'c1',
          stance: 0,
          weight: 1.0,
        },
      ],
      clusters: [
        {
          id: 'c1',
          label: null,
          summary: null,
          centroid: { x: 0, y: 0 },
        },
      ],
    };

    const result = zClusterMap.safeParse(fixture);
    expect(result.success).toBe(true);
  });

  it('should accept stance values -1, 0, 1', () => {
    const stances = [-1, 0, 1] as const;

    stances.forEach((stance) => {
      const fixture = {
        topicId: '0193e3a6-0b7d-7a8d-9f2c-1234567890ab',
        modelVersion: 'v1',
        computedAt: '2025-12-19T12:34:56.789Z',
        points: [
          {
            argumentId: '0193e3a6-0b7d-7a8d-9f2c-point0000001',
            x: 0,
            y: 0,
            clusterId: 'c1',
            stance,
            weight: 1.0,
          },
        ],
        clusters: [
          {
            id: 'c1',
            label: null,
            summary: null,
            centroid: { x: 0, y: 0 },
          },
        ],
      };

      expect(zClusterMap.safeParse(fixture).success).toBe(true);
    });
  });
});
