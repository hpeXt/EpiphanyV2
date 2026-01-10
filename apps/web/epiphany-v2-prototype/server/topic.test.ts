import { describe, expect, it, beforeAll } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user-123",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

describe("topic router", () => {
  describe("topic.list", () => {
    it("returns a list of topics for public users", async () => {
      const ctx = createPublicContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.topic.list({ limit: 10 });

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("topic.getWithStats", () => {
    it("throws NOT_FOUND for non-existent topic", async () => {
      const ctx = createPublicContext();
      const caller = appRouter.createCaller(ctx);

      await expect(
        caller.topic.getWithStats({ slug: "non-existent-topic-slug" })
      ).rejects.toThrow("Topic not found");
    });
  });

  describe("topic.create", () => {
    it("requires authentication", async () => {
      const ctx = createPublicContext();
      const caller = appRouter.createCaller(ctx);

      await expect(
        caller.topic.create({
          title: "Test Topic",
          description: "Test description",
        })
      ).rejects.toThrow();
    });
  });
});

describe("viewpoint router", () => {
  describe("viewpoint.getSunburstData", () => {
    it("returns empty sunburst data for non-existent topic", async () => {
      const ctx = createPublicContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.viewpoint.getSunburstData({ topicId: 999999 });

      expect(result).toBeDefined();
      expect(result.name).toBe("root");
      expect(result.children).toEqual([]);
    });
  });

  describe("viewpoint.create", () => {
    it("requires authentication", async () => {
      const ctx = createPublicContext();
      const caller = appRouter.createCaller(ctx);

      await expect(
        caller.viewpoint.create({
          topicId: 1,
          title: "Test Viewpoint",
        })
      ).rejects.toThrow();
    });
  });
});

describe("vote router", () => {
  describe("vote.getCredits", () => {
    it("requires authentication", async () => {
      const ctx = createPublicContext();
      const caller = appRouter.createCaller(ctx);

      await expect(caller.vote.getCredits()).rejects.toThrow();
    });

    it("returns credits for authenticated user", async () => {
      const ctx = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.vote.getCredits();

      expect(result).toBeDefined();
      expect(result.credits).toBeDefined();
      expect(typeof result.credits).toBe("number");
    });
  });

  describe("vote.cast", () => {
    it("requires authentication", async () => {
      const ctx = createPublicContext();
      const caller = appRouter.createCaller(ctx);

      await expect(
        caller.vote.cast({
          viewpointId: 1,
          voteCount: 1,
        })
      ).rejects.toThrow();
    });
  });
});
