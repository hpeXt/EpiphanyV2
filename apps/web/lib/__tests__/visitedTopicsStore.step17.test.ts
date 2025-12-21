/**
 * Step 17 - VisitedTopicsStore Tests
 * Tests for local topic tracking with deduplication and persistence
 */

import {
  createLocalStorageVisitedTopicsStore,
  type VisitedTopicsStore,
} from "@/lib/visitedTopicsStore";

describe("VisitedTopicsStore (Step 17)", () => {
  let store: VisitedTopicsStore;

  beforeEach(() => {
    window.localStorage.clear();
    store = createLocalStorageVisitedTopicsStore();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  describe("addTopic", () => {
    it("adds a topic to the visited list", () => {
      const topicId = "0193e3a6-0b7d-7a8d-9f2c-2f3aa3ad1a11";

      store.addTopic(topicId);

      const topics = store.getTopicIds();
      expect(topics).toContain(topicId);
      expect(topics.length).toBe(1);
    });

    it("deduplicates when adding the same topic twice", () => {
      const topicId = "0193e3a6-0b7d-7a8d-9f2c-2f3aa3ad1a11";

      store.addTopic(topicId);
      store.addTopic(topicId);
      store.addTopic(topicId);

      const topics = store.getTopicIds();
      expect(topics.filter((id) => id === topicId).length).toBe(1);
      expect(topics.length).toBe(1);
    });

    it("stores multiple different topics", () => {
      const topicId1 = "0193e3a6-0b7d-7a8d-9f2c-2f3aa3ad1a11";
      const topicId2 = "0193e3a6-0b7d-7a8d-9f2c-2f3aa3ad1a22";
      const topicId3 = "0193e3a6-0b7d-7a8d-9f2c-2f3aa3ad1a33";

      store.addTopic(topicId1);
      store.addTopic(topicId2);
      store.addTopic(topicId3);

      const topics = store.getTopicIds();
      expect(topics).toContain(topicId1);
      expect(topics).toContain(topicId2);
      expect(topics).toContain(topicId3);
      expect(topics.length).toBe(3);
    });
  });

  describe("persistence", () => {
    it("persists topics across store instances", () => {
      const topicId1 = "0193e3a6-0b7d-7a8d-9f2c-2f3aa3ad1a11";
      const topicId2 = "0193e3a6-0b7d-7a8d-9f2c-2f3aa3ad1a22";

      store.addTopic(topicId1);
      store.addTopic(topicId2);

      // Create a new store instance (simulates page reload)
      const store2 = createLocalStorageVisitedTopicsStore();
      const topics = store2.getTopicIds();

      expect(topics).toContain(topicId1);
      expect(topics).toContain(topicId2);
      expect(topics.length).toBe(2);
    });

    it("returns empty array when no topics have been visited", () => {
      const topics = store.getTopicIds();
      expect(topics).toEqual([]);
    });

    it("handles corrupted localStorage gracefully", () => {
      // Write invalid JSON to localStorage
      window.localStorage.setItem("tm:visited-topics:v1", "not-valid-json");

      const store2 = createLocalStorageVisitedTopicsStore();
      const topics = store2.getTopicIds();

      // Should return empty array and not throw
      expect(topics).toEqual([]);
    });

    it("handles non-array localStorage data gracefully", () => {
      // Write non-array JSON to localStorage
      window.localStorage.setItem("tm:visited-topics:v1", '{"foo":"bar"}');

      const store2 = createLocalStorageVisitedTopicsStore();
      const topics = store2.getTopicIds();

      // Should return empty array
      expect(topics).toEqual([]);
    });
  });

  describe("removeTopic", () => {
    it("removes a topic from the visited list", () => {
      const topicId1 = "0193e3a6-0b7d-7a8d-9f2c-2f3aa3ad1a11";
      const topicId2 = "0193e3a6-0b7d-7a8d-9f2c-2f3aa3ad1a22";

      store.addTopic(topicId1);
      store.addTopic(topicId2);
      store.removeTopic(topicId1);

      const topics = store.getTopicIds();
      expect(topics).not.toContain(topicId1);
      expect(topics).toContain(topicId2);
      expect(topics.length).toBe(1);
    });

    it("does nothing when removing a non-existent topic", () => {
      const topicId1 = "0193e3a6-0b7d-7a8d-9f2c-2f3aa3ad1a11";

      store.addTopic(topicId1);
      store.removeTopic("non-existent-id");

      const topics = store.getTopicIds();
      expect(topics).toContain(topicId1);
      expect(topics.length).toBe(1);
    });
  });

  describe("clear", () => {
    it("removes all visited topics", () => {
      store.addTopic("0193e3a6-0b7d-7a8d-9f2c-2f3aa3ad1a11");
      store.addTopic("0193e3a6-0b7d-7a8d-9f2c-2f3aa3ad1a22");

      store.clear();

      const topics = store.getTopicIds();
      expect(topics).toEqual([]);
    });
  });

  describe("hasTopic", () => {
    it("returns true for a visited topic", () => {
      const topicId = "0193e3a6-0b7d-7a8d-9f2c-2f3aa3ad1a11";

      store.addTopic(topicId);

      expect(store.hasTopic(topicId)).toBe(true);
    });

    it("returns false for a non-visited topic", () => {
      expect(store.hasTopic("non-existent-id")).toBe(false);
    });
  });
});
