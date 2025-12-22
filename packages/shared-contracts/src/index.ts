/**
 * @file index.ts
 * @description Shared contracts for API - Zod schemas and TypeScript types
 *
 * Naming convention:
 * - zXxx: Zod schema
 * - Xxx: TypeScript type (inferred from schema)
 */

// Errors
export {
  ERROR_CODES,
  zErrorCode,
  zErrorResponse,
  type ErrorCode,
  type ErrorResponse,
} from './errors.js';

// Core DTOs
export {
  // Enums
  zTopicStatus,
  zArgumentAnalysisStatus,
  zReportStatus,
  zStance,
  type TopicStatus,
  type ArgumentAnalysisStatus,
  type ReportStatus,
  type Stance,
  // Objects
  zTopicSummary,
  zArgument,
  zLedgerMe,
  zStakeMeItem,
  zClusterMapPoint,
  zClusterMapCluster,
  zClusterMap,
  zConsensusReport,
  type TopicSummary,
  type Argument,
  type LedgerMe,
  type StakeMeItem,
  type ClusterMapPoint,
  type ClusterMapCluster,
  type ClusterMap,
  type ConsensusReport,
} from './objects.js';

// SSE Events
export {
  zSseEnvelope,
  zSseArgumentUpdated,
  zSseTopicUpdated,
  zSseClusterUpdated,
  zSseReportUpdated,
  zSseReloadRequired,
  type SseEnvelope,
  type ArgumentUpdatedReason,
  type TopicUpdatedReason,
  type ReloadRequiredReason,
} from './sse.js';

// Endpoint schemas
export {
  // POST /v1/topics
  zCreateTopicRequest,
  zCreateTopicResponse,
  type CreateTopicRequest,
  type CreateTopicResponse,
  // GET /v1/topics
  zListTopicsResponse,
  type ListTopicsResponse,
  // GET /v1/topics/:topicId/tree
  zTopicTreeResponse,
  type TopicTreeResponse,
  // GET /v1/arguments/:argumentId/children
  zArgumentChildrenResponse,
  type ArgumentChildrenResponse,
  // POST /v1/topics/:topicId/arguments
  zCreateArgumentRequest,
  zCreateArgumentResponse,
  type CreateArgumentRequest,
  type CreateArgumentResponse,
  // POST /v1/arguments/:argumentId/votes
  zSetVotesRequest,
  zSetVotesResponse,
  type SetVotesRequest,
  type SetVotesResponse,
  // GET /v1/topics/:topicId/stakes/me
  zStakesMeResponse,
  type StakesMeResponse,
  // POST /v1/user/batch-balance
  zBatchBalanceRequestItem,
  zBatchBalanceRequest,
  zBatchBalanceResult,
  zBatchBalanceResponse,
  type BatchBalanceRequestItem,
  type BatchBalanceRequest,
  type BatchBalanceResult,
  type BatchBalanceResponse,
  // POST /v1/topics/:topicId/commands
  zTopicCommand,
  zTopicCommandClaimOwner,
  zTopicCommandSetStatus,
  zTopicCommandEditRoot,
  zTopicCommandPruneArgument,
  zTopicCommandUnpruneArgument,
  zTopicCommandBlacklistPubkey,
  zTopicCommandUnblacklistPubkey,
  zTopicCommandGenerateConsensusReport,
  zTopicCommandResponse,
  zConsensusReportLatestResponse,
  type TopicCommand,
  type TopicCommandResponse,
  type ConsensusReportLatestResponse,
} from './endpoints.js';
