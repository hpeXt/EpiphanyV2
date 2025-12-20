import type { Hex } from './types.js';

export function pubkeyFingerprint(pubkeyHex: Hex, prefixLength: number = 8): string {
  if (typeof pubkeyHex !== 'string') {
    throw new TypeError('pubkeyHex must be a string');
  }

  const normalized = pubkeyHex.toLowerCase();
  if (!/^[0-9a-f]+$/.test(normalized)) {
    throw new Error('pubkeyHex must be hex');
  }
  if (normalized.length < prefixLength + 4) {
    return normalized;
  }

  return `${normalized.slice(0, prefixLength)}…${normalized.slice(-4)}`;
}

