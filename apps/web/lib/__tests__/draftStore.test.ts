import { createLocalStorageDraftStore } from "@/lib/draftStore";

describe("DraftStore", () => {
  beforeEach(() => {
    window.localStorage.clear();
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
    window.localStorage.clear();
  });

  it("persists reply drafts per node across reloads", () => {
    const store1 = createLocalStorageDraftStore({
      ttlDays: 30,
      maxReplyDraftsPerTopic: 50,
    });

    const topicId = "0193e3a6-0b7d-7a8d-9f2c-2f3aa3ad1a11";
    const parentA = "0193e3a6-0b7d-7a8d-9f2c-2f3aa3ad1a22";
    const parentB = "0193e3a6-0b7d-7a8d-9f2c-2f3aa3ad1a33";

    store1.setReplyDraft(topicId, parentA, {
      body: "Hello A",
      bodyRich: { type: "doc", content: [] },
    });
    store1.setReplyDraft(topicId, parentB, {
      body: "Hello B",
      bodyRich: null,
    });

    const store2 = createLocalStorageDraftStore({
      ttlDays: 30,
      maxReplyDraftsPerTopic: 50,
    });

    expect(store2.getReplyDraft(topicId, parentA)?.body).toBe("Hello A");
    expect(store2.getReplyDraft(topicId, parentB)?.body).toBe("Hello B");
  });

  it("prunes oldest reply drafts beyond max per topic", () => {
    const store = createLocalStorageDraftStore({
      ttlDays: 30,
      maxReplyDraftsPerTopic: 3,
    });

    const topicId = "0193e3a6-0b7d-7a8d-9f2c-2f3aa3ad1a11";
    const parents = ["a", "b", "c", "d"];

    for (const parent of parents) {
      store.setReplyDraft(topicId, parent, { body: `draft-${parent}`, bodyRich: null });
      jest.setSystemTime(new Date(Date.now() + 60_000));
    }

    expect(store.getReplyDraft(topicId, "a")).toBeNull();
    expect(store.getReplyDraft(topicId, "b")?.body).toBe("draft-b");
    expect(store.getReplyDraft(topicId, "c")?.body).toBe("draft-c");
    expect(store.getReplyDraft(topicId, "d")?.body).toBe("draft-d");
  });

  it("expires reply drafts after ttl", () => {
    const store = createLocalStorageDraftStore({
      ttlDays: 1,
      maxReplyDraftsPerTopic: 50,
    });

    const topicId = "0193e3a6-0b7d-7a8d-9f2c-2f3aa3ad1a11";

    store.setReplyDraft(topicId, "root", { body: "draft", bodyRich: null });
    expect(store.getReplyDraft(topicId, "root")?.body).toBe("draft");

    jest.setSystemTime(new Date("2026-01-03T00:00:00.000Z"));
    expect(store.getReplyDraft(topicId, "root")).toBeNull();
  });

  it("removes edit-root draft when empty", () => {
    const store = createLocalStorageDraftStore({
      ttlDays: 30,
      maxReplyDraftsPerTopic: 50,
    });

    const topicId = "0193e3a6-0b7d-7a8d-9f2c-2f3aa3ad1a11";

    store.setEditRootDraft(topicId, { title: "T", body: "B" });
    expect(store.getEditRootDraft(topicId)?.title).toBe("T");

    store.setEditRootDraft(topicId, { title: "   ", body: "  " });
    expect(store.getEditRootDraft(topicId)).toBeNull();
  });
});

