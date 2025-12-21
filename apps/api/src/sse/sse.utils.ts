import { zSseEnvelope, type SseEnvelope } from '@epiphany/shared-contracts';

export type RedisStreamEntry = [id: string, fields: string[]];

function getFieldValue(fields: string[], fieldName: string): string | undefined {
  for (let i = 0; i < fields.length - 1; i += 2) {
    if (fields[i] === fieldName) return fields[i + 1];
  }
  return undefined;
}

export function redisStreamEntryToSseChunk(entry: RedisStreamEntry): string | null {
  const [id, fields] = entry;
  const rawData = getFieldValue(fields, 'data');
  if (!rawData) return null;

  let json: unknown;
  try {
    json = JSON.parse(rawData);
  } catch {
    return null;
  }

  const parsed = zSseEnvelope.safeParse(json);
  if (!parsed.success) return null;

  return toSseDataChunk(id, parsed.data);
}

export function toSseDataChunk(id: string, envelope: SseEnvelope): string {
  return `id: ${id}\ndata: ${JSON.stringify(envelope)}\n\n`;
}

export function compareRedisStreamIds(a: string, b: string): -1 | 0 | 1 | null {
  const pa = parseRedisStreamId(a);
  const pb = parseRedisStreamId(b);
  if (!pa || !pb) return null;

  if (pa.ms < pb.ms) return -1;
  if (pa.ms > pb.ms) return 1;

  if (pa.seq < pb.seq) return -1;
  if (pa.seq > pb.seq) return 1;
  return 0;
}

export function parseRedisStreamId(id: string): { ms: bigint; seq: bigint } | null {
  const match = /^(\d+)-(\d+)$/.exec(id);
  if (!match) return null;

  try {
    return { ms: BigInt(match[1]), seq: BigInt(match[2]) };
  } catch {
    return null;
  }
}

export function toSseComment(comment: string): string {
  return `: ${comment}\n\n`;
}

