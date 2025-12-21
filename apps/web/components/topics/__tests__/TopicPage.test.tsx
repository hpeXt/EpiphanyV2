import { render, screen, waitFor } from "@testing-library/react";
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

function createFetchMock() {
  return jest.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input.toString());

    if (url.pathname === "/v1/topics/topic-1/tree") {
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
            {
              id: "arg-child",
              topicId: "topic-1",
              parentId: "arg-root",
              title: "Child",
              body: "Child body",
              authorId: "0123456789abcdef",
              analysisStatus: "pending_analysis",
              stanceScore: null,
              totalVotes: 0,
              totalCost: 0,
              prunedAt: null,
              createdAt: "2025-12-19T12:34:56.789Z",
              updatedAt: "2025-12-19T12:34:56.789Z",
            },
            {
              id: "arg-grandchild",
              topicId: "topic-1",
              parentId: "arg-child",
              title: "Grandchild",
              body: "Grandchild body",
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

    if (url.pathname === "/v1/arguments/arg-root/children") {
      const orderBy = url.searchParams.get("orderBy");
      const beforeId = url.searchParams.get("beforeId");

      if (orderBy === "createdAt_desc") {
        return jsonResponse({
          ok: true,
          status: 200,
          json: {
            parentArgumentId: "arg-root",
            items: [
              {
                id: "arg-latest-1",
                topicId: "topic-1",
                parentId: "arg-root",
                title: "Latest 1",
                body: "Latest body",
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
            nextBeforeId: null,
          },
        });
      }

      if (!beforeId) {
        return jsonResponse({
          ok: true,
          status: 200,
          json: {
            parentArgumentId: "arg-root",
            items: [
              {
                id: "arg-child-a",
                topicId: "topic-1",
                parentId: "arg-root",
                title: "Child A",
                body: "Child A body",
                authorId: "0123456789abcdef",
                analysisStatus: "pending_analysis",
                stanceScore: null,
                totalVotes: 0,
                totalCost: 0,
                prunedAt: null,
                createdAt: "2025-12-19T12:34:56.789Z",
                updatedAt: "2025-12-19T12:34:56.789Z",
              },
              {
                id: "arg-child-b",
                topicId: "topic-1",
                parentId: "arg-root",
                title: "Child B",
                body: "Child B body",
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
            nextBeforeId: "cursor-1",
          },
        });
      }

      if (beforeId === "cursor-1") {
        return jsonResponse({
          ok: true,
          status: 200,
          json: {
            parentArgumentId: "arg-root",
            items: [
              {
                id: "arg-child-b",
                topicId: "topic-1",
                parentId: "arg-root",
                title: "Child B",
                body: "Child B body",
                authorId: "0123456789abcdef",
                analysisStatus: "pending_analysis",
                stanceScore: null,
                totalVotes: 0,
                totalCost: 0,
                prunedAt: null,
                createdAt: "2025-12-19T12:34:56.789Z",
                updatedAt: "2025-12-19T12:34:56.789Z",
              },
              {
                id: "arg-child-c",
                topicId: "topic-1",
                parentId: "arg-root",
                title: "Child C",
                body: "Child C body",
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
            nextBeforeId: null,
          },
        });
      }
    }

    throw new Error(`Unhandled request: ${url.toString()}`);
  });
}

describe("TopicPage", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = "https://example.com";
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("requests tree on initial render and shows a depth=3 tree", async () => {
    const fetchMock = createFetchMock();
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<TopicPage topicId="topic-1" />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    const firstCall = fetchMock.mock.calls[0];
    const url = new URL(firstCall[0] as string);
    expect(url.pathname).toBe("/v1/topics/topic-1/tree");
    expect(url.searchParams.get("depth")).toBe("3");

    expect(await screen.findByRole("button", { name: "Root" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Child" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Grandchild" })).toBeInTheDocument();

    expect(screen.queryByText(/pruned/i)).not.toBeInTheDocument();
  });

  it("requests children when clicking a node (orderBy/limit cursor params)", async () => {
    const user = userEvent.setup();
    const fetchMock = createFetchMock();
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<TopicPage topicId="topic-1" />);

    await user.click(await screen.findByRole("button", { name: "Root" }));

    await screen.findByText("Child A");

    const childrenCall = fetchMock.mock.calls.find((call) => {
      const url = new URL(call[0] as string);
      return url.pathname === "/v1/arguments/arg-root/children";
    });

    expect(childrenCall).toBeTruthy();
    const childrenUrl = new URL(childrenCall![0] as string);
    expect(childrenUrl.searchParams.get("orderBy")).toBe("totalVotes_desc");
    expect(childrenUrl.searchParams.get("limit")).toBe("30");
    expect(childrenUrl.searchParams.get("beforeId")).toBeNull();
  });

  it("resets pagination when switching orderBy and dedupes on load more", async () => {
    const user = userEvent.setup();
    const fetchMock = createFetchMock();
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<TopicPage topicId="topic-1" />);

    await user.click(await screen.findByRole("button", { name: "Root" }));

    await screen.findByText("Child A");

    await user.click(screen.getByRole("button", { name: "加载更多" }));

    expect(await screen.findByText("Child C")).toBeInTheDocument();
    expect(screen.getAllByText("Child B")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "最新" }));

    expect(await screen.findByText("Latest 1")).toBeInTheDocument();
    expect(screen.queryByText("Child A")).not.toBeInTheDocument();

    const latestCall = fetchMock.mock.calls.findLast((call) => {
      const url = new URL(call[0] as string);
      return (
        url.pathname === "/v1/arguments/arg-root/children" &&
        url.searchParams.get("orderBy") === "createdAt_desc"
      );
    });

    expect(latestCall).toBeTruthy();
    const latestUrl = new URL(latestCall![0] as string);
    expect(latestUrl.searchParams.get("beforeId")).toBeNull();
  });
});

