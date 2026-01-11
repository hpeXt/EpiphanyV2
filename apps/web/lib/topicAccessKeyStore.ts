export type TopicAccessKeyStore = {
  get: (topicId: string) => string | null;
  set: (topicId: string, accessKeyHex: string) => void;
  remove: (topicId: string) => void;
};

const PREFIX = "tm:topic-access-key:v1:";

function normalizeAccessKeyHex(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error("accessKey must be 64 hex chars");
  }
  return normalized;
}

export function createLocalStorageTopicAccessKeyStore(): TopicAccessKeyStore {
  return {
    get(topicId: string) {
      if (typeof window === "undefined") return null;
      const raw = window.localStorage.getItem(`${PREFIX}${topicId}`);
      if (!raw) return null;
      try {
        return normalizeAccessKeyHex(raw);
      } catch {
        return null;
      }
    },
    set(topicId: string, accessKeyHex: string) {
      if (typeof window === "undefined") return;
      const normalized = normalizeAccessKeyHex(accessKeyHex);
      window.localStorage.setItem(`${PREFIX}${topicId}`, normalized);
    },
    remove(topicId: string) {
      if (typeof window === "undefined") return;
      window.localStorage.removeItem(`${PREFIX}${topicId}`);
    },
  };
}

