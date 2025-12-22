/**
 * @file objects.ts
 * @description Core DTO schemas: TopicSummary, Argument, LedgerMe, StakeMeItem, ClusterMap
 * @see docs/stage01/api-contract.md#2.3-2.7
 */
import { z } from 'zod';

// Enums
export const zTopicStatus = z.enum(['active', 'frozen', 'archived']);
export type TopicStatus = z.infer<typeof zTopicStatus>;

export const zArgumentAnalysisStatus = z.enum(['pending_analysis', 'ready', 'failed']);
export type ArgumentAnalysisStatus = z.infer<typeof zArgumentAnalysisStatus>;

export const zReportStatus = z.enum(['generating', 'ready', 'failed']);
export type ReportStatus = z.infer<typeof zReportStatus>;

export const zStance = z.union([z.literal(-1), z.literal(0), z.literal(1)]);
export type Stance = z.infer<typeof zStance>;

// Common patterns
const zUuid = z.string(); // UUID v7 string
const zIsoDateTime = z.string(); // ISO 8601 datetime string
const zHex64 = z.string(); // 64 chars hex (32 bytes pubkey)
const zHex16Lowercase = z.string().regex(/^[0-9a-f]{16}$/, 'Must be 16 lowercase hex chars');
export const zTiptapDoc = z
  .object({
    type: z.literal('doc'),
    content: z.array(z.unknown()).optional(),
  })
  .passthrough();

export type TiptapDoc = z.infer<typeof zTiptapDoc>;

/**
 * TopicSummary - Topic metadata for lists
 * @see docs/stage01/api-contract.md#2.3
 */
export const zTopicSummary = z.object({
  id: zUuid,
  title: z.string(),
  rootArgumentId: zUuid,
  status: zTopicStatus,
  ownerPubkey: z.string().nullable(),
  createdAt: zIsoDateTime,
  updatedAt: zIsoDateTime,
});

export type TopicSummary = z.infer<typeof zTopicSummary>;

/**
 * Argument - Full argument object
 * @see docs/stage01/api-contract.md#2.4
 */
export const zArgument = z.object({
  id: zUuid,
  topicId: zUuid,
  parentId: zUuid.nullable(),
  title: z.string().nullable(),
  body: z.string(),
  bodyRich: zTiptapDoc.nullable().optional(),
  authorId: zHex16Lowercase, // sha256(pubkey).slice(0,16) lowercase hex
  analysisStatus: zArgumentAnalysisStatus,
  stanceScore: z.number().min(-1).max(1).nullable(),
  totalVotes: z.number().int(),
  totalCost: z.number().int(),
  prunedAt: zIsoDateTime.nullable(),
  createdAt: zIsoDateTime,
  updatedAt: zIsoDateTime,
});

export type Argument = z.infer<typeof zArgument>;

/**
 * LedgerMe - User's ledger for a topic
 * @see docs/stage01/api-contract.md#2.5
 */
export const zLedgerMe = z.object({
  topicId: zUuid,
  pubkey: zHex64,
  balance: z.number().int(),
  myTotalVotes: z.number().int(),
  myTotalCost: z.number().int(),
  lastInteractionAt: zIsoDateTime.nullable(),
});

export type LedgerMe = z.infer<typeof zLedgerMe>;

/**
 * StakeMeItem - Individual stake item
 * @see docs/stage01/api-contract.md#2.6
 */
export const zStakeMeItem = z.object({
  argumentId: zUuid,
  votes: z.number().int(),
  cost: z.number().int(),
  argumentPrunedAt: zIsoDateTime.nullable(),
  updatedAt: zIsoDateTime,
  argumentTitle: z.string().nullable(),
  argumentExcerpt: z.string().nullable(),
});

export type StakeMeItem = z.infer<typeof zStakeMeItem>;

/**
 * ClusterMap - God View data
 * @see docs/stage01/api-contract.md#2.7
 */
export const zClusterMapPoint = z.object({
  argumentId: zUuid,
  x: z.number().min(-1).max(1),
  y: z.number().min(-1).max(1),
  clusterId: z.string(),
  stance: zStance,
  weight: z.number(),
});

export type ClusterMapPoint = z.infer<typeof zClusterMapPoint>;

export const zClusterMapCluster = z.object({
  id: z.string(),
  label: z.string().nullable(),
  summary: z.string().nullable(),
  centroid: z.object({
    x: z.number(),
    y: z.number(),
  }),
});

export type ClusterMapCluster = z.infer<typeof zClusterMapCluster>;

export const zClusterMap = z.object({
  topicId: zUuid,
  modelVersion: z.string(),
  computedAt: zIsoDateTime,
  points: z.array(zClusterMapPoint),
  clusters: z.array(zClusterMapCluster),
});

export type ClusterMap = z.infer<typeof zClusterMap>;

/**
 * ConsensusReport - Generated consensus report for a topic
 * @see docs/stage01/api-contract.md#2.8
 */
const zJsonObject = z.record(z.unknown());

const zConsensusReportBase = z.object({
  id: zUuid,
  topicId: zUuid,
  model: z.string().nullable(),
  promptVersion: z.string().nullable(),
  params: zJsonObject.nullable(),
  metadata: zJsonObject.nullable(),
  createdAt: zIsoDateTime,
});

const zConsensusReportGenerating = zConsensusReportBase.extend({
  status: z.literal('generating'),
  contentMd: z.null(),
  computedAt: z.null(),
});

const zConsensusReportReady = zConsensusReportBase.extend({
  status: z.literal('ready'),
  contentMd: z.string(),
  computedAt: zIsoDateTime,
});

const zConsensusReportFailed = zConsensusReportBase.extend({
  status: z.literal('failed'),
  contentMd: z.null(),
  computedAt: zIsoDateTime,
});

export const zConsensusReport = z.discriminatedUnion('status', [
  zConsensusReportGenerating,
  zConsensusReportReady,
  zConsensusReportFailed,
]);

export type ConsensusReport = z.infer<typeof zConsensusReport>;
