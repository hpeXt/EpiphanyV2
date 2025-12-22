import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { TopicPage } = require("@/components/topics/TopicPage");

type MockJsonResponse = { ok: boolean; status: number; json: unknown };

function jsonResponse(response: MockJsonResponse) {
  return {
    ok: response.ok,
    status: response.status,
    text: async () => JSON.stringify(response.json),
  };
}

function createFetchMock(options: {
  childrenItems: Array<{
    id: string;
    topicId: string;
    parentId: string | null;
    title: string | null;
    body: string;
  }>;
  createArgument?: MockJsonResponse | ((body: any, callIndex: number) => MockJsonResponse);
}) {
  let createArgumentCalls = 0;

  return jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const method = (init?.method ?? "GET").toUpperCase();

    if (method === "GET" && url.pathname === "/v1/topics/topic-1/ledger/me") {
      return jsonResponse({
        ok: true,
        status: 200,
        json: {
          topicId: "topic-1",
          pubkey: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          balance: 100,
          myTotalVotes: 0,
          myTotalCost: 0,
          lastInteractionAt: null,
        },
      });
    }

    if (method === "GET" && url.pathname === "/v1/topics/topic-1/tree") {
      return jsonResponse({
        ok: true,
        status: 200,
        json: {
          topic: {
            id: "topic-1",
            title: "Topic 1",
            rootArgumentId: "arg-root",
            status: "active",
            ownerPubkey: null,
            createdAt: "2025-12-19T12:34:56.789Z",
            updatedAt: "2025-12-19T12:34:56.789Z",
          },
          depth: 3,
          arguments: [
            {
              id: "arg-root",
              topicId: "topic-1",
              parentId: null,
              title: "Root",
              body: "Root body",
              authorId: "0123456789abcdef",
              analysisStatus: "pending_analysis",
              stanceScore: null,
              totalVotes: 0,
              totalCost: 0,
              prunedAt: null,
              createdAt: "2025-12-19T12:34:56.789Z",
              updatedAt: "2025-12-19T12:34:56.789Z",
            },
          ],
        },
      });
    }

    if (method === "GET" && url.pathname === "/v1/arguments/arg-root/children") {
      return jsonResponse({
        ok: true,
        status: 200,
        json: {
          parentArgumentId: "arg-root",
          items: options.childrenItems.map((item) => ({
            ...item,
            authorId: "0123456789abcdef",
            analysisStatus: "pending_analysis",
            stanceScore: null,
            totalVotes: 0,
            totalCost: 0,
            prunedAt: null,
            createdAt: "2025-12-19T12:34:56.789Z",
            updatedAt: "2025-12-19T12:34:56.789Z",
          })),
          nextBeforeId: null,
        },
      });
    }

    if (method === "POST" && url.pathname === "/v1/topics/topic-1/arguments") {
      const rawBody = typeof init?.body === "string" ? init.body : "";
      const parsedBody = rawBody ? JSON.parse(rawBody) : null;
      const handler = options.createArgument;
      const response =
        typeof handler === "function"
          ? handler(parsedBody, createArgumentCalls)
          : (handler ?? { ok: true, status: 200, json: {} });

      createArgumentCalls += 1;
      return jsonResponse(response);
    }

    throw new Error(`Unhandled request: ${method} ${url.toString()}`);
  });
}

