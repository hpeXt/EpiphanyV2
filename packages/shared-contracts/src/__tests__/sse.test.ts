/**
 * @file sse.test.ts
 * @description Tests for SSE SseEnvelope schema (discriminated union)
 * @see docs/api-contract.md#2.8
 */
import { zSseEnvelope, type SseEnvelope } from '../index.js';

describe('SseEnvelope', () => {
  describe('argument_updated', () => {
    it('should parse argument_updated with reason: new_vote', () => {
      const fixture: SseEnvelope = {
        event: 'argument_updated',
        data: {
          argumentId: '0193e3a6-0b7d-7a8d-9f2c-1234567890ab',
          reason: 'new_vote',
        },
      };

      const result = zSseEnvelope.safeParse(fixture);
      expect(result.success).toBe(true);
    });

    it('should parse argument_updated with reason: analysis_done', () => {
      const fixture: SseEnvelope = {
        event: 'argument_updated',
        data: {
          argumentId: '0193e3a6-0b7d-7a8d-9f2c-1234567890ab',
          reason: 'analysis_done',
        },
      };

      const result = zSseEnvelope.safeParse(fixture);
      expect(result.success).toBe(true);
    });

    it('should parse argument_updated with reason: edited', () => {
      const fixture: SseEnvelope = {
        event: 'argument_updated',
        data: {
          argumentId: '0193e3a6-0b7d-7a8d-9f2c-1234567890ab',
          reason: 'edited',
        },
      };

      const result = zSseEnvelope.safeParse(fixture);
      expect(result.success).toBe(true);
    });

    it('should parse argument_updated with reason: pruned', () => {
      const fixture: SseEnvelope = {
        event: 'argument_updated',
        data: {
          argumentId: '0193e3a6-0b7d-7a8d-9f2c-1234567890ab',
          reason: 'pruned',
        },
      };

      const result = zSseEnvelope.safeParse(fixture);
      expect(result.success).toBe(true);
    });

    it('should only accept valid reason values', () => {
      const validReasons = ['new_vote', 'analysis_done', 'edited', 'pruned'];

      validReasons.forEach((reason) => {
        const fixture = {
          event: 'argument_updated',
          data: {
            argumentId: '0193e3a6-0b7d-7a8d-9f2c-1234567890ab',
            reason,
          },
        };
        expect(zSseEnvelope.safeParse(fixture).success).toBe(true);
      });

      // Invalid reason should fail
      const invalidFixture = {
        event: 'argument_updated',
        data: {
          argumentId: '0193e3a6-0b7d-7a8d-9f2c-1234567890ab',
          reason: 'invalid_reason',
        },
      };
      expect(zSseEnvelope.safeParse(invalidFixture).success).toBe(false);
    });
  });

  describe('topic_updated', () => {
    it('should parse topic_updated with reason: status_changed', () => {
      const fixture: SseEnvelope = {
        event: 'topic_updated',
        data: {
          topicId: '0193e3a6-0b7d-7a8d-9f2c-1234567890ab',
          reason: 'status_changed',
        },
      };

      const result = zSseEnvelope.safeParse(fixture);
      expect(result.success).toBe(true);
    });

    it('should parse topic_updated with reason: owner_claimed', () => {
      const fixture: SseEnvelope = {
        event: 'topic_updated',
        data: {
          topicId: '0193e3a6-0b7d-7a8d-9f2c-1234567890ab',
          reason: 'owner_claimed',
        },
      };

      const result = zSseEnvelope.safeParse(fixture);
      expect(result.success).toBe(true);
    });

    it('should parse topic_updated with reason: root_edited', () => {
      const fixture: SseEnvelope = {
        event: 'topic_updated',
        data: {
          topicId: '0193e3a6-0b7d-7a8d-9f2c-1234567890ab',
          reason: 'root_edited',
        },
      };

      const result = zSseEnvelope.safeParse(fixture);
      expect(result.success).toBe(true);
    });

    it('should only accept valid reason values', () => {
      const validReasons = ['status_changed', 'owner_claimed', 'root_edited'];

      validReasons.forEach((reason) => {
        const fixture = {
          event: 'topic_updated',
          data: {
            topicId: '0193e3a6-0b7d-7a8d-9f2c-1234567890ab',
            reason,
          },
        };
        expect(zSseEnvelope.safeParse(fixture).success).toBe(true);
      });

      // Invalid reason should fail
      const invalidFixture = {
        event: 'topic_updated',
        data: {
          topicId: '0193e3a6-0b7d-7a8d-9f2c-1234567890ab',
          reason: 'invalid_reason',
        },
      };
      expect(zSseEnvelope.safeParse(invalidFixture).success).toBe(false);
    });
  });

  describe('cluster_updated', () => {
    it('should parse cluster_updated', () => {
      const fixture: SseEnvelope = {
        event: 'cluster_updated',
        data: {
          topicId: '0193e3a6-0b7d-7a8d-9f2c-1234567890ab',
        },
      };

      const result = zSseEnvelope.safeParse(fixture);
      expect(result.success).toBe(true);
    });
  });

  describe('report_updated', () => {
    it('should parse report_updated', () => {
      const fixture: SseEnvelope = {
        event: 'report_updated',
        data: {
          topicId: '0193e3a6-0b7d-7a8d-9f2c-1234567890ab',
          reportId: '0193e3a6-0b7d-7a8d-9f2c-abcdef123456',
        },
      };

      const result = zSseEnvelope.safeParse(fixture);
      expect(result.success).toBe(true);
    });

    it('should reject report_updated missing reportId', () => {
      const fixture = {
        event: 'report_updated',
        data: {
          topicId: '0193e3a6-0b7d-7a8d-9f2c-1234567890ab',
        },
      };

      const result = zSseEnvelope.safeParse(fixture);
      expect(result.success).toBe(false);
    });
  });

  describe('reload_required', () => {
    it('should parse reload_required with reason: trimmed', () => {
      const fixture: SseEnvelope = {
        event: 'reload_required',
        data: {
          reason: 'trimmed',
        },
      };

      const result = zSseEnvelope.safeParse(fixture);
      expect(result.success).toBe(true);
    });

    it('should require reason to be exactly "trimmed"', () => {
      const validFixture = {
        event: 'reload_required',
        data: {
          reason: 'trimmed',
        },
      };
      expect(zSseEnvelope.safeParse(validFixture).success).toBe(true);

      // Any other value should fail
      const invalidFixture = {
        event: 'reload_required',
        data: {
          reason: 'other_reason',
        },
      };
      expect(zSseEnvelope.safeParse(invalidFixture).success).toBe(false);
    });
  });

  describe('discriminated union', () => {
    it('should reject invalid event types', () => {
      const fixture = {
        event: 'invalid_event',
        data: {},
      };

      const result = zSseEnvelope.safeParse(fixture);
      expect(result.success).toBe(false);
    });

    it('should correctly discriminate event types', () => {
      const fixtures: SseEnvelope[] = [
        { event: 'argument_updated', data: { argumentId: 'uuid', reason: 'new_vote' } },
        { event: 'topic_updated', data: { topicId: 'uuid', reason: 'status_changed' } },
        { event: 'cluster_updated', data: { topicId: 'uuid' } },
        { event: 'reload_required', data: { reason: 'trimmed' } },
      ];

      fixtures.forEach((fixture) => {
        const result = zSseEnvelope.safeParse(fixture);
        expect(result.success).toBe(true);
      });
    });
  });
});
