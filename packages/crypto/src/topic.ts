import { hmac } from '@noble/hashes/hmac';
import { sha512 } from '@noble/hashes/sha512';

import {
  assertNonEmptyString,
  assertUint8ArrayLength,
  bytesToHexLower,
  utf8ToBytes,
} from './encoding.js';
import { pubkeyFromPrivSeed } from './ed25519.js';
import type { TopicId, TopicKeypair } from './types.js';

const TOPIC_DERIVATION_PREFIX = 'thought-market-topic-v1:';

export function deriveTopicKeypair(masterSeed: Uint8Array, topicId: TopicId): TopicKeypair {
  assertUint8ArrayLength(masterSeed, 64, 'masterSeed');
  assertNonEmptyString(topicId, 'topicId');

  const data = utf8ToBytes(`${TOPIC_DERIVATION_PREFIX}${topicId}`);
  const topicKeyMaterial = hmac(sha512, masterSeed, data);
  const privSeed = topicKeyMaterial.slice(0, 32);
  const pubkey = pubkeyFromPrivSeed(privSeed);

  return {
    pubkeyHex: bytesToHexLower(pubkey),
    privSeedHex: bytesToHexLower(privSeed),
  };
}

