"use client";

import {
  canonicalMessageV1,
  deriveTopicKeypair,
  signCanonicalMessageV1,
} from "@epiphany/crypto";

export type SignedHeadersV1 = {
  "X-Pubkey": string;
  "X-Signature": string;
  "X-Timestamp": string;
  "X-Nonce": string;
};

export type SignInputV1 = {
  method: string;
  path: string;
  rawBody?: string | null;
};

export type KeyStore = {
  getMasterSeedHex(): string | null;
  setMasterSeedHex(masterSeedHex: string): void;
  clear(): void;
};

export type Signer = {
  signV1(topicId: string, input: SignInputV1): Promise<SignedHeadersV1>;
};

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

function randomHex(bytesLength: number): string {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("crypto.getRandomValues is unavailable");
  }

  const bytes = new Uint8Array(bytesLength);
  globalThis.crypto.getRandomValues(bytes);
  return bytesToHexLower(bytes);
}

function getStorage(): Storage {
  if (typeof window === "undefined" || !window.localStorage) {
    throw new Error("localStorage is unavailable");
  }
  return window.localStorage;
}

export function createLocalStorageKeyStore(options?: { key?: string }): KeyStore {
  const key = options?.key ?? "tm:master-seed:v1";

  return {
    getMasterSeedHex() {
      const storage = getStorage();
      const existing = storage.getItem(key);

      if (existing && /^[0-9a-f]{128}$/i.test(existing)) {
        return existing.toLowerCase();
      }

      return null;
    },
    setMasterSeedHex(masterSeedHex: string) {
      if (typeof masterSeedHex !== "string" || !/^[0-9a-f]{128}$/i.test(masterSeedHex)) {
        throw new Error("masterSeedHex must be 128 hex chars");
      }

      const storage = getStorage();
      storage.setItem(key, masterSeedHex.toLowerCase());
    },
    clear() {
      const storage = getStorage();
      storage.removeItem(key);
    },
  };
}

export function createV1Signer(keyStore: KeyStore): Signer {
  return {
    async signV1(topicId, input) {
      const timestampMs = Date.now();
      const nonce = randomHex(16);
      const masterSeedHex = keyStore.getMasterSeedHex();
      if (!masterSeedHex) {
        throw new Error("Missing master seed (generate/import mnemonic first)");
      }

      const masterSeed = hexToBytes(masterSeedHex);
      if (masterSeed.length !== 64) {
        throw new Error("Master seed must be 64 bytes");
      }

      const keypair = deriveTopicKeypair(masterSeed, topicId);
      const privSeedBytes = hexToBytes(keypair.privSeedHex);
      if (privSeedBytes.length !== 32) {
        throw new Error("Topic privSeed must be 32 bytes");
      }

      const canonical = canonicalMessageV1({
        method: input.method,
        path: input.path,
        timestampMs,
        nonce,
        rawBody: input.rawBody,
      });

      const signatureHex = bytesToHexLower(
        signCanonicalMessageV1(privSeedBytes, canonical),
      );

      return {
        "X-Pubkey": keypair.pubkeyHex,
        "X-Signature": signatureHex,
        "X-Timestamp": String(timestampMs),
        "X-Nonce": nonce,
      };
    },
  };
}
