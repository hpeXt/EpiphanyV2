import { sha256 } from '@noble/hashes/sha256';

import {
  assertDoesNotContainPipe,
  assertNonEmptyString,
  bytesToHexLower,
  utf8ToBytes,
} from './encoding.js';
import type { Hex, SignInputV1 } from './types.js';

export function sha256HexOfUtf8(input: string): Hex {
  return bytesToHexLower(sha256(utf8ToBytes(input)));
}

export function canonicalMessageV1(input: SignInputV1): string {
  assertNonEmptyString(input.method, 'method');
  assertNonEmptyString(input.path, 'path');
  assertNonEmptyString(input.nonce, 'nonce');

  if (!Number.isSafeInteger(input.timestampMs)) {
    throw new TypeError('timestampMs must be a safe integer (Unix ms)');
  }

  const method = input.method.toUpperCase();
  const path = input.path;
  const timestamp = String(input.timestampMs);
  const nonce = input.nonce;

  assertDoesNotContainPipe(method, 'method');
  assertDoesNotContainPipe(path, 'path');
  assertDoesNotContainPipe(nonce, 'nonce');

  if (!path.startsWith('/')) {
    throw new Error("path must start with '/'");
  }
  if (path.includes('?')) {
    throw new Error('path must not include query string');
  }

  const rawBody = input.rawBody ?? null;
  const bodyHash =
    rawBody === null || rawBody === '' ? '' : sha256HexOfUtf8(rawBody);

  return ['v1', method, path, timestamp, nonce, bodyHash].join('|');
}

