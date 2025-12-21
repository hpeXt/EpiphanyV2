"use client";

import nacl from "tweetnacl";

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
  getOrCreateTopicSeedHex(topicId: string): string;
};

export type Signer = {
  signV1(topicId: string, input: SignInputV1): Promise<SignedHeadersV1>;
};

function assertNonEmptyString(value: string, label: string) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
}

function assertDoesNotContainPipe(value: string, label: string) {
  if (value.includes("|")) {
    throw new Error(`${label} must not include '|'`);
  }
}

function utf8ToBytes(input: string): Uint8Array {
  const encoded = encodeURIComponent(input);
  const bytes = new Uint8Array(encoded.length);
  let length = 0;

  for (let i = 0; i < encoded.length; i += 1) {
    const char = encoded[i];
    if (char === "%") {
      bytes[length] = Number.parseInt(encoded.slice(i + 1, i + 3), 16);
      length += 1;
      i += 2;
      continue;
    }
    bytes[length] = char.charCodeAt(0);
    length += 1;
  }

  return length === bytes.length ? bytes : bytes.slice(0, length);
}

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

async function sha256HexOfUtf8(input: string): Promise<string> {
  if (!globalThis.crypto?.subtle?.digest) {
    throw new Error("crypto.subtle.digest is unavailable");
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", utf8ToBytes(input));
  return bytesToHexLower(new Uint8Array(digest));
}

async function canonicalMessageV1(input: {
  method: string;
  path: string;
  timestampMs: number;
  nonce: string;
  rawBody?: string | null;
}): Promise<string> {
  assertNonEmptyString(input.method, "method");
  assertNonEmptyString(input.path, "path");
  assertNonEmptyString(input.nonce, "nonce");

  if (!Number.isSafeInteger(input.timestampMs)) {
    throw new TypeError("timestampMs must be a safe integer (Unix ms)");
  }

  const method = input.method.toUpperCase();
  const path = input.path;
  const timestamp = String(input.timestampMs);
  const nonce = input.nonce;

  assertDoesNotContainPipe(method, "method");
  assertDoesNotContainPipe(path, "path");
  assertDoesNotContainPipe(nonce, "nonce");

  if (!path.startsWith("/")) {
    throw new Error("path must start with '/'");
  }
  if (path.includes("?")) {
    throw new Error("path must not include query string");
  }

  const rawBody = input.rawBody ?? null;
  const bodyHash =
    rawBody === null || rawBody === "" ? "" : await sha256HexOfUtf8(rawBody);

  return ["v1", method, path, timestamp, nonce, bodyHash].join("|");
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

export function createLocalStorageKeyStore(options?: { prefix?: string }): KeyStore {
  const prefix = options?.prefix ?? "tm:topic-seed:v1:";

  return {
    getOrCreateTopicSeedHex(topicId: string) {
      assertNonEmptyString(topicId, "topicId");
      const storage = getStorage();
      const key = `${prefix}${topicId}`;
      const existing = storage.getItem(key);

      if (existing && /^[0-9a-f]{64}$/i.test(existing)) {
        return existing.toLowerCase();
      }

      const seedHex = randomHex(32);
      storage.setItem(key, seedHex);
      return seedHex;
    },
  };
}

export function createV1Signer(keyStore: KeyStore): Signer {
  return {
    async signV1(topicId, input) {
      const timestampMs = Date.now();
      const nonce = randomHex(16);
      const seedHex = keyStore.getOrCreateTopicSeedHex(topicId);
      const seed = hexToBytes(seedHex);

      if (seed.length !== 32) {
        throw new Error("Topic seed must be 32 bytes");
      }

      const keypair = nacl.sign.keyPair.fromSeed(seed);
      const pubkeyHex = bytesToHexLower(keypair.publicKey);
      const canonical = await canonicalMessageV1({
        method: input.method,
        path: input.path,
        timestampMs,
        nonce,
        rawBody: input.rawBody,
      });

      const signatureHex = bytesToHexLower(
        nacl.sign.detached(utf8ToBytes(canonical), keypair.secretKey),
      );

      return {
        "X-Pubkey": pubkeyHex,
        "X-Signature": signatureHex,
        "X-Timestamp": String(timestampMs),
        "X-Nonce": nonce,
      };
    },
  };
}
