/**
 * @file endpoints.ts
 * @description API endpoint request/response schemas
 * @see docs/stage01/api-contract.md#3.x
 */
import { z } from 'zod';
import {
  zTopicSummary,
  zTiptapDoc,
  zArgument,
  zLedgerMe,
  zStakeMeItem,
  zClusterMap,
  zConsensusReport,
} from './objects.js';
import { zErrorCode } from './errors.js';

// ============================================================================
// POST /v1/topics - Create Topic
// ============================================================================

export const zCreateTopicRequest = z.object({
  title: z.string(),
  body: z.string(),
  visibility: z.enum(['public', 'unlisted', 'private']).optional(),
});

export type CreateTopicRequest = z.infer<typeof zCreateTopicRequest>;

export const zCreateTopicResponse = z.object({
  topicId: z.string(),
  rootArgumentId: z.string(),
  claimToken: z.string(),
  accessKey: z.string().optional(),
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
// GET /v1/topics/:topicId/arguments - Topic Arguments (paged, full topic)
// ============================================================================

export const zTopicArgumentsResponse = z.object({
  topic: zTopicSummary,
  items: z.array(zArgument),
  nextBeforeId: z.string().nullable(),
});

export type TopicArgumentsResponse = z.infer<typeof zTopicArgumentsResponse>;

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
// GET /v1/arguments/:argumentId - Argument Detail
// ============================================================================

export const zArgumentResponse = z.object({
  argument: zArgument,
});

export type ArgumentResponse = z.infer<typeof zArgumentResponse>;

// ============================================================================
// GET /v1/arguments/:argumentId/related - Argument Related (embedding similarity)
// ============================================================================

export const zArgumentRelatedItem = z.object({
  argumentId: z.string(),
  similarity: z.number().min(-1).max(1),
});

export type ArgumentRelatedItem = z.infer<typeof zArgumentRelatedItem>;

export const zArgumentRelatedResponse = z.object({
  argumentId: z.string(),
  items: z.array(zArgumentRelatedItem),
});

export type ArgumentRelatedResponse = z.infer<typeof zArgumentRelatedResponse>;

// ============================================================================
// POST /v1/arguments/:argumentId/edit - Edit Argument
// ============================================================================

export const zEditArgumentRequest = z.object({
  title: z.string().nullable().optional(),
  body: z.string(),
  bodyRich: zTiptapDoc.nullable().optional(),
});

export type EditArgumentRequest = z.infer<typeof zEditArgumentRequest>;

export const zEditArgumentResponse = z.object({
  argument: zArgument,
});

export type EditArgumentResponse = z.infer<typeof zEditArgumentResponse>;

// ============================================================================
// POST /v1/topics/:topicId/arguments - Create Argument
// ============================================================================

export const zCreateArgumentRequest = z.object({
  parentId: z.string(),
  title: z.string().nullable().optional(),
  body: z.string(),
  bodyRich: zTiptapDoc.nullable().optional(),
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
// POST /v1/topics/:topicId/profile/me - Set my topic profile (display name)
// ============================================================================

export const zSetTopicProfileMeRequest = z.object({
  displayName: z.string().max(40).nullable(),
});

export type SetTopicProfileMeRequest = z.infer<typeof zSetTopicProfileMeRequest>;

export const zSetTopicProfileMeResponse = z.object({
  topicId: z.string(),
  displayName: z.string().max(40).nullable(),
});

export type SetTopicProfileMeResponse = z.infer<typeof zSetTopicProfileMeResponse>;

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

export const zTopicCommandSetVisibility = z.object({
  type: z.literal('SET_VISIBILITY'),
  payload: z.object({
    visibility: z.enum(['public', 'unlisted', 'private']),
  }),
});

export const zTopicCommandRotateAccessKey = z.object({
  type: z.literal('ROTATE_ACCESS_KEY'),
  payload: z.object({}),
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

export const zTopicCommandBlacklistPubkey = z.object({
  type: z.literal('BLACKLIST_PUBKEY'),
  payload: z.object({
    pubkey: z.string(),
    reason: z.string().nullable().optional(),
  }),
});

export const zTopicCommandUnblacklistPubkey = z.object({
  type: z.literal('UNBLACKLIST_PUBKEY'),
  payload: z.object({
    pubkey: z.string(),
  }),
});

export const zTopicCommandGenerateConsensusReport = z.object({
  type: z.literal('GENERATE_CONSENSUS_REPORT'),
  payload: z.object({}),
});

export const zTopicCommand = z.discriminatedUnion('type', [
  zTopicCommandClaimOwner,
  zTopicCommandSetStatus,
  zTopicCommandSetVisibility,
  zTopicCommandRotateAccessKey,
  zTopicCommandEditRoot,
  zTopicCommandPruneArgument,
  zTopicCommandUnpruneArgument,
  zTopicCommandBlacklistPubkey,
  zTopicCommandUnblacklistPubkey,
  zTopicCommandGenerateConsensusReport,
]);

export type TopicCommand = z.infer<typeof zTopicCommand>;

export const zTopicCommandResponse = z.object({
  topic: zTopicSummary,
  accessKey: z.string().optional(),
});

export type TopicCommandResponse = z.infer<typeof zTopicCommandResponse>;

// ============================================================================
// GET /v1/topics/:topicId/consensus-report/latest - Latest Consensus Report
// ============================================================================

export const zConsensusReportLatestResponse = z.object({
  report: zConsensusReport.nullable(),
});

export type ConsensusReportLatestResponse = z.infer<typeof zConsensusReportLatestResponse>;

// ============================================================================
// GET /v1/topics/:topicId/consensus-report/:reportId - Consensus Report (by id)
// ============================================================================

export const zConsensusReportByIdResponse = z.object({
  report: zConsensusReport,
});

export type ConsensusReportByIdResponse = z.infer<typeof zConsensusReportByIdResponse>;

// Re-export ClusterMap for endpoint use
export { zClusterMap };
