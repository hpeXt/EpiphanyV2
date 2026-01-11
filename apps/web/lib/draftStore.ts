"use client";

import type { TiptapDoc } from "@epiphany/shared-contracts";

export type ReplyDraft = {
  schemaVersion: 1;
  title: string;
  body: string;
  bodyRich: TiptapDoc | null;
  updatedAt: string; // ISO datetime
};

export type ReplyDraftMeta = {
  schemaVersion: 1;
  lastParentId: string | null;
  updatedAt: string; // ISO datetime
};

export type EditRootDraft = {
  schemaVersion: 1;
  title: string;
  body: string;
  updatedAt: string; // ISO datetime
};

export type DraftStore = {
  getReplyDraft(topicId: string, parentArgumentId: string | null): ReplyDraft | null;
  setReplyDraft(
    topicId: string,
    parentArgumentId: string | null,
    draft: { title?: string; body: string; bodyRich: TiptapDoc | null },
  ): ReplyDraft | null;
  removeReplyDraft(topicId: string, parentArgumentId: string | null): void;

  getReplyMeta(topicId: string): ReplyDraftMeta | null;
  setReplyMeta(topicId: string, meta: { lastParentId: string | null }): ReplyDraftMeta | null;
  clearReplyMeta(topicId: string): void;

  getEditRootDraft(topicId: string): EditRootDraft | null;
  setEditRootDraft(topicId: string, draft: { title: string; body: string }): EditRootDraft | null;
  removeEditRootDraft(topicId: string): void;

  pruneTopic(topicId: string): void;
};

type ReplyDraftIndexV1 = {
  schemaVersion: 1;
  entries: Record<string, string>; // parentKey -> updatedAt ISO
  updatedAt: string; // ISO datetime
};

type Options = {
  ttlDays: number;
  maxReplyDraftsPerTopic: number;
};

const DEFAULTS: Options = {
  ttlDays: 30,
  maxReplyDraftsPerTopic: 50,
};

const REPLY_DRAFT_PREFIX = "tm:draft:reply:v1:";
const REPLY_INDEX_PREFIX = "tm:draft:reply-index:v1:";
const REPLY_META_PREFIX = "tm:draft:reply-meta:v1:";
const EDIT_ROOT_PREFIX = "tm:draft:edit-root:v1:";

function getStorage(): Storage {
  if (typeof window === "undefined" || !window.localStorage) {
    throw new Error("localStorage is unavailable");
  }
  return window.localStorage;
}

function nowIso(nowMs = Date.now()): string {
  return new Date(nowMs).toISOString();
}

function ttlMs(options: Options): number {
  return Math.max(1, options.ttlDays) * 24 * 60 * 60 * 1000;
}

function isExpired(updatedAt: string, nowMs: number, ttlMsValue: number): boolean {
  const ts = Date.parse(updatedAt);
  if (!Number.isFinite(ts)) return true;
  return ts + ttlMsValue <= nowMs;
}

function toParentKey(parentArgumentId: string | null): string {
  if (!parentArgumentId) return "root";
  const trimmed = parentArgumentId.trim();
  return trimmed ? trimmed : "root";
}

function replyDraftKey(topicId: string, parentKey: string): string {
  return `${REPLY_DRAFT_PREFIX}${topicId}:${parentKey}`;
}

function replyIndexKey(topicId: string): string {
  return `${REPLY_INDEX_PREFIX}${topicId}`;
}

function replyMetaKey(topicId: string): string {
  return `${REPLY_META_PREFIX}${topicId}`;
}

function editRootKey(topicId: string): string {
  return `${EDIT_ROOT_PREFIX}${topicId}`;
}

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readReplyIndex(storage: Storage, topicId: string): ReplyDraftIndexV1 | null {
  const raw = storage.getItem(replyIndexKey(topicId));
  if (!raw) return null;
  const parsed = safeParseJson(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const rec = parsed as Record<string, unknown>;
  if (rec.schemaVersion !== 1) return null;
  if (!rec.entries || typeof rec.entries !== "object" || Array.isArray(rec.entries)) return null;
  const entriesRaw = rec.entries as Record<string, unknown>;

  const entries: Record<string, string> = {};
  for (const [parentKey, updatedAt] of Object.entries(entriesRaw)) {
    if (typeof parentKey !== "string" || !parentKey) continue;
    if (typeof updatedAt !== "string" || !updatedAt) continue;
    entries[parentKey] = updatedAt;
  }

  if (typeof rec.updatedAt !== "string" || !rec.updatedAt) return null;
  return { schemaVersion: 1, entries, updatedAt: rec.updatedAt };
}

function writeReplyIndex(storage: Storage, topicId: string, index: ReplyDraftIndexV1 | null): void {
  const key = replyIndexKey(topicId);
  if (!index || Object.keys(index.entries).length === 0) {
    storage.removeItem(key);
    return;
  }
  storage.setItem(key, JSON.stringify(index));
}

function rebuildReplyIndex(storage: Storage, topicId: string, options: Options, nowMs: number): ReplyDraftIndexV1 {
  const prefix = `${REPLY_DRAFT_PREFIX}${topicId}:`;
  const entries: Record<string, string> = {};
  const ttlMsValue = ttlMs(options);

  const keys: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (!key) continue;
    if (key.startsWith(prefix)) keys.push(key);
  }

  for (const key of keys) {
    const parentKey = key.slice(prefix.length);
    if (!parentKey) continue;
    const raw = storage.getItem(key);
    if (!raw) continue;
    const parsed = safeParseJson(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      continue;
    }
    const rec = parsed as Record<string, unknown>;
    if (rec.schemaVersion !== 1) continue;
    if (typeof rec.updatedAt !== "string" || !rec.updatedAt) continue;
    if (isExpired(rec.updatedAt, nowMs, ttlMsValue)) {
      storage.removeItem(key);
      continue;
    }
    entries[parentKey] = rec.updatedAt;
  }

  return { schemaVersion: 1, entries, updatedAt: nowIso(nowMs) };
}

