/**
 * Step 17 - MyActivity Component Tests
 * Tests for My Activity page with visited topics aggregation
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MyActivity } from "@/components/my/MyActivity";
import { createLocalStorageVisitedTopicsStore } from "@/lib/visitedTopicsStore";
import { createLocalStorageKeyStore } from "@/lib/signing";
import { mnemonicToMasterSeedHex } from "@/lib/identity";

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock useRouter
const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

describe("MyActivity Component (Step 17)", () => {
  const mnemonic =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
  const masterSeedHex = mnemonicToMasterSeedHex(mnemonic);

  beforeEach(() => {
    window.localStorage.clear();
    mockFetch.mockReset();
    mockPush.mockReset();
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.com";

    // Set up identity
    const keyStore = createLocalStorageKeyStore();
    keyStore.setMasterSeedHex(masterSeedHex);
  });

  afterEach(() => {
    window.localStorage.clear();
    delete process.env.NEXT_PUBLIC_API_URL;
  });

  describe("visited topics display", () => {
    it("shows message when no topics have been visited", async () => {
      render(<MyActivity />);

      await waitFor(() => {
        expect(
          screen.getByText(/no activity yet|no topics visited yet|暂无参与记录/i),
        ).toBeInTheDocument();
      });
    });

    it("displays visited topics from local store", async () => {
      // Add some visited topics
      const store = createLocalStorageVisitedTopicsStore();
      store.addTopic("topic-1");
      store.addTopic("topic-2");

      // Mock batch-balance response
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              results: [
                {
                  topicId: "topic-1",
                  ok: true,
                  balance: 75,
                  myTotalVotes: 5,
                  myTotalCost: 25,
                  lastInteractionAt: "2025-12-19T12:00:00.000Z",
                },
                {
                  topicId: "topic-2",
                  ok: true,
                  balance: 100,
                  myTotalVotes: 0,
                  myTotalCost: 0,
                  lastInteractionAt: null,
                },
              ],
            }),
          ),
      });

      render(<MyActivity />);

      await waitFor(() => {
        expect(screen.getByText("topic-1")).toBeInTheDocument();
        expect(screen.getByText("topic-2")).toBeInTheDocument();
      });
    });

    it("shows balance for each topic", async () => {
      const store = createLocalStorageVisitedTopicsStore();
      store.addTopic("topic-1");

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              results: [
                {
                  topicId: "topic-1",
                  ok: true,
                  balance: 75,
                  myTotalVotes: 5,
                  myTotalCost: 25,
                  lastInteractionAt: "2025-12-19T12:00:00.000Z",
                },
              ],
            }),
          ),
      });

      render(<MyActivity />);

      await waitFor(() => {
        expect(screen.getByText(/Balance:|余额:/i)).toBeInTheDocument();
        expect(screen.getByText("75")).toBeInTheDocument();
      });
    });
  });

  describe("batch-balance error handling", () => {
    it("shows error for failed topic without affecting others", async () => {
      const store = createLocalStorageVisitedTopicsStore();
      store.addTopic("topic-1");
      store.addTopic("topic-2");

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              results: [
                {
                  topicId: "topic-1",
                  ok: true,
                  balance: 75,
                  myTotalVotes: 5,
                  myTotalCost: 25,
                  lastInteractionAt: null,
                },
                {
                  topicId: "topic-2",
                  ok: false,
                  error: {
                    code: "TOPIC_NOT_FOUND",
                    message: "Topic does not exist",
                  },
                },
              ],
            }),
          ),
      });

      render(<MyActivity />);

      await waitFor(() => {
        // First topic shows normally
        expect(screen.getByText("topic-1")).toBeInTheDocument();
        expect(screen.getByText("75")).toBeInTheDocument();

        // Second topic shows error
        expect(screen.getByText("topic-2")).toBeInTheDocument();
        expect(screen.getByText(/topic not found|议题不存在/i)).toBeInTheDocument();
      });
    });

    it("shows signature error with readable message", async () => {
      const store = createLocalStorageVisitedTopicsStore();
      store.addTopic("topic-1");

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              results: [
                {
                  topicId: "topic-1",
                  ok: false,
                  error: {
                    code: "INVALID_SIGNATURE",
                    message: "Signature verification failed",
                  },
                },
              ],
            }),
          ),
      });

      render(<MyActivity />);

      await waitFor(() => {
        expect(screen.getByText(/signature|签名错误/i)).toBeInTheDocument();
      });
    });
  });

  describe("stakes display", () => {
    it("loads stakes when selecting a topic", async () => {
      const user = userEvent.setup();
      const store = createLocalStorageVisitedTopicsStore();
      store.addTopic("topic-1");

      // Mock batch-balance
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              results: [
                {
                  topicId: "topic-1",
                  ok: true,
                  balance: 75,
                  myTotalVotes: 5,
                  myTotalCost: 25,
                  lastInteractionAt: null,
                },
              ],
            }),
          ),
      });

      render(<MyActivity />);

      await waitFor(() => {
        expect(screen.getByText("topic-1")).toBeInTheDocument();
      });

      // Mock stakes/me
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              topicId: "topic-1",
              pubkey: "a".repeat(64),
              items: [
                {
                  argumentId: "arg-1",
                  votes: 3,
                  cost: 9,
                  argumentPrunedAt: null,
                  updatedAt: "2025-12-19T12:00:00.000Z",
                  argumentTitle: "Test Argument",
                  argumentExcerpt: "This is a test...",
                },
              ],
            }),
          ),
      });

      // Click to expand topic
      await user.click(screen.getByText("topic-1"));

      await waitFor(() => {
        expect(screen.getByText("Test Argument")).toBeInTheDocument();
        expect(screen.getByText(/Votes:|票数:/i)).toBeInTheDocument();
        expect(screen.getByText("3")).toBeInTheDocument();
      });
    });

    it("shows pruned badge for pruned stakes", async () => {
      const user = userEvent.setup();
      const store = createLocalStorageVisitedTopicsStore();
      store.addTopic("topic-1");

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              results: [
                {
                  topicId: "topic-1",
                  ok: true,
                  balance: 75,
                  myTotalVotes: 5,
                  myTotalCost: 25,
                  lastInteractionAt: null,
                },
              ],
            }),
          ),
      });

      render(<MyActivity />);

      await waitFor(() => {
        expect(screen.getByText("topic-1")).toBeInTheDocument();
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              topicId: "topic-1",
              pubkey: "a".repeat(64),
              items: [
                {
                  argumentId: "arg-1",
                  votes: 5,
                  cost: 25,
                  argumentPrunedAt: "2025-12-18T10:00:00.000Z",
                  updatedAt: "2025-12-19T12:00:00.000Z",
                  argumentTitle: "Pruned Argument",
                  argumentExcerpt: "This was pruned...",
                },
              ],
            }),
          ),
      });

      await user.click(screen.getByText("topic-1"));

      await waitFor(() => {
        expect(screen.getByText("Pruned Argument")).toBeInTheDocument();
        expect(screen.getByText(/^Pruned$|^已修剪$/i)).toBeInTheDocument();
      });
    });
  });

  describe("withdraw all functionality", () => {
    it("shows withdraw all button when stakes exist", async () => {
      const user = userEvent.setup();
      const store = createLocalStorageVisitedTopicsStore();
      store.addTopic("topic-1");

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              results: [
                {
                  topicId: "topic-1",
                  ok: true,
                  balance: 75,
                  myTotalVotes: 5,
                  myTotalCost: 25,
                  lastInteractionAt: null,
                },
              ],
            }),
          ),
      });

      render(<MyActivity />);

      await waitFor(() => {
        expect(screen.getByText("topic-1")).toBeInTheDocument();
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              topicId: "topic-1",
              pubkey: "a".repeat(64),
              items: [
                {
                  argumentId: "arg-1",
                  votes: 3,
                  cost: 9,
                  argumentPrunedAt: null,
                  updatedAt: "2025-12-19T12:00:00.000Z",
                  argumentTitle: "Test",
                  argumentExcerpt: "Test...",
                },
              ],
            }),
          ),
      });

      await user.click(screen.getByText("topic-1"));

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /withdraw all|全部撤回/i }),
        ).toBeInTheDocument();
      });
    });

    it("executes withdrawal and updates UI on success", async () => {
      const user = userEvent.setup();
      const store = createLocalStorageVisitedTopicsStore();
      store.addTopic("topic-1");

      // Initial batch-balance
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              results: [
                {
                  topicId: "topic-1",
                  ok: true,
                  balance: 75,
                  myTotalVotes: 5,
                  myTotalCost: 25,
                  lastInteractionAt: null,
                },
              ],
            }),
          ),
      });

      render(<MyActivity />);

      await waitFor(() => {
        expect(screen.getByText("topic-1")).toBeInTheDocument();
      });

      // Stakes/me
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              topicId: "topic-1",
              pubkey: "a".repeat(64),
              items: [
                {
                  argumentId: "arg-1",
                  votes: 5,
                  cost: 25,
                  argumentPrunedAt: null,
                  updatedAt: "2025-12-19T12:00:00.000Z",
                  argumentTitle: "Test",
                  argumentExcerpt: "Test...",
                },
              ],
            }),
          ),
      });

      await user.click(screen.getByText("topic-1"));

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /withdraw all|全部撤回/i }),
        ).toBeInTheDocument();
      });

      // Mock setVotes(0) success then refresh stakes
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: () =>
            Promise.resolve(
              JSON.stringify({
                argumentId: "arg-1",
                previousVotes: 5,
                targetVotes: 0,
                deltaVotes: -5,
                previousCost: 25,
                targetCost: 0,
                deltaCost: -25,
                ledger: {
                  topicId: "topic-1",
                  pubkey: "a".repeat(64),
                  balance: 100,
                  myTotalVotes: 0,
                  myTotalCost: 0,
                  lastInteractionAt: "2025-12-19T12:00:00.000Z",
                },
              }),
            ),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: () =>
            Promise.resolve(
              JSON.stringify({
                topicId: "topic-1",
                pubkey: "a".repeat(64),
                items: [],
              }),
            ),
        });

      await user.click(
        screen.getByRole("button", { name: /withdraw all|全部撤回/i }),
      );

      await waitFor(() => {
        // Balance should be updated to 100
        expect(screen.getByText("100")).toBeInTheDocument();
      });
    });

    it("shows retry option for failed withdrawals", async () => {
      const user = userEvent.setup();
      const store = createLocalStorageVisitedTopicsStore();
      store.addTopic("topic-1");

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              results: [
                {
                  topicId: "topic-1",
                  ok: true,
                  balance: 75,
                  myTotalVotes: 5,
                  myTotalCost: 25,
                  lastInteractionAt: null,
                },
              ],
            }),
          ),
      });

      render(<MyActivity />);

      await waitFor(() => {
        expect(screen.getByText("topic-1")).toBeInTheDocument();
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              topicId: "topic-1",
              pubkey: "a".repeat(64),
              items: [
                {
                  argumentId: "arg-1",
                  votes: 3,
                  cost: 9,
                  argumentPrunedAt: null,
                  updatedAt: "2025-12-19T12:00:00.000Z",
                  argumentTitle: "Test 1",
                  argumentExcerpt: "Test...",
                },
              ],
            }),
          ),
      });

      await user.click(screen.getByText("topic-1"));

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /withdraw all|全部撤回/i }),
        ).toBeInTheDocument();
      });

      // Mock: withdrawal fails then refresh stakes
      mockFetch
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: () =>
            Promise.resolve(
              JSON.stringify({
                topicId: "topic-1",
                pubkey: "a".repeat(64),
                items: [
                  {
                    argumentId: "arg-1",
                    votes: 3,
                    cost: 9,
                    argumentPrunedAt: null,
                    updatedAt: "2025-12-19T12:00:00.000Z",
                    argumentTitle: "Test 1",
                    argumentExcerpt: "Test...",
                  },
                ],
              }),
            ),
        });

      await user.click(
        screen.getByRole("button", { name: /withdraw all|全部撤回/i }),
      );

      await waitFor(
        () => {
          // Should show retry button for failed item
          expect(screen.getByRole("button", { name: /retry|重试/i })).toBeInTheDocument();
        },
        { timeout: 3000 },
      );
    });
  });

  describe("identity requirement", () => {
    it("shows identity required message when no identity exists", async () => {
      // Clear identity
      const keyStore = createLocalStorageKeyStore();
      keyStore.clear();

      render(<MyActivity />);

      await waitFor(() => {
        expect(
          screen.getByText(/identity is not initialized|set up.*identity|身份尚未初始化/i),
        ).toBeInTheDocument();
      });
    });
  });
});
