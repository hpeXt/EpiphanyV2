/**
 * @file endpoints.test.ts
 * @description Tests for API endpoint response schemas
 * @see docs/stage01/api-contract.md#3.x
 */
import {
  // POST /v1/topics
  zCreateTopicResponse,
  // GET /v1/topics
  zListTopicsResponse,
  // GET /v1/topics/:topicId/tree
  zTopicTreeResponse,
  // GET /v1/arguments/:argumentId/children
  zArgumentChildrenResponse,
  // POST /v1/arguments/:argumentId/edit
  zEditArgumentRequest,
  zEditArgumentResponse,
  // POST /v1/topics/:topicId/arguments
  zCreateArgumentRequest,
  zCreateArgumentResponse,
  // POST /v1/arguments/:argumentId/votes
  zSetVotesResponse,
  // GET /v1/topics/:topicId/ledger/me
  zLedgerMe,
  // GET /v1/topics/:topicId/stakes/me
  zStakesMeResponse,
  // POST /v1/user/batch-balance
  zBatchBalanceResponse,
  // GET /v1/topics/:topicId/cluster-map
  zClusterMap,
  // GET /v1/topics/:topicId/consensus-report/latest
  zConsensusReportLatestResponse,
  // POST /v1/topics/:topicId/commands
  zTopicCommand,
  type CreateTopicResponse,
  type ListTopicsResponse,
  type TopicTreeResponse,
  type ArgumentChildrenResponse,
  type CreateArgumentResponse,
  type SetVotesResponse,
  type StakesMeResponse,
  type BatchBalanceResponse,
  type ConsensusReportLatestResponse,
} from '../index.js';

describe('POST /v1/arguments/:argumentId/edit request', () => {
  it('should accept bodyRich (TipTap/ProseMirror JSON) and preserve it', () => {
    const fixture = {
      body: 'Updated body',
      bodyRich: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Updated body' }],
          },
        ],
      },
    };

    const result = zEditArgumentRequest.safeParse(fixture);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect((result.data as any).bodyRich).toEqual(fixture.bodyRich);
  });

  it('should parse a valid response', () => {
    const fixture = {
      argument: {
        id: '0193e3a6-0b7d-7a8d-9f2c-abcdef123456',
        topicId: '0193e3a6-0b7d-7a8d-9f2c-1234567890ab',
        parentId: '0193e3a6-0b7d-7a8d-9f2c-parent123456',
        title: null,
        body: 'Updated body',
        bodyRich: { type: 'doc', content: [] },
        authorId: 'fd704b74dc0c1225',
        analysisStatus: 'pending_analysis',
        stanceScore: null,
        totalVotes: 0,
        totalCost: 0,
        prunedAt: null,
        createdAt: '2025-12-19T12:34:56.789Z',
        updatedAt: '2025-12-19T12:35:56.789Z',
      },
    };

    const result = zEditArgumentResponse.safeParse(fixture);
    expect(result.success).toBe(true);
  });
});

describe('POST /v1/topics/:topicId/arguments request', () => {
  it('should accept bodyRich (TipTap/ProseMirror JSON) and preserve it', () => {
    const fixture = {
      parentId: '0193e3a6-0b7d-7a8d-9f2c-parent123456',
      title: null,
      body: 'Hello world',
      bodyRich: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Hello world' }],
          },
        ],
      },
      initialVotes: 0,
    };

    const result = zCreateArgumentRequest.safeParse(fixture);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect((result.data as any).bodyRich).toEqual(fixture.bodyRich);
  });
});

describe('POST /v1/topics response', () => {
  it('should parse a valid response with claimToken and expiresAt', () => {
    const fixture: CreateTopicResponse = {
      topicId: '0193e3a6-0b7d-7a8d-9f2c-1234567890ab',
      rootArgumentId: '0193e3a6-0b7d-7a8d-9f2c-abcdef123456',
      claimToken: 'abc123xyz789secure-token',
      expiresAt: '2025-12-19T12:34:56.789Z',
    };

    const result = zCreateTopicResponse.safeParse(fixture);
    expect(result.success).toBe(true);
  });

  it('should require all fields', () => {
    const incomplete = {
      topicId: '0193e3a6-0b7d-7a8d-9f2c-1234567890ab',
      rootArgumentId: '0193e3a6-0b7d-7a8d-9f2c-abcdef123456',
      // missing claimToken and expiresAt
    };

    const result = zCreateTopicResponse.safeParse(incomplete);
    expect(result.success).toBe(false);
  });
});

