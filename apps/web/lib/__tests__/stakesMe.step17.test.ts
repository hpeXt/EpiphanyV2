/**
 * Step 17 - Stakes/Me API Tests
 * Tests for stakes/me display including pruned stake visibility
 */

import { mnemonicToMasterSeedHex } from "@/lib/identity";
import { createLocalStorageKeyStore } from "@/lib/signing";
import { createApiClient } from "@/lib/apiClient";

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe("Stakes/Me API (Step 17)", () => {
  const mnemonic =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
  const masterSeedHex = mnemonicToMasterSeedHex(mnemonic);

  beforeEach(() => {
    window.localStorage.clear();
    mockFetch.mockReset();
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.com";

    const keyStore = createLocalStorageKeyStore();
    keyStore.setMasterSeedHex(masterSeedHex);
  });

  afterEach(() => {
    window.localStorage.clear();
    delete process.env.NEXT_PUBLIC_API_URL;
  });

  describe("getStakesMe", () => {
    it("returns stakes for a topic with proper signature headers", async () => {
      const topicId = "0193e3a6-0b7d-7a8d-9f2c-2f3aa3ad1a11";
      const mockResponse = {
        topicId,
        pubkey: "a".repeat(64),
        items: [
          {
            argumentId: "0193e3a6-0b7d-7a8d-9f2c-2f3aa3ad1b11",
            votes: 3,
            cost: 9,
            argumentPrunedAt: null,
            updatedAt: "2025-12-19T12:00:00.000Z",
            argumentTitle: "Test Argument",
            argumentExcerpt: "This is a test...",
          },
        ],
      };

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      const apiClient = createApiClient();
      const result = await apiClient.getStakesMe(topicId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.topicId).toBe(topicId);
        expect(result.data.items).toHaveLength(1);
        expect(result.data.items[0].votes).toBe(3);
        expect(result.data.items[0].cost).toBe(9);
      }

      // Verify signature headers were sent
      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers["X-Pubkey"]).toMatch(/^[0-9a-f]{64}$/);
      expect(options.headers["X-Signature"]).toMatch(/^[0-9a-f]{128}$/);
      expect(options.headers["X-Timestamp"]).toBeDefined();
      expect(options.headers["X-Nonce"]).toBeDefined();
    });

    it("returns pruned stakes with argumentPrunedAt field", async () => {
      const topicId = "0193e3a6-0b7d-7a8d-9f2c-2f3aa3ad1a11";
      const prunedAt = "2025-12-18T10:00:00.000Z";
      const mockResponse = {
        topicId,
        pubkey: "a".repeat(64),
        items: [
          {
            argumentId: "0193e3a6-0b7d-7a8d-9f2c-2f3aa3ad1b11",
            votes: 5,
            cost: 25,
            argumentPrunedAt: prunedAt,
            updatedAt: "2025-12-19T12:00:00.000Z",
            argumentTitle: "Pruned Argument",
            argumentExcerpt: "This was pruned...",
          },
          {
            argumentId: "0193e3a6-0b7d-7a8d-9f2c-2f3aa3ad1b22",
            votes: 2,
            cost: 4,
            argumentPrunedAt: null,
            updatedAt: "2025-12-19T12:00:00.000Z",
            argumentTitle: "Active Argument",
            argumentExcerpt: "This is active...",
          },
        ],
      };

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      const apiClient = createApiClient();
      const result = await apiClient.getStakesMe(topicId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.items).toHaveLength(2);

        // Pruned stake is visible
        const prunedStake = result.data.items[0];
        expect(prunedStake.argumentPrunedAt).toBe(prunedAt);
        expect(prunedStake.votes).toBe(5);
        expect(prunedStake.cost).toBe(25);

        // Active stake
        const activeStake = result.data.items[1];
        expect(activeStake.argumentPrunedAt).toBeNull();
      }
    });

    it("handles topic not found error", async () => {
      const topicId = "non-existent-topic";
      const mockResponse = {
        error: {
          code: "TOPIC_NOT_FOUND",
          message: "Topic does not exist",
        },
      };

      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      const apiClient = createApiClient();
      const result = await apiClient.getStakesMe(topicId);

      expect(result.ok).toBe(false);
      if (!result.ok && result.error.kind === "http") {
        expect(result.error.code).toBe("TOPIC_NOT_FOUND");
      }
    });

    it("returns empty items array when no stakes exist", async () => {
      const topicId = "0193e3a6-0b7d-7a8d-9f2c-2f3aa3ad1a11";
      const mockResponse = {
        topicId,
        pubkey: "a".repeat(64),
        items: [],
      };

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      const apiClient = createApiClient();
      const result = await apiClient.getStakesMe(topicId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.items).toEqual([]);
      }
    });
  });
});
