"use client";

export type ClaimTokenInfo = {
  claimToken: string;
  expiresAt: string; // ISO datetime
};

export type ClaimTokenStore = {
  get(topicId: string): ClaimTokenInfo | null;
  set(topicId: string, info: ClaimTokenInfo): void;
  remove(topicId: string): void;
  clear(): void;
};

const STORAGE_KEY = "tm:claim-tokens:v1";

function getStorage(): Storage {
  if (typeof window === "undefined" || !window.localStorage) {
    throw new Error("localStorage is unavailable");
  }
  return window.localStorage;
}

function isExpired(expiresAt: string): boolean {
  const ms = Date.parse(expiresAt);
  if (!Number.isFinite(ms)) return true;
  return ms <= Date.now();
}

function readAll(key: string): Record<string, ClaimTokenInfo> {
  try {
    const raw = getStorage().getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    const out: Record<string, ClaimTokenInfo> = {};
    for (const [topicId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const rec = value as Record<string, unknown>;
      if (typeof rec.claimToken !== "string") continue;
      if (typeof rec.expiresAt !== "string") continue;
      out[topicId] = { claimToken: rec.claimToken, expiresAt: rec.expiresAt };
    }
    return out;
  } catch {
    return {};
  }
}

function writeAll(key: string, value: Record<string, ClaimTokenInfo>): void {
  getStorage().setItem(key, JSON.stringify(value));
}

export function createLocalStorageClaimTokenStore(options?: { key?: string }): ClaimTokenStore {
  const key = options?.key ?? STORAGE_KEY;

  return {
    get(topicId: string) {
      const all = readAll(key);
      const value = all[topicId];
      if (!value) return null;
      if (isExpired(value.expiresAt)) {
        delete all[topicId];
        writeAll(key, all);
        return null;
      }
      return value;
    },
    set(topicId: string, info: ClaimTokenInfo) {
      if (!topicId || typeof topicId !== "string") return;
      if (!info?.claimToken || typeof info.claimToken !== "string") return;
      if (!info?.expiresAt || typeof info.expiresAt !== "string") return;
      if (isExpired(info.expiresAt)) return;

      const all = readAll(key);
      all[topicId] = { claimToken: info.claimToken, expiresAt: info.expiresAt };
      writeAll(key, all);
    },
    remove(topicId: string) {
      const all = readAll(key);
      if (!(topicId in all)) return;
      delete all[topicId];
      writeAll(key, all);
    },
    clear() {
      getStorage().removeItem(key);
    },
  };
}

export const claimTokenStore = createLocalStorageClaimTokenStore();

