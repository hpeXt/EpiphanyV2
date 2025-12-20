/**
 * @file endpoints.ts
 * @description API endpoint request/response schemas
 * @see docs/api-contract.md#3.x
 */
import { z } from 'zod';
import { zTopicSummary, zArgument, zLedgerMe, zStakeMeItem, zClusterMap } from './objects.js';
import { zErrorCode } from './errors.js';

// ============================================================================
// POST /v1/topics - Create Topic
// ============================================================================

export const zCreateTopicRequest = z.object({
  title: z.string(),
  body: z.string(),
});

export type CreateTopicRequest = z.infer<typeof zCreateTopicRequest>;

export const zCreateTopicResponse = z.object({
  topicId: z.string(),
  rootArgumentId: z.string(),
  claimToken: z.string(),
  expiresAt: z.string(), // ISO datetime
});

export type CreateTopicResponse = z.infer<typeof zCreateTopicResponse>;

// ============================================================================
// GET /v1/topics - List Topics
// ============================================================================

export const zListTopicsResponse = z.object({
  items: z.array(zTopicSummary),
  nextBeforeId: z.string().nullable(),
});

export type ListTopicsResponse = z.infer<typeof zListTopicsResponse>;

// ============================================================================
// GET /v1/topics/:topicId/tree - Topic Tree
// ============================================================================

export const zTopicTreeResponse = z.object({
  topic: zTopicSummary,
  depth: z.number().int().min(1).max(10),
  arguments: z.array(zArgument),
});

export type TopicTreeResponse = z.infer<typeof zTopicTreeResponse>;

// ============================================================================
// GET /v1/arguments/:argumentId/children - Argument Children
// ============================================================================

export const zArgumentChildrenResponse = z.object({
  parentArgumentId: z.string(),
  items: z.array(zArgument),
  nextBeforeId: z.string().nullable(),
});

export type ArgumentChildrenResponse = z.infer<typeof zArgumentChildrenResponse>;

// ============================================================================
// POST /v1/topics/:topicId/arguments - Create Argument
// ============================================================================

export const zCreateArgumentRequest = z.object({
  parentId: z.string(),
  title: z.string().nullable().optional(),
  body: z.string(),
  initialVotes: z.number().int().min(0).optional(),
});

export type CreateArgumentRequest = z.infer<typeof zCreateArgumentRequest>;

export const zCreateArgumentResponse = z.object({
  argument: zArgument,
  ledger: zLedgerMe,
});

export type CreateArgumentResponse = z.infer<typeof zCreateArgumentResponse>;

// ============================================================================
// POST /v1/arguments/:argumentId/votes - Set Votes
// ============================================================================

export const zSetVotesRequest = z.object({
  targetVotes: z.number().int().min(0).max(10),
});

export type SetVotesRequest = z.infer<typeof zSetVotesRequest>;

export const zSetVotesResponse = z.object({
  argumentId: z.string(),
  previousVotes: z.number().int(),
  targetVotes: z.number().int(),
  deltaVotes: z.number().int(),
  previousCost: z.number().int(),
  targetCost: z.number().int(),
  deltaCost: z.number().int(),
  ledger: zLedgerMe,
});

export type SetVotesResponse = z.infer<typeof zSetVotesResponse>;

// ============================================================================
// GET /v1/topics/:topicId/stakes/me - My Stakes
// ============================================================================

export const zStakesMeResponse = z.object({
  topicId: z.string(),
  pubkey: z.string(),
  items: z.array(zStakeMeItem),
});

export type StakesMeResponse = z.infer<typeof zStakesMeResponse>;

// ============================================================================
// POST /v1/user/batch-balance - Batch Balance Query
// ============================================================================

export const zBatchBalanceRequestItem = z.object({
  topicId: z.string(),
  pubkey: z.string(),
  timestamp: z.number().int(),
  nonce: z.string(),
  signature: z.string(),
});

export type BatchBalanceRequestItem = z.infer<typeof zBatchBalanceRequestItem>;

export const zBatchBalanceRequest = z.object({
  items: z.array(zBatchBalanceRequestItem),
});

export type BatchBalanceRequest = z.infer<typeof zBatchBalanceRequest>;

const zBatchBalanceResultOk = z.object({
  topicId: z.string(),
  ok: z.literal(true),
  balance: z.number().int(),
  myTotalVotes: z.number().int(),
  myTotalCost: z.number().int(),
  lastInteractionAt: z.string().nullable(),
});

const zBatchBalanceResultError = z.object({
  topicId: z.string(),
  ok: z.literal(false),
  error: z.object({
    code: zErrorCode,
    message: z.string(),
  }),
});

export const zBatchBalanceResult = z.discriminatedUnion('ok', [
  zBatchBalanceResultOk,
  zBatchBalanceResultError,
]);

export type BatchBalanceResult = z.infer<typeof zBatchBalanceResult>;

export const zBatchBalanceResponse = z.object({
  results: z.array(zBatchBalanceResult),
});

export type BatchBalanceResponse = z.infer<typeof zBatchBalanceResponse>;

// ============================================================================
// POST /v1/topics/:topicId/commands - Topic Commands
// ============================================================================

export const zTopicCommandClaimOwner = z.object({
  type: z.literal('CLAIM_OWNER'),
  payload: z.object({}),
});

export const zTopicCommandSetStatus = z.object({
  type: z.literal('SET_STATUS'),
  payload: z.object({
    status: z.enum(['active', 'frozen', 'archived']),
  }),
});

export const zTopicCommandEditRoot = z.object({
  type: z.literal('EDIT_ROOT'),
  payload: z.object({
    title: z.string(),
    body: z.string(),
  }),
});

export const zTopicCommandPruneArgument = z.object({
  type: z.literal('PRUNE_ARGUMENT'),
  payload: z.object({
    argumentId: z.string(),
    reason: z.string().nullable(),
  }),
});

export const zTopicCommandUnpruneArgument = z.object({
  type: z.literal('UNPRUNE_ARGUMENT'),
  payload: z.object({
    argumentId: z.string(),
  }),
});

export const zTopicCommand = z.discriminatedUnion('type', [
  zTopicCommandClaimOwner,
  zTopicCommandSetStatus,
  zTopicCommandEditRoot,
  zTopicCommandPruneArgument,
  zTopicCommandUnpruneArgument,
]);

export type TopicCommand = z.infer<typeof zTopicCommand>;

export const zTopicCommandResponse = z.object({
  topic: zTopicSummary,
});

export type TopicCommandResponse = z.infer<typeof zTopicCommandResponse>;

// Re-export ClusterMap for endpoint use
export { zClusterMap };
