import { ed25519 } from '@noble/curves/ed25519.js';

import { assertUint8ArrayLength, utf8ToBytes } from './encoding.js';

export function signCanonicalMessageV1(
  privSeed: Uint8Array,
  canonical: string,
): Uint8Array {
  assertUint8ArrayLength(privSeed, 32, 'privSeed');
  const message = utf8ToBytes(canonical);
  return ed25519.sign(message, privSeed);
}

export function verifyCanonicalMessageV1(
  pubkey: Uint8Array,
  canonical: string,
  signature: Uint8Array,
): boolean {
  assertUint8ArrayLength(pubkey, 32, 'pubkey');
  assertUint8ArrayLength(signature, 64, 'signature');
  const message = utf8ToBytes(canonical);
  return ed25519.verify(signature, message, pubkey);
}

export function pubkeyFromPrivSeed(privSeed: Uint8Array): Uint8Array {
  assertUint8ArrayLength(privSeed, 32, 'privSeed');
  return ed25519.getPublicKey(privSeed);
}