describe("TopicPage (Step 15)", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = "https://example.com";
    window.localStorage.clear();
    window.localStorage.setItem("tm:master-seed:v1", "00".repeat(64));
    (globalThis.EventSource as any)?.reset?.();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("posts a reply and updates the UI", async () => {
    const user = userEvent.setup();

    const fetchMock = createFetchMock({
      childrenItems: [],
      createArgument: (body) => {
        expect(body.body).toBe("Hello world");
        expect(body.bodyRich?.type).toBe("doc");
        expect(JSON.stringify(body.bodyRich)).toContain("Hello world");

        return {
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
              pubkey: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
              balance: 100,
              myTotalVotes: 0,
              myTotalCost: 0,
              lastInteractionAt: null,
            },
          },
        };
      },
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<TopicPage topicId="topic-1" />);

    await user.click(await screen.findByRole("button", { name: "Root" }));
    expect(await screen.findByText("No replies yet.")).toBeInTheDocument();

    await user.type(await screen.findByLabelText("Reply"), "Hello world");
    await user.click(screen.getByRole("button", { name: "Post" }));

    expect(await screen.findByText("Hello world")).toBeInTheDocument();
  });

  it("shows an insufficient balance error (402) when posting", async () => {
    const user = userEvent.setup();

    const fetchMock = createFetchMock({
      childrenItems: [],
      createArgument: {
        ok: false,
        status: 402,
        json: {
          error: {
            code: "INSUFFICIENT_BALANCE",
            message: "余额不足",
            details: {},
          },
        },
      },
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<TopicPage topicId="topic-1" />);

    await user.click(await screen.findByRole("button", { name: "Root" }));
    expect(await screen.findByText("No replies yet.")).toBeInTheDocument();

    await user.type(await screen.findByLabelText("Reply"), "Hello world");
    await user.click(screen.getByRole("button", { name: "Post" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("余额不足");
    expect(screen.queryByText("Hello world")).not.toBeInTheDocument();
  });

  it("shows QV cost/delta when changing votes", async () => {
    const user = userEvent.setup();

    const fetchMock = createFetchMock({
      childrenItems: [
        {
          id: "arg-child-a",
          topicId: "topic-1",
          parentId: "arg-root",
          title: "Child A",
          body: "Child A body",
        },
      ],
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<TopicPage topicId="topic-1" />);

    await user.click(await screen.findByRole("button", { name: "Root" }));
    await screen.findByText("Child A");

    const slider = screen.getByRole("slider", { name: /votes/i });
    fireEvent.change(slider, { target: { value: "3" } });

    expect(screen.getByText(/Cost: 9/)).toBeInTheDocument();
    expect(screen.getByText(/ΔCost: \+9/)).toBeInTheDocument();
  });

  it("debounces refresh after receiving SSE invalidation", async () => {
    jest.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    const fetchMock = createFetchMock({
      childrenItems: [
        {
          id: "arg-child-a",
          topicId: "topic-1",
          parentId: "arg-root",
          title: "Child A",
          body: "Child A body",
        },
      ],
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<TopicPage topicId="topic-1" />);

    await user.click(await screen.findByRole("button", { name: "Root" }));
    await screen.findByText("Child A");

    const treeCalls = () =>
      fetchMock.mock.calls.filter((call) => {
        const url = new URL(call[0] as string);
        return url.pathname === "/v1/topics/topic-1/tree";
      }).length;

    const childrenCalls = () =>
      fetchMock.mock.calls.filter((call) => {
        const url = new URL(call[0] as string);
        return url.pathname === "/v1/arguments/arg-root/children";
      }).length;

    expect(treeCalls()).toBe(1);
    expect(childrenCalls()).toBe(1);

    const es = (globalThis.EventSource as any).instances[0];
    es.emitMessage(
      JSON.stringify({
        event: "argument_updated",
        data: { argumentId: "arg-child-a", reason: "new_vote" },
      }),
    );

    await act(async () => {
      jest.advanceTimersByTime(2999);
    });
    expect(treeCalls()).toBe(1);
    expect(childrenCalls()).toBe(1);

    await act(async () => {
      jest.advanceTimersByTime(1);
    });

    await waitFor(() => {
      expect(treeCalls()).toBe(2);
      expect(childrenCalls()).toBe(2);
    });
  });

  it("shows a friendly message on INVALID_SIGNATURE (401)", async () => {
    const user = userEvent.setup();

    const fetchMock = createFetchMock({
      childrenItems: [],
      createArgument: {
        ok: false,
        status: 401,
        json: {
          error: {
            code: "INVALID_SIGNATURE",
            message: "签名验证失败",
            details: {},
          },
        },
      },
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<TopicPage topicId="topic-1" />);

    await user.click(await screen.findByRole("button", { name: "Root" }));
    await user.type(await screen.findByLabelText("Reply"), "Hello world");
    await user.click(screen.getByRole("button", { name: "Post" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("签名验证失败");
  });

  it("injects v1 signature headers with stable pubkey and unique nonce", async () => {
    const user = userEvent.setup();

    const fetchMock = createFetchMock({
      childrenItems: [],
      createArgument: (_body, callIndex) => ({
        ok: true,
        status: 200,
        json: {
          argument: {
            id: `arg-new-${callIndex}`,
            topicId: "topic-1",
            parentId: "arg-root",
            title: null,
            body: `Hello ${callIndex}`,
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
            pubkey: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            balance: 100,
            myTotalVotes: 0,
            myTotalCost: 0,
            lastInteractionAt: null,
          },
        },
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<TopicPage topicId="topic-1" />);

    await user.click(await screen.findByRole("button", { name: "Root" }));

    await user.type(await screen.findByLabelText("Reply"), "Hello 0");
    await user.click(screen.getByRole("button", { name: "Post" }));

    await user.type(await screen.findByLabelText("Reply"), "Hello 1");
    await user.click(screen.getByRole("button", { name: "Post" }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.filter((call) => {
          const url = new URL(call[0] as string);
          const init = call[1] as RequestInit | undefined;
          return url.pathname === "/v1/topics/topic-1/arguments" && init?.method === "POST";
        }),
      ).toHaveLength(2);
    });

    const postCalls = fetchMock.mock.calls.filter((call) => {
      const url = new URL(call[0] as string);
      const init = call[1] as RequestInit | undefined;
      return url.pathname === "/v1/topics/topic-1/arguments" && init?.method === "POST";
    });

    const headers1 = postCalls[0][1]?.headers as any;
    const headers2 = postCalls[1][1]?.headers as any;

    expect(headers1["X-Pubkey"]).toMatch(/^[0-9a-f]{64}$/);
    expect(headers1["X-Signature"]).toMatch(/^[0-9a-f]{128}$/);
    expect(headers1["X-Timestamp"]).toMatch(/^[0-9]+$/);
    expect(headers1["X-Nonce"]).toMatch(/^[0-9a-f]+$/);

    expect(headers2["X-Pubkey"]).toBe(headers1["X-Pubkey"]);
    expect(headers2["X-Nonce"]).not.toBe(headers1["X-Nonce"]);
  });
});
