/**
 * Step 17 - Batch Balance API Tests
 * Tests for batch-balance with item-level signing and failure isolation
 */

import { mnemonicToMasterSeedHex } from "@/lib/identity";
import { createLocalStorageKeyStore } from "@/lib/signing";
import {
  buildBatchBalanceItems,
  createApiClient,
} from "@/lib/apiClient";

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe("Batch Balance API (Step 17)", () => {
  const mnemonic =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
  const masterSeedHex = mnemonicToMasterSeedHex(mnemonic);

  beforeEach(() => {
    window.localStorage.clear();
    mockFetch.mockReset();
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.com";

    // Set up the master seed
    const keyStore = createLocalStorageKeyStore();
    keyStore.setMasterSeedHex(masterSeedHex);
  });

  afterEach(() => {
    window.localStorage.clear();
    delete process.env.NEXT_PUBLIC_API_URL;
  });

  describe("buildBatchBalanceItems", () => {
    it("creates correctly signed items for each topicId", async () => {
      const topicIds = [
        "0193e3a6-0b7d-7a8d-9f2c-2f3aa3ad1a11",
        "0193e3a6-0b7d-7a8d-9f2c-2f3aa3ad1a22",
      ];

      const items = await buildBatchBalanceItems(topicIds);

      expect(items).toHaveLength(2);

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        expect(item.topicId).toBe(topicIds[i]);
        expect(item.pubkey).toMatch(/^[0-9a-f]{64}$/); // 64 hex chars
        expect(item.signature).toMatch(/^[0-9a-f]{128}$/); // 128 hex chars
        expect(typeof item.timestamp).toBe("number");
        expect(item.timestamp).toBeGreaterThan(0);
        expect(item.nonce).toMatch(/^[0-9a-f]+$/);
      }
    });

    it("derives different pubkeys for different topics", async () => {
      const topicIds = [
        "0193e3a6-0b7d-7a8d-9f2c-2f3aa3ad1a11",
        "0193e3a6-0b7d-7a8d-9f2c-2f3aa3ad1a22",
      ];

      const items = await buildBatchBalanceItems(topicIds);

      // Different topics should have different pubkeys
      expect(items[0].pubkey).not.toBe(items[1].pubkey);
    });

    it("returns empty array for empty topicIds", async () => {
      const items = await buildBatchBalanceItems([]);
      expect(items).toEqual([]);
    });
  });

  describe("batchBalance API call", () => {
    it("returns successful results for valid items", async () => {
      const mockResponse = {
        results: [
          {
            topicId: "0193e3a6-0b7d-7a8d-9f2c-2f3aa3ad1a11",
            ok: true,
            balance: 100,
            myTotalVotes: 0,
            myTotalCost: 0,
            lastInteractionAt: null,
          },
          {
            topicId: "0193e3a6-0b7d-7a8d-9f2c-2f3aa3ad1a22",
            ok: true,
            balance: 50,
            myTotalVotes: 5,
            myTotalCost: 50,
            lastInteractionAt: "2025-12-19T12:00:00.000Z",
          },
        ],
      };

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      const apiClient = createApiClient();
      const topicIds = [
        "0193e3a6-0b7d-7a8d-9f2c-2f3aa3ad1a11",
        "0193e3a6-0b7d-7a8d-9f2c-2f3aa3ad1a22",
      ];

      const result = await apiClient.batchBalance(topicIds);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.results).toHaveLength(2);
        expect(result.data.results[0].ok).toBe(true);
        expect(result.data.results[1].ok).toBe(true);
      }
    });

    it("isolates single item failure from other items", async () => {
      const mockResponse = {
        results: [
          {
            topicId: "0193e3a6-0b7d-7a8d-9f2c-2f3aa3ad1a11",
            ok: true,
            balance: 100,
            myTotalVotes: 0,
            myTotalCost: 0,
            lastInteractionAt: null,
          },
          {
            topicId: "0193e3a6-0b7d-7a8d-9f2c-2f3aa3ad1a22",
            ok: false,
            error: {
              code: "TOPIC_NOT_FOUND",
              message: "Topic does not exist",
            },
          },
          {
            topicId: "0193e3a6-0b7d-7a8d-9f2c-2f3aa3ad1a33",
            ok: true,
            balance: 75,
            myTotalVotes: 3,
            myTotalCost: 25,
            lastInteractionAt: null,
          },
        ],
      };

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      const apiClient = createApiClient();
      const topicIds = [
        "0193e3a6-0b7d-7a8d-9f2c-2f3aa3ad1a11",
        "0193e3a6-0b7d-7a8d-9f2c-2f3aa3ad1a22",
        "0193e3a6-0b7d-7a8d-9f2c-2f3aa3ad1a33",
      ];

      const result = await apiClient.batchBalance(topicIds);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const results = result.data.results;
        expect(results).toHaveLength(3);

        // First item succeeded
        expect(results[0].ok).toBe(true);
        if (results[0].ok) {
          expect(results[0].balance).toBe(100);
        }

        // Second item failed but has error info
        expect(results[1].ok).toBe(false);
        if (!results[1].ok) {
          expect(results[1].error.code).toBe("TOPIC_NOT_FOUND");
          expect(results[1].error.message).toBeTruthy();
        }

        // Third item succeeded despite the failure of second
        expect(results[2].ok).toBe(true);
        if (results[2].ok) {
          expect(results[2].balance).toBe(75);
        }
      }
    });

    it("handles signature verification failure gracefully", async () => {
      const mockResponse = {
        results: [
          {
            topicId: "0193e3a6-0b7d-7a8d-9f2c-2f3aa3ad1a11",
            ok: false,
            error: {
              code: "INVALID_SIGNATURE",
              message: "Signature verification failed",
            },
          },
        ],
      };

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      const apiClient = createApiClient();
      const result = await apiClient.batchBalance([
        "0193e3a6-0b7d-7a8d-9f2c-2f3aa3ad1a11",
      ]);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.results[0].ok).toBe(false);
        if (!result.data.results[0].ok) {
          expect(result.data.results[0].error.code).toBe("INVALID_SIGNATURE");
        }
      }
    });

    it("sends request to correct endpoint with items in body", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ results: [] })),
      });

      const apiClient = createApiClient();
      await apiClient.batchBalance(["0193e3a6-0b7d-7a8d-9f2c-2f3aa3ad1a11"]);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];

      expect(url).toBe("https://api.example.com/v1/user/batch-balance");
      expect(options.method).toBe("POST");
      expect(options.headers["content-type"]).toBe("application/json");

      const body = JSON.parse(options.body);
      expect(body.items).toBeDefined();
      expect(Array.isArray(body.items)).toBe(true);
    });

    it("does not require auth headers (signing is in body items)", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ results: [] })),
      });

      const apiClient = createApiClient();
      await apiClient.batchBalance(["0193e3a6-0b7d-7a8d-9f2c-2f3aa3ad1a11"]);

      const [, options] = mockFetch.mock.calls[0];

      // Should NOT have X-Pubkey, X-Signature headers (signing is in body)
      expect(options.headers["X-Pubkey"]).toBeUndefined();
      expect(options.headers["X-Signature"]).toBeUndefined();
    });
  });
});
