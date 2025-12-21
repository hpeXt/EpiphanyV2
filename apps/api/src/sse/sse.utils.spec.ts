import { zSseEnvelope } from '@epiphany/shared-contracts';
import { compareRedisStreamIds, redisStreamEntryToSseChunk } from './sse.utils';

describe('sse.utils', () => {
  describe('redisStreamEntryToSseChunk', () => {
    it('should convert Redis Stream entry to SSE chunk and strip private data', () => {
      const chunk = redisStreamEntryToSseChunk([
        '167888888-0',
        [
          'data',
          JSON.stringify({
            event: 'argument_updated',
            data: {
              argumentId: 'arg_1',
              reason: 'new_vote',
              ledger: { balance: 999 }, // should be stripped
            },
          }),
        ],
      ]);

      expect(chunk).toContain('id: 167888888-0\n');
      expect(chunk).toContain('\n\n');

      const dataLine = chunk
        ?.split('\n')
        .find((line) => line.startsWith('data: '))
        ?.slice('data: '.length);
      expect(dataLine).toBeTruthy();

      const parsed = zSseEnvelope.safeParse(JSON.parse(dataLine as string));
      expect(parsed.success).toBe(true);

      expect(dataLine).not.toContain('ledger');
      expect(dataLine).not.toContain('stakes');
    });

    it('should return null for invalid envelope JSON', () => {
      const chunk = redisStreamEntryToSseChunk([
        '167888888-0',
        ['data', '{not json}'],
      ]);
      expect(chunk).toBeNull();
    });

    it('should return null for unknown SSE event', () => {
      const chunk = redisStreamEntryToSseChunk([
        '167888888-0',
        ['data', JSON.stringify({ event: 'ledger_dump', data: { secret: 'nope' } })],
      ]);
      expect(chunk).toBeNull();
    });
  });

  describe('compareRedisStreamIds', () => {
    it('should compare ms then seq', () => {
      expect(compareRedisStreamIds('1-0', '1-0')).toBe(0);
      expect(compareRedisStreamIds('1-0', '1-1')).toBe(-1);
      expect(compareRedisStreamIds('1-9', '2-0')).toBe(-1);
      expect(compareRedisStreamIds('2-0', '1-9')).toBe(1);
    });

    it('should return null for invalid ids', () => {
      expect(compareRedisStreamIds('abc', '1-0')).toBeNull();
      expect(compareRedisStreamIds('1-0', '$')).toBeNull();
    });
  });
});