function pruneReplyDraftsForTopic(storage: Storage, topicId: string, options: Options, nowMs: number): void {
  const ttlMsValue = ttlMs(options);
  const max = Math.max(1, options.maxReplyDraftsPerTopic);

  let index = readReplyIndex(storage, topicId);
  if (!index) {
    index = rebuildReplyIndex(storage, topicId, options, nowMs);
  }

  const nextEntries: Record<string, string> = {};
  for (const [parentKey, updatedAt] of Object.entries(index.entries)) {
    if (isExpired(updatedAt, nowMs, ttlMsValue)) {
      storage.removeItem(replyDraftKey(topicId, parentKey));
      continue;
    }

    const raw = storage.getItem(replyDraftKey(topicId, parentKey));
    if (!raw) continue;
    nextEntries[parentKey] = updatedAt;
  }

  const kept = Object.entries(nextEntries)
    .map(([parentKey, updatedAt]) => ({ parentKey, updatedAt }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const toRemove = kept.slice(max);
  const toKeep = kept.slice(0, max);

  for (const item of toRemove) {
    storage.removeItem(replyDraftKey(topicId, item.parentKey));
  }

  const finalEntries: Record<string, string> = {};
  for (const item of toKeep) {
    finalEntries[item.parentKey] = item.updatedAt;
  }

  writeReplyIndex(storage, topicId, {
    schemaVersion: 1,
    entries: finalEntries,
    updatedAt: nowIso(nowMs),
  });
}

function readReplyDraft(storage: Storage, topicId: string, parentKey: string): ReplyDraft | null {
  const raw = storage.getItem(replyDraftKey(topicId, parentKey));
  if (!raw) return null;
  const parsed = safeParseJson(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const rec = parsed as Record<string, unknown>;
  if (rec.schemaVersion !== 1) return null;
  if (!(rec.title === undefined || typeof rec.title === "string")) return null;
  if (typeof rec.body !== "string") return null;
  if (!(rec.bodyRich === undefined || rec.bodyRich === null || typeof rec.bodyRich === "object")) {
    return null;
  }
  if (typeof rec.updatedAt !== "string" || !rec.updatedAt) return null;

  return {
    schemaVersion: 1,
    title: typeof rec.title === "string" ? rec.title : "",
    body: rec.body,
    bodyRich: (rec.bodyRich ?? null) as TiptapDoc | null,
    updatedAt: rec.updatedAt,
  };
}

function writeReplyDraft(
  storage: Storage,
  topicId: string,
  parentKey: string,
  draft: ReplyDraft,
): void {
  storage.setItem(replyDraftKey(topicId, parentKey), JSON.stringify(draft));
}

function readReplyMeta(storage: Storage, topicId: string, options: Options, nowMs: number): ReplyDraftMeta | null {
  const raw = storage.getItem(replyMetaKey(topicId));
  if (!raw) return null;
  const parsed = safeParseJson(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const rec = parsed as Record<string, unknown>;
  if (rec.schemaVersion !== 1) return null;
  if (!(rec.lastParentId === null || typeof rec.lastParentId === "string")) return null;
  if (typeof rec.updatedAt !== "string" || !rec.updatedAt) return null;
  if (isExpired(rec.updatedAt, nowMs, ttlMs(options))) {
    storage.removeItem(replyMetaKey(topicId));
    return null;
  }
  return { schemaVersion: 1, lastParentId: rec.lastParentId, updatedAt: rec.updatedAt };
}

function writeReplyMeta(
  storage: Storage,
  topicId: string,
  meta: ReplyDraftMeta,
): void {
  storage.setItem(replyMetaKey(topicId), JSON.stringify(meta));
}

function readEditRootDraft(
  storage: Storage,
  topicId: string,
  options: Options,
  nowMs: number,
): EditRootDraft | null {
  const raw = storage.getItem(editRootKey(topicId));
  if (!raw) return null;
  const parsed = safeParseJson(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const rec = parsed as Record<string, unknown>;
  if (rec.schemaVersion !== 1) return null;
  if (typeof rec.title !== "string") return null;
  if (typeof rec.body !== "string") return null;
  if (typeof rec.updatedAt !== "string" || !rec.updatedAt) return null;
  if (isExpired(rec.updatedAt, nowMs, ttlMs(options))) {
    storage.removeItem(editRootKey(topicId));
    return null;
  }
  return { schemaVersion: 1, title: rec.title, body: rec.body, updatedAt: rec.updatedAt };
}

function writeEditRootDraft(storage: Storage, topicId: string, draft: EditRootDraft): void {
  storage.setItem(editRootKey(topicId), JSON.stringify(draft));
}

export function createLocalStorageDraftStore(
  inputOptions?: Partial<Options>,
): DraftStore {
  const options: Options = {
    ttlDays: inputOptions?.ttlDays ?? DEFAULTS.ttlDays,
    maxReplyDraftsPerTopic:
      inputOptions?.maxReplyDraftsPerTopic ?? DEFAULTS.maxReplyDraftsPerTopic,
  };

  return {
    pruneTopic(topicId: string) {
      const storage = getStorage();
      pruneReplyDraftsForTopic(storage, topicId, options, Date.now());

      const nowMs = Date.now();
      readReplyMeta(storage, topicId, options, nowMs);
      readEditRootDraft(storage, topicId, options, nowMs);
    },

    getReplyDraft(topicId: string, parentArgumentId: string | null) {
      const storage = getStorage();
      const nowMs = Date.now();
      pruneReplyDraftsForTopic(storage, topicId, options, nowMs);

      const parentKey = toParentKey(parentArgumentId);
      const draft = readReplyDraft(storage, topicId, parentKey);
      if (!draft) return null;
      if (isExpired(draft.updatedAt, nowMs, ttlMs(options))) {
        storage.removeItem(replyDraftKey(topicId, parentKey));
        pruneReplyDraftsForTopic(storage, topicId, options, nowMs);
        return null;
      }
      return draft;
    },

    setReplyDraft(topicId: string, parentArgumentId: string | null, draftInput) {
      const title = typeof draftInput.title === "string" ? draftInput.title : "";
      const body = typeof draftInput.body === "string" ? draftInput.body : "";
      if (!title.trim() && !body.trim()) {
        this.removeReplyDraft(topicId, parentArgumentId);
        return null;
      }

      const storage = getStorage();
      const nowMs = Date.now();
      const parentKey = toParentKey(parentArgumentId);

      const draft: ReplyDraft = {
        schemaVersion: 1,
        title,
        body,
        bodyRich: draftInput.bodyRich ?? null,
        updatedAt: nowIso(nowMs),
      };

      writeReplyDraft(storage, topicId, parentKey, draft);

      let index = readReplyIndex(storage, topicId);
      if (!index) {
        index = rebuildReplyIndex(storage, topicId, options, nowMs);
      }
      index.entries[parentKey] = draft.updatedAt;
      index.updatedAt = draft.updatedAt;
      writeReplyIndex(storage, topicId, index);

      pruneReplyDraftsForTopic(storage, topicId, options, nowMs);

      return draft;
    },

    removeReplyDraft(topicId: string, parentArgumentId: string | null) {
      const storage = getStorage();
      const nowMs = Date.now();
      pruneReplyDraftsForTopic(storage, topicId, options, nowMs);

      const parentKey = toParentKey(parentArgumentId);
      storage.removeItem(replyDraftKey(topicId, parentKey));

      const index = readReplyIndex(storage, topicId);
      if (index && parentKey in index.entries) {
        delete index.entries[parentKey];
        index.updatedAt = nowIso(nowMs);
        writeReplyIndex(storage, topicId, index);
      }
    },

    getReplyMeta(topicId: string) {
      const storage = getStorage();
      const nowMs = Date.now();
      return readReplyMeta(storage, topicId, options, nowMs);
    },

    setReplyMeta(topicId: string, metaInput) {
      const storage = getStorage();
      const nowMs = Date.now();
      const meta: ReplyDraftMeta = {
        schemaVersion: 1,
        lastParentId: metaInput.lastParentId ?? null,
        updatedAt: nowIso(nowMs),
      };
      writeReplyMeta(storage, topicId, meta);
      return meta;
    },

    clearReplyMeta(topicId: string) {
      const storage = getStorage();
      storage.removeItem(replyMetaKey(topicId));
    },

    getEditRootDraft(topicId: string) {
      const storage = getStorage();
      const nowMs = Date.now();
      return readEditRootDraft(storage, topicId, options, nowMs);
    },

    setEditRootDraft(topicId: string, draftInput) {
      const title = typeof draftInput.title === "string" ? draftInput.title : "";
      const body = typeof draftInput.body === "string" ? draftInput.body : "";

      if (!title.trim() && !body.trim()) {
        this.removeEditRootDraft(topicId);
        return null;
      }

      const storage = getStorage();
      const nowMs = Date.now();
      const draft: EditRootDraft = {
        schemaVersion: 1,
        title,
        body,
        updatedAt: nowIso(nowMs),
      };
      writeEditRootDraft(storage, topicId, draft);
      return draft;
    },

    removeEditRootDraft(topicId: string) {
      const storage = getStorage();
      storage.removeItem(editRootKey(topicId));
    },
  };
}