describe('GET /v1/topics response', () => {
  it('should parse a valid response with nextBeforeId', () => {
    const fixture: ListTopicsResponse = {
      items: [
        {
          id: '0193e3a6-0b7d-7a8d-9f2c-1234567890ab',
          title: 'First Topic',
          rootArgumentId: '0193e3a6-0b7d-7a8d-9f2c-abcdef123456',
          visibility: 'public',
          status: 'active',
          ownerPubkey: null,
          createdAt: '2025-12-19T12:34:56.789Z',
          updatedAt: '2025-12-19T12:34:56.789Z',
        },
        {
          id: '0193e3a6-0b7d-7a8d-9f2c-second123456',
          title: 'Second Topic',
          rootArgumentId: '0193e3a6-0b7d-7a8d-9f2c-root00000002',
          visibility: 'public',
          status: 'frozen',
          ownerPubkey: 'abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234',
          createdAt: '2025-12-18T10:00:00.000Z',
          updatedAt: '2025-12-19T08:00:00.000Z',
        },
      ],
      nextBeforeId: '0193e3a6-0b7d-7a8d-9f2c-cursor123456',
    };

    const result = zListTopicsResponse.safeParse(fixture);
    expect(result.success).toBe(true);
  });

  it('should accept null nextBeforeId when no more pages', () => {
    const fixture = {
      items: [],
      nextBeforeId: null,
    };

    const result = zListTopicsResponse.safeParse(fixture);
    expect(result.success).toBe(true);
  });
});

describe('GET /v1/topics/:topicId/tree response', () => {
  it('should parse a valid response with topic, depth, and arguments', () => {
    const fixture: TopicTreeResponse = {
	      topic: {
	        id: '0193e3a6-0b7d-7a8d-9f2c-1234567890ab',
	        title: 'Discussion Topic',
	        rootArgumentId: '0193e3a6-0b7d-7a8d-9f2c-root00000001',
	        visibility: 'public',
	        status: 'active',
	        ownerPubkey: null,
	        createdAt: '2025-12-19T12:34:56.789Z',
	        updatedAt: '2025-12-19T12:34:56.789Z',
	      },
      depth: 3,
      arguments: [
        {
          id: '0193e3a6-0b7d-7a8d-9f2c-root00000001',
          topicId: '0193e3a6-0b7d-7a8d-9f2c-1234567890ab',
          parentId: null,
          title: 'Root Argument',
          body: 'This is the root argument of the topic.',
          authorId: 'abcd1234abcd1234',
          analysisStatus: 'ready',
          stanceScore: 0,
          totalVotes: 10,
          totalCost: 100,
          prunedAt: null,
          createdAt: '2025-12-19T12:34:56.789Z',
          updatedAt: '2025-12-19T12:34:56.789Z',
        },
        {
          id: '0193e3a6-0b7d-7a8d-9f2c-arg000000002',
          topicId: '0193e3a6-0b7d-7a8d-9f2c-1234567890ab',
          parentId: '0193e3a6-0b7d-7a8d-9f2c-root00000001',
          title: null,
          body: 'A reply to the root.',
          authorId: 'deadbeefcafe1234',
          analysisStatus: 'pending_analysis',
          stanceScore: null,
          totalVotes: 5,
          totalCost: 25,
          prunedAt: null,
          createdAt: '2025-12-19T13:00:00.000Z',
          updatedAt: '2025-12-19T13:00:00.000Z',
        },
      ],
    };

    const result = zTopicTreeResponse.safeParse(fixture);
    expect(result.success).toBe(true);
  });

  it('should accept depth values 1-6', () => {
    const depths = [1, 2, 3, 4, 5, 6];

    depths.forEach((depth) => {
      const fixture = {
	        topic: {
	          id: '0193e3a6-0b7d-7a8d-9f2c-1234567890ab',
	          title: 'Test',
	          rootArgumentId: '0193e3a6-0b7d-7a8d-9f2c-root00000001',
	          visibility: 'public',
	          status: 'active',
	          ownerPubkey: null,
	          createdAt: '2025-12-19T12:34:56.789Z',
	          updatedAt: '2025-12-19T12:34:56.789Z',
	        },
        depth,
        arguments: [],
      };

      expect(zTopicTreeResponse.safeParse(fixture).success).toBe(true);
    });
  });
});

