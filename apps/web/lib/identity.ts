import {
  canonicalMessageV1,
  deriveTopicKeypair,
  generateMnemonic,
  mnemonicToMasterSeed,
  validateMnemonic,
  type SignInputV1,
  type TopicId,
  type TopicKeypair,
} from "@epiphany/crypto";

function bytesToHexLower(bytes: Uint8Array): string {
  const alphabet = "0123456789abcdef";
  let hex = "";
  for (const byte of bytes) {
    hex += alphabet[(byte >> 4) & 0x0f];
    hex += alphabet[byte & 0x0f];
  }
  return hex;
}

function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) {
    throw new Error("Invalid hex string");
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export { canonicalMessageV1, generateMnemonic, validateMnemonic };
export type { SignInputV1, TopicId, TopicKeypair };

export function mnemonicToMasterSeedHex(mnemonic: string, passphrase = ""): string {
  const masterSeed = mnemonicToMasterSeed(mnemonic, passphrase);
  return bytesToHexLower(masterSeed);
}

export function deriveTopicKeypairFromMnemonic(
  mnemonic: string,
  topicId: TopicId,
  passphrase = "",
): TopicKeypair {
  const masterSeed = mnemonicToMasterSeed(mnemonic, passphrase);
  return deriveTopicKeypair(masterSeed, topicId);
}

export function deriveTopicKeypairFromMasterSeedHex(
  masterSeedHex: string,
  topicId: TopicId,
): TopicKeypair {
  if (typeof masterSeedHex !== "string" || !/^[0-9a-f]{128}$/i.test(masterSeedHex)) {
    throw new Error("masterSeedHex must be 128 hex chars");
  }

  const masterSeed = hexToBytes(masterSeedHex);
  if (masterSeed.length !== 64) {
    throw new Error("masterSeedHex must be 64 bytes");
  }

  return deriveTopicKeypair(masterSeed, topicId);
}

export async function authorIdFromPubkeyHex(pubkeyHex: string): Promise<string> {
  if (typeof pubkeyHex !== "string" || !/^[0-9a-f]{64}$/i.test(pubkeyHex)) {
    throw new Error("pubkeyHex must be 64 hex chars");
  }
  if (!globalThis.crypto?.subtle?.digest) {
    throw new Error("crypto.subtle.digest is unavailable");
  }

  const bytes = hexToBytes(pubkeyHex);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return bytesToHexLower(new Uint8Array(digest)).slice(0, 16);
}
