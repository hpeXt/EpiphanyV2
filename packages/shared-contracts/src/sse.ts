/**
 * @file sse.ts
 * @description SSE event envelope schema (discriminated union)
 * @see docs/stage01/api-contract.md#2.9
 */
import { z } from 'zod';

const zArgumentUpdatedReason = z.enum(['new_vote', 'analysis_done', 'edited', 'pruned']);
export type ArgumentUpdatedReason = z.infer<typeof zArgumentUpdatedReason>;

const zTopicUpdatedReason = z.enum(['status_changed', 'owner_claimed', 'root_edited']);
export type TopicUpdatedReason = z.infer<typeof zTopicUpdatedReason>;

const zReloadRequiredReason = z.literal('trimmed');
export type ReloadRequiredReason = z.infer<typeof zReloadRequiredReason>;

const zSseArgumentUpdated = z.object({
  event: z.literal('argument_updated'),
  data: z.object({
    argumentId: z.string(),
    reason: zArgumentUpdatedReason,
  }),
});

const zSseTopicUpdated = z.object({
  event: z.literal('topic_updated'),
  data: z.object({
    topicId: z.string(),
    reason: zTopicUpdatedReason,
  }),
});

const zSseClusterUpdated = z.object({
  event: z.literal('cluster_updated'),
  data: z.object({
    topicId: z.string(),
  }),
});

const zSseReportUpdated = z.object({
  event: z.literal('report_updated'),
  data: z.object({
    topicId: z.string(),
    reportId: z.string(),
  }),
});

const zSseReloadRequired = z.object({
  event: z.literal('reload_required'),
  data: z.object({
    reason: zReloadRequiredReason,
  }),
});

/**
 * SSE Event Envelope - discriminated union by 'event' field
 */
export const zSseEnvelope = z.discriminatedUnion('event', [
  zSseArgumentUpdated,
  zSseTopicUpdated,
  zSseClusterUpdated,
  zSseReportUpdated,
  zSseReloadRequired,
]);

export type SseEnvelope = z.infer<typeof zSseEnvelope>;

// Re-export individual event schemas for direct use
export {
  zSseArgumentUpdated,
  zSseTopicUpdated,
  zSseClusterUpdated,
  zSseReportUpdated,
  zSseReloadRequired,
};