describe('GET /v1/arguments/:argumentId/children response', () => {
  it('should parse a valid response with items and nextBeforeId', () => {
    const fixture: ArgumentChildrenResponse = {
      parentArgumentId: '0193e3a6-0b7d-7a8d-9f2c-parent123456',
      items: [
        {
          id: '0193e3a6-0b7d-7a8d-9f2c-child0000001',
          topicId: '0193e3a6-0b7d-7a8d-9f2c-topic0123456',
          parentId: '0193e3a6-0b7d-7a8d-9f2c-parent123456',
          title: null,
          body: 'Child argument body',
          authorId: 'abcd1234abcd1234',
          analysisStatus: 'ready',
          stanceScore: 0.5,
          totalVotes: 3,
          totalCost: 9,
          prunedAt: null,
          createdAt: '2025-12-19T12:34:56.789Z',
          updatedAt: '2025-12-19T12:34:56.789Z',
        },
      ],
      nextBeforeId: '0193e3a6-0b7d-7a8d-9f2c-cursor123456',
    };

    const result = zArgumentChildrenResponse.safeParse(fixture);
    expect(result.success).toBe(true);
  });

  it('should accept null nextBeforeId', () => {
    const fixture = {
      parentArgumentId: '0193e3a6-0b7d-7a8d-9f2c-parent123456',
      items: [],
      nextBeforeId: null,
    };

    const result = zArgumentChildrenResponse.safeParse(fixture);
    expect(result.success).toBe(true);
  });
});

describe('POST /v1/topics/:topicId/arguments response', () => {
  it('should parse a valid response with argument and ledger', () => {
    const fixture: CreateArgumentResponse = {
      argument: {
        id: '0193e3a6-0b7d-7a8d-9f2c-newarg123456',
        topicId: '0193e3a6-0b7d-7a8d-9f2c-topic0123456',
        parentId: '0193e3a6-0b7d-7a8d-9f2c-parent123456',
        title: null,
        body: 'New argument body',
        authorId: 'abcd1234abcd1234',
        analysisStatus: 'pending_analysis',
        stanceScore: null,
        totalVotes: 0,
        totalCost: 0,
        prunedAt: null,
        createdAt: '2025-12-19T12:34:56.789Z',
        updatedAt: '2025-12-19T12:34:56.789Z',
      },
      ledger: {
        topicId: '0193e3a6-0b7d-7a8d-9f2c-topic0123456',
        pubkey: 'abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234',
        balance: 100,
        myTotalVotes: 0,
        myTotalCost: 0,
        lastInteractionAt: '2025-12-19T12:34:56.789Z',
      },
    };

    const result = zCreateArgumentResponse.safeParse(fixture);
    expect(result.success).toBe(true);
  });

  it('should parse response with initialVotes spent', () => {
    const fixture = {
      argument: {
        id: '0193e3a6-0b7d-7a8d-9f2c-newarg123456',
        topicId: '0193e3a6-0b7d-7a8d-9f2c-topic0123456',
        parentId: '0193e3a6-0b7d-7a8d-9f2c-parent123456',
        title: 'My New Argument',
        body: 'Argument body with initial votes',
        authorId: 'abcd1234abcd1234',
        analysisStatus: 'pending_analysis',
        stanceScore: null,
        totalVotes: 3,
        totalCost: 9,
        prunedAt: null,
        createdAt: '2025-12-19T12:34:56.789Z',
        updatedAt: '2025-12-19T12:34:56.789Z',
      },
      ledger: {
        topicId: '0193e3a6-0b7d-7a8d-9f2c-topic0123456',
        pubkey: 'abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234',
        balance: 91, // 100 - 9
        myTotalVotes: 3,
        myTotalCost: 9,
        lastInteractionAt: '2025-12-19T12:34:56.789Z',
      },
    };

    const result = zCreateArgumentResponse.safeParse(fixture);
    expect(result.success).toBe(true);
  });
});

