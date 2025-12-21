/**
 * Step 17 - Withdraw All Tests
 * Tests for withdraw-all functionality with concurrency limit and retry
 */

import { mnemonicToMasterSeedHex } from "@/lib/identity";
import { createLocalStorageKeyStore } from "@/lib/signing";
import {
  withdrawAll,
  type WithdrawProgress,
} from "@/lib/withdrawAll";

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe("Withdraw All (Step 17)", () => {
  const mnemonic =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
  const masterSeedHex = mnemonicToMasterSeedHex(mnemonic);
  const topicId = "0193e3a6-0b7d-7a8d-9f2c-2f3aa3ad1a11";

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

  function createMockSetVotesResponse(argumentId: string) {
    return {
      argumentId,
      previousVotes: 3,
      targetVotes: 0,
      deltaVotes: -3,
      previousCost: 9,
      targetCost: 0,
      deltaCost: -9,
      ledger: {
        topicId,
        pubkey: "a".repeat(64),
        balance: 100,
        myTotalVotes: 0,
        myTotalCost: 0,
        lastInteractionAt: "2025-12-19T12:00:00.000Z",
      },
    };
  }

  describe("successful withdrawal", () => {
    it("withdraws all stakes by calling setVotes(0) for each", async () => {
      const stakes = [
        { argumentId: "arg-1", votes: 3, cost: 9 },
        { argumentId: "arg-2", votes: 2, cost: 4 },
        { argumentId: "arg-3", votes: 1, cost: 1 },
      ];

      mockFetch.mockImplementation((url: string) => {
        const argumentId = url.match(/\/arguments\/([^/]+)\/votes/)?.[1];
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () =>
            Promise.resolve(
              JSON.stringify(createMockSetVotesResponse(argumentId ?? "")),
            ),
        });
      });

      const result = await withdrawAll(topicId, stakes);

      expect(result.successful).toHaveLength(3);
      expect(result.failed).toHaveLength(0);
      expect(mockFetch).toHaveBeenCalledTimes(3);

      // Verify each call was setVotes with targetVotes=0
      for (const call of mockFetch.mock.calls) {
        const [, options] = call;
        const body = JSON.parse(options.body);
        expect(body.targetVotes).toBe(0);
      }
    });

    it("returns correct ledger balance after withdrawal", async () => {
      const stakes = [{ argumentId: "arg-1", votes: 5, cost: 25 }];

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              ...createMockSetVotesResponse("arg-1"),
              ledger: {
                topicId,
                pubkey: "a".repeat(64),
                balance: 100, // Full balance restored
                myTotalVotes: 0,
                myTotalCost: 0,
                lastInteractionAt: "2025-12-19T12:00:00.000Z",
              },
            }),
          ),
      });

      const result = await withdrawAll(topicId, stakes);

      expect(result.successful).toHaveLength(1);
      expect(result.finalLedger?.balance).toBe(100);
    });
  });

  describe("partial failure handling", () => {
    it("continues processing when one item fails", async () => {
      const stakes = [
        { argumentId: "arg-1", votes: 3, cost: 9 },
        { argumentId: "arg-2", votes: 2, cost: 4 },
        { argumentId: "arg-3", votes: 1, cost: 1 },
      ];

      let callIndex = 0;
      mockFetch.mockImplementation(() => {
        callIndex++;
        if (callIndex === 2) {
          // Second call fails
          return Promise.resolve({
            ok: false,
            status: 500,
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  error: { code: "INTERNAL_ERROR", message: "Server error" },
                }),
              ),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () =>
            Promise.resolve(
              JSON.stringify(createMockSetVotesResponse(`arg-${callIndex}`)),
            ),
        });
      });

      const result = await withdrawAll(topicId, stakes);

      // Two succeeded, one failed
      expect(result.successful.length).toBe(2);
      expect(result.failed.length).toBe(1);
      expect(result.failed[0].argumentId).toBe("arg-2");
      expect(result.failed[0].error).toBeDefined();
    });

    it("does not corrupt state when failures occur", async () => {
      const stakes = [
        { argumentId: "arg-1", votes: 3, cost: 9 },
        { argumentId: "arg-2", votes: 2, cost: 4 },
      ];

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: () =>
            Promise.resolve(
              JSON.stringify(createMockSetVotesResponse("arg-1")),
            ),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 402,
          text: () =>
            Promise.resolve(
              JSON.stringify({
                error: {
                  code: "INSUFFICIENT_BALANCE",
                  message: "Not enough balance",
                },
              }),
            ),
        });

      const result = await withdrawAll(topicId, stakes);

      // First succeeded
      expect(result.successful).toContainEqual(
        expect.objectContaining({ argumentId: "arg-1" }),
      );

      // Second failed with proper error info
      expect(result.failed).toContainEqual(
        expect.objectContaining({
          argumentId: "arg-2",
          error: expect.objectContaining({ code: "INSUFFICIENT_BALANCE" }),
        }),
      );
    });

    it("provides retryable failed items list", async () => {
      const stakes = [
        { argumentId: "arg-1", votes: 3, cost: 9 },
        { argumentId: "arg-2", votes: 2, cost: 4 },
      ];

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: () =>
            Promise.resolve(
              JSON.stringify(createMockSetVotesResponse("arg-1")),
            ),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: () =>
            Promise.resolve(
              JSON.stringify({
                error: { code: "INTERNAL_ERROR", message: "Temporary error" },
              }),
            ),
        });

      const result = await withdrawAll(topicId, stakes);

      // Failed items should be retryable
      expect(result.failed).toHaveLength(1);
      const failedItem = result.failed[0];
      expect(failedItem.argumentId).toBe("arg-2");
      expect(failedItem.votes).toBe(2);
      expect(failedItem.cost).toBe(4);

      // Can retry with just the failed items
      mockFetch.mockReset();
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(JSON.stringify(createMockSetVotesResponse("arg-2"))),
      });

      const retryStakes = result.failed.map((f) => ({
        argumentId: f.argumentId,
        votes: f.votes,
        cost: f.cost,
      }));
      const retryResult = await withdrawAll(topicId, retryStakes);

      expect(retryResult.successful).toHaveLength(1);
      expect(retryResult.failed).toHaveLength(0);
    });
  });

  describe("concurrency control", () => {
    it("limits concurrent requests to specified maximum", async () => {
      const stakes = Array.from({ length: 10 }, (_, i) => ({
        argumentId: `arg-${i}`,
        votes: 1,
        cost: 1,
      }));

      let maxConcurrent = 0;
      let currentConcurrent = 0;

      mockFetch.mockImplementation(async () => {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);

        // Simulate some delay
        await new Promise((resolve) => setTimeout(resolve, 10));

        currentConcurrent--;
        return {
          ok: true,
          status: 200,
          text: () =>
            Promise.resolve(
              JSON.stringify(createMockSetVotesResponse("arg-x")),
            ),
        };
      });

      await withdrawAll(topicId, stakes, { concurrencyLimit: 2 });

      // Should never exceed concurrency limit
      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });

    it("uses default concurrency limit of 2", async () => {
      const stakes = Array.from({ length: 6 }, (_, i) => ({
        argumentId: `arg-${i}`,
        votes: 1,
        cost: 1,
      }));

      let maxConcurrent = 0;
      let currentConcurrent = 0;

      mockFetch.mockImplementation(async () => {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);

        await new Promise((resolve) => setTimeout(resolve, 10));

        currentConcurrent--;
        return {
          ok: true,
          status: 200,
          text: () =>
            Promise.resolve(
              JSON.stringify(createMockSetVotesResponse("arg-x")),
            ),
        };
      });

      await withdrawAll(topicId, stakes);

      // Default concurrency is 2
      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });
  });

  describe("progress callback", () => {
    it("calls progress callback for each completed item", async () => {
      const stakes = [
        { argumentId: "arg-1", votes: 3, cost: 9 },
        { argumentId: "arg-2", votes: 2, cost: 4 },
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(JSON.stringify(createMockSetVotesResponse("arg-x"))),
      });

      const progressUpdates: WithdrawProgress[] = [];
      await withdrawAll(topicId, stakes, {
        onProgress: (progress) => progressUpdates.push({ ...progress }),
      });

      expect(progressUpdates.length).toBe(2);
      expect(progressUpdates[0].completed).toBe(1);
      expect(progressUpdates[0].total).toBe(2);
      expect(progressUpdates[1].completed).toBe(2);
      expect(progressUpdates[1].total).toBe(2);
    });

    it("reports failures in progress callback", async () => {
      const stakes = [
        { argumentId: "arg-1", votes: 3, cost: 9 },
        { argumentId: "arg-2", votes: 2, cost: 4 },
      ];

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: () =>
            Promise.resolve(
              JSON.stringify(createMockSetVotesResponse("arg-1")),
            ),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: () =>
            Promise.resolve(
              JSON.stringify({
                error: { code: "INTERNAL_ERROR", message: "Error" },
              }),
            ),
        });

      const progressUpdates: WithdrawProgress[] = [];
      await withdrawAll(topicId, stakes, {
        onProgress: (progress) => progressUpdates.push({ ...progress }),
      });

      expect(progressUpdates.length).toBe(2);
      expect(progressUpdates[0].successCount).toBe(1);
      expect(progressUpdates[0].failCount).toBe(0);
      expect(progressUpdates[1].successCount).toBe(1);
      expect(progressUpdates[1].failCount).toBe(1);
    });
  });

  describe("edge cases", () => {
    it("handles empty stakes array", async () => {
      const result = await withdrawAll(topicId, []);

      expect(result.successful).toEqual([]);
      expect(result.failed).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("handles network errors gracefully", async () => {
      const stakes = [{ argumentId: "arg-1", votes: 3, cost: 9 }];

      mockFetch.mockRejectedValue(new Error("Network error"));

      const result = await withdrawAll(topicId, stakes);

      expect(result.successful).toHaveLength(0);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].error.message).toContain("Network error");
    });

    it("skips stakes with zero votes", async () => {
      const stakes = [
        { argumentId: "arg-1", votes: 0, cost: 0 },
        { argumentId: "arg-2", votes: 3, cost: 9 },
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(JSON.stringify(createMockSetVotesResponse("arg-2"))),
      });

      const result = await withdrawAll(topicId, stakes);

      // Only one request made (for non-zero stake)
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.successful).toHaveLength(1);
      expect(result.successful[0].argumentId).toBe("arg-2");
    });
  });
});
