"use client";

/**
 * VisitedTopicsStore - Local storage for visited topic IDs
 * Step 17: Pure client-side aggregation for "My Activity" page
 *
 * @see docs/stage01/steps/step17.md
 */

export type VisitedTopicsStore = {
  /** Get all visited topic IDs */
  getTopicIds(): string[];
  /** Add a topic to visited list (deduplicates automatically) */
  addTopic(topicId: string): void;
  /** Remove a topic from visited list */
  removeTopic(topicId: string): void;
  /** Check if a topic has been visited */
  hasTopic(topicId: string): boolean;
  /** Clear all visited topics */
  clear(): void;
};

const STORAGE_KEY = "tm:visited-topics:v1";

function getStorage(): Storage {
  if (typeof window === "undefined" || !window.localStorage) {
    throw new Error("localStorage is unavailable");
  }
  return window.localStorage;
}

/**
 * Create a VisitedTopicsStore backed by localStorage
 */
export function createLocalStorageVisitedTopicsStore(options?: {
  key?: string;
}): VisitedTopicsStore {
  const key = options?.key ?? STORAGE_KEY;

  const readIds = (): string[] => {
    try {
      const storage = getStorage();
      const raw = storage.getItem(key);
      if (!raw) return [];

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];

      return parsed.filter((item): item is string => typeof item === "string");
    } catch {
      return [];
    }
  };

  const writeIds = (topicIds: string[]): void => {
    const storage = getStorage();
    storage.setItem(key, JSON.stringify(topicIds));
  };

  return {
    getTopicIds(): string[] {
      return readIds();
    },

    addTopic(topicId: string): void {
      const current = readIds();
      // Deduplicate: only add if not already present
      if (!current.includes(topicId)) {
        writeIds([...current, topicId]);
      }
    },

    removeTopic(topicId: string): void {
      const current = readIds();
      writeIds(current.filter((id) => id !== topicId));
    },

    hasTopic(topicId: string): boolean {
      return readIds().includes(topicId);
    },

    clear(): void {
      const storage = getStorage();
      storage.removeItem(key);
    },
  };
}

/** Default store instance */
export const visitedTopicsStore = createLocalStorageVisitedTopicsStore();