describe('POST /v1/arguments/:argumentId/votes response', () => {
  it('should parse a valid response with delta and ledger', () => {
    const fixture: SetVotesResponse = {
      argumentId: '0193e3a6-0b7d-7a8d-9f2c-arg000000001',
      previousVotes: 1,
      targetVotes: 3,
      deltaVotes: 2,
      previousCost: 1,
      targetCost: 9,
      deltaCost: 8,
      ledger: {
        topicId: '0193e3a6-0b7d-7a8d-9f2c-topic0123456',
        pubkey: 'abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234',
        balance: 92, // 100 - 8
        myTotalVotes: 3,
        myTotalCost: 9,
        lastInteractionAt: '2025-12-19T12:34:56.789Z',
      },
    };

    const result = zSetVotesResponse.safeParse(fixture);
    expect(result.success).toBe(true);
  });

  it('should use integer values for all vote/cost fields', () => {
    const fixture = {
      argumentId: '0193e3a6-0b7d-7a8d-9f2c-arg000000001',
      previousVotes: 2,
      targetVotes: 5,
      deltaVotes: 3,
      previousCost: 4,
      targetCost: 25,
      deltaCost: 21,
      ledger: {
        topicId: '0193e3a6-0b7d-7a8d-9f2c-topic0123456',
        pubkey: 'abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234',
        balance: 79,
        myTotalVotes: 5,
        myTotalCost: 25,
        lastInteractionAt: '2025-12-19T12:34:56.789Z',
      },
    };

    const result = zSetVotesResponse.safeParse(fixture);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Number.isInteger(result.data.previousVotes)).toBe(true);
      expect(Number.isInteger(result.data.targetVotes)).toBe(true);
      expect(Number.isInteger(result.data.deltaVotes)).toBe(true);
      expect(Number.isInteger(result.data.previousCost)).toBe(true);
      expect(Number.isInteger(result.data.targetCost)).toBe(true);
      expect(Number.isInteger(result.data.deltaCost)).toBe(true);
    }
  });
});

describe('GET /v1/topics/:topicId/ledger/me response', () => {
  it('should parse using zLedgerMe schema', () => {
    const fixture = {
      topicId: '0193e3a6-0b7d-7a8d-9f2c-topic0123456',
      pubkey: 'abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234',
      balance: 100,
      myTotalVotes: 0,
      myTotalCost: 0,
      lastInteractionAt: null,
    };

    const result = zLedgerMe.safeParse(fixture);
    expect(result.success).toBe(true);
  });
});

describe('GET /v1/topics/:topicId/stakes/me response', () => {
  it('should parse a valid response', () => {
    const fixture: StakesMeResponse = {
      topicId: '0193e3a6-0b7d-7a8d-9f2c-topic0123456',
      pubkey: 'abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234',
      items: [
        {
          argumentId: '0193e3a6-0b7d-7a8d-9f2c-arg000000001',
          votes: 3,
          cost: 9,
          argumentPrunedAt: null,
          updatedAt: '2025-12-19T12:34:56.789Z',
          argumentTitle: null,
          argumentExcerpt: 'This is an excerpt...',
        },
        {
          argumentId: '0193e3a6-0b7d-7a8d-9f2c-arg000000002',
          votes: 2,
          cost: 4,
          argumentPrunedAt: '2025-12-19T15:00:00.000Z',
          updatedAt: '2025-12-19T14:00:00.000Z',
          argumentTitle: 'Some Title',
          argumentExcerpt: null,
        },
      ],
    };

    const result = zStakesMeResponse.safeParse(fixture);
    expect(result.success).toBe(true);
  });

  it('should accept empty items array', () => {
    const fixture = {
      topicId: '0193e3a6-0b7d-7a8d-9f2c-topic0123456',
      pubkey: 'abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234',
      items: [],
    };

    const result = zStakesMeResponse.safeParse(fixture);
    expect(result.success).toBe(true);
  });
});

