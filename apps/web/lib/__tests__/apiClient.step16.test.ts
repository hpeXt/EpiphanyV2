import { createApiClient } from "@/lib/apiClient";
import type { Signer } from "@/lib/signing";

type MockJsonResponse = { ok: boolean; status: number; json: unknown };

function jsonResponse(response: MockJsonResponse) {
  return {
    ok: response.ok,
    status: response.status,
    text: async () => JSON.stringify(response.json),
  };
}

describe("apiClient signing injection (Step 16)", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = "https://example.com";
  });

  it("injects v1 signature headers for write requests", async () => {
    const signer: Signer = {
      signV1: jest.fn(async () => ({
        "X-Pubkey": "aa".repeat(32),
        "X-Signature": "bb".repeat(64),
        "X-Timestamp": "1700000000000",
        "X-Nonce": "cc".repeat(16),
      })),
    };

    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const method = (init?.method ?? "GET").toUpperCase();

      if (method === "POST" && url.pathname === "/v1/topics/topic-1/arguments") {
        return jsonResponse({
          ok: true,
          status: 200,
          json: {
            argument: {
              id: "arg-new",
              topicId: "topic-1",
              parentId: "arg-root",
              title: null,
              body: "Hello world",
              authorId: "0123456789abcdef",
              analysisStatus: "pending_analysis",
              stanceScore: null,
              totalVotes: 0,
              totalCost: 0,
              prunedAt: null,
              createdAt: "2025-12-19T12:34:56.789Z",
              updatedAt: "2025-12-19T12:34:56.789Z",
            },
            ledger: {
              topicId: "topic-1",
              pubkey: "aa".repeat(32),
              balance: 100,
              myTotalVotes: 0,
              myTotalCost: 0,
              lastInteractionAt: null,
            },
          },
        });
      }

      throw new Error(`Unhandled request: ${method} ${url.toString()}`);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = createApiClient({ signer });
    const rawBody = JSON.stringify({
      parentId: "arg-root",
      title: null,
      body: "Hello world",
      initialVotes: 0,
    });

    const result = await client.createArgument("topic-1", {
      parentId: "arg-root",
      title: null,
      body: "Hello world",
      initialVotes: 0,
    });

    expect(result.ok).toBe(true);
    expect(signer.signV1).toHaveBeenCalledWith("topic-1", {
      method: "POST",
      path: "/v1/topics/topic-1/arguments",
      rawBody,
    });

    const call = fetchMock.mock.calls[0]!;
    const headers = call[1]?.headers as Record<string, string>;

    expect(headers["X-Pubkey"]).toBe("aa".repeat(32));
    expect(headers["X-Signature"]).toBe("bb".repeat(64));
    expect(headers["X-Timestamp"]).toBe("1700000000000");
    expect(headers["X-Nonce"]).toBe("cc".repeat(16));
  });

  it("injects v1 signature headers for private reads", async () => {
    const signer: Signer = {
      signV1: jest.fn(async () => ({
        "X-Pubkey": "aa".repeat(32),
        "X-Signature": "bb".repeat(64),
        "X-Timestamp": "1700000000000",
        "X-Nonce": "cc".repeat(16),
      })),
    };

    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const method = (init?.method ?? "GET").toUpperCase();

      if (method === "GET" && url.pathname === "/v1/topics/topic-1/ledger/me") {
        return jsonResponse({
          ok: true,
          status: 200,
          json: {
            topicId: "topic-1",
            pubkey: "aa".repeat(32),
            balance: 100,
            myTotalVotes: 0,
            myTotalCost: 0,
            lastInteractionAt: null,
          },
        });
      }

      throw new Error(`Unhandled request: ${method} ${url.toString()}`);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = createApiClient({ signer });
    const result = await client.getLedgerMe("topic-1");

    expect(result.ok).toBe(true);
    expect(signer.signV1).toHaveBeenCalledWith("topic-1", {
      method: "GET",
      path: "/v1/topics/topic-1/ledger/me",
      rawBody: null,
    });

    const call = fetchMock.mock.calls[0]!;
    const headers = call[1]?.headers as Record<string, string>;
    expect(headers["X-Pubkey"]).toBe("aa".repeat(32));
  });

  it("does not sign createTopic (no topicId yet)", async () => {
    const signer: Signer = { signV1: jest.fn() };

    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const method = (init?.method ?? "GET").toUpperCase();

      if (method === "POST" && url.pathname === "/v1/topics") {
        return jsonResponse({
          ok: true,
          status: 200,
          json: {
            topicId: "topic-1",
            rootArgumentId: "arg-root",
            claimToken: "claim-token",
            expiresAt: "2025-12-19T12:34:56.789Z",
          },
        });
      }

      throw new Error(`Unhandled request: ${method} ${url.toString()}`);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = createApiClient({ signer });
    const result = await client.createTopic({ title: "T", body: "B" });

    expect(result.ok).toBe(true);
    expect(signer.signV1).not.toHaveBeenCalled();

    const call = fetchMock.mock.calls[0]!;
    const headers = call[1]?.headers as Record<string, string>;
    expect(headers["X-Pubkey"]).toBeUndefined();
    expect(headers["X-Signature"]).toBeUndefined();
  });
});