describe('POST /v1/user/batch-balance response', () => {
  it('should parse a valid response with ok results', () => {
    const fixture: BatchBalanceResponse = {
      results: [
        {
          topicId: '0193e3a6-0b7d-7a8d-9f2c-topic0000001',
          ok: true,
          balance: 100,
          myTotalVotes: 0,
          myTotalCost: 0,
          lastInteractionAt: null,
        },
        {
          topicId: '0193e3a6-0b7d-7a8d-9f2c-topic0000002',
          ok: true,
          balance: 85,
          myTotalVotes: 4,
          myTotalCost: 16,
          lastInteractionAt: '2025-12-19T12:34:56.789Z',
        },
      ],
    };

    const result = zBatchBalanceResponse.safeParse(fixture);
    expect(result.success).toBe(true);
  });

  it('should parse a response with mixed ok/failed results', () => {
    const fixture: BatchBalanceResponse = {
      results: [
        {
          topicId: '0193e3a6-0b7d-7a8d-9f2c-topic0000001',
          ok: true,
          balance: 100,
          myTotalVotes: 0,
          myTotalCost: 0,
          lastInteractionAt: null,
        },
        {
          topicId: '0193e3a6-0b7d-7a8d-9f2c-topic0000002',
          ok: false,
          error: {
            code: 'INVALID_SIGNATURE',
            message: 'Signature verification failed',
          },
        },
        {
          topicId: '0193e3a6-0b7d-7a8d-9f2c-topic0000003',
          ok: false,
          error: {
            code: 'TIMESTAMP_OUT_OF_RANGE',
            message: 'Timestamp too old',
          },
        },
      ],
    };

    const result = zBatchBalanceResponse.safeParse(fixture);
    expect(result.success).toBe(true);
  });

  it('should discriminate between ok and failed results', () => {
    const fixture = {
      results: [
        {
          topicId: '0193e3a6-0b7d-7a8d-9f2c-topic0000001',
          ok: true,
          balance: 100,
          myTotalVotes: 0,
          myTotalCost: 0,
          lastInteractionAt: null,
        },
      ],
    };

    const result = zBatchBalanceResponse.safeParse(fixture);
    expect(result.success).toBe(true);
    if (result.success) {
      const firstResult = result.data.results[0];
      if (firstResult.ok) {
        expect(firstResult.balance).toBe(100);
      }
    }
  });
});

describe('GET /v1/topics/:topicId/cluster-map response', () => {
  it('should parse using zClusterMap schema with points and clusters', () => {
    const fixture = {
      topicId: '0193e3a6-0b7d-7a8d-9f2c-topic0123456',
      modelVersion: 'v1-2025-12-19T12:00:00.000Z',
      computedAt: '2025-12-19T12:34:56.789Z',
      points: [
        {
          argumentId: '0193e3a6-0b7d-7a8d-9f2c-arg000000001',
          x: 0.5,
          y: -0.3,
          clusterId: 'cluster-1',
          stance: 1,
          weight: 2.5,
        },
      ],
      clusters: [
        {
          id: 'cluster-1',
          label: 'Pro',
          summary: 'Arguments in favor',
          centroid: { x: 0.6, y: -0.2 },
        },
      ],
    };

    const result = zClusterMap.safeParse(fixture);
    expect(result.success).toBe(true);
  });

  it('should validate coordinate ranges', () => {
    const validFixture = {
      topicId: '0193e3a6-0b7d-7a8d-9f2c-topic0123456',
      modelVersion: 'v1',
      computedAt: '2025-12-19T12:34:56.789Z',
      points: [
        {
          argumentId: '0193e3a6-0b7d-7a8d-9f2c-arg000000001',
          x: -1.0,
          y: 1.0,
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

    expect(zClusterMap.safeParse(validFixture).success).toBe(true);
  });
});

describe('GET /v1/topics/:topicId/consensus-report/latest response', () => {
  it('should parse null when no report exists yet', () => {
    const fixture: ConsensusReportLatestResponse = {
      report: null,
    };

    const result = zConsensusReportLatestResponse.safeParse(fixture);
    expect(result.success).toBe(true);
  });

  it('should parse ready report when present', () => {
    const fixture: ConsensusReportLatestResponse = {
      report: {
        id: '0193e3a6-0b7d-7a8d-9f2c-abcdef123456',
        topicId: '0193e3a6-0b7d-7a8d-9f2c-topic0123456',
        status: 'ready',
        contentMd: '# Report\\n\\nHello',
        model: 'mock-report-model',
        promptVersion: 'v1',
        params: { maxArguments: 30 },
        metadata: null,
        computedAt: '2025-12-19T12:35:56.789Z',
        createdAt: '2025-12-19T12:34:56.789Z',
      },
    };

    const result = zConsensusReportLatestResponse.safeParse(fixture);
    expect(result.success).toBe(true);
  });
});

describe('POST /v1/topics/:topicId/commands request', () => {
  it('should accept GENERATE_CONSENSUS_REPORT', () => {
    const fixture = { type: 'GENERATE_CONSENSUS_REPORT', payload: {} };
    const result = zTopicCommand.safeParse(fixture);
    expect(result.success).toBe(true);
  });
});
