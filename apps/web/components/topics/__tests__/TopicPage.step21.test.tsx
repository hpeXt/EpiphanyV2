import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { deriveTopicKeypairFromMasterSeedHex } from "@/lib/identity";

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
  topicStatus: "active" | "frozen" | "archived";
  ownerPubkey: string | null;
  childrenItems: Array<{
    id: string;
    topicId: string;
    parentId: string | null;
    title: string | null;
    body: string;
    prunedAt: string | null;
  }>;
}) {
  return jest.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input.toString());

    if (url.pathname === "/v1/topics/topic-1/ledger/me") {
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

    if (url.pathname === "/v1/topics/topic-1/tree") {
      return jsonResponse({
        ok: true,
        status: 200,
        json: {
          topic: {
            id: "topic-1",
            title: "Topic 1",
            rootArgumentId: "arg-root",
            status: options.topicStatus,
            ownerPubkey: options.ownerPubkey,
            visibility: "public",
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

    if (url.pathname === "/v1/arguments/arg-root/children") {
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
            createdAt: "2025-12-19T12:34:56.789Z",
            updatedAt: "2025-12-19T12:34:56.789Z",
          })),
          nextBeforeId: null,
        },
      });
    }

    throw new Error(`Unhandled request: ${url.toString()}`);
  });
}

describe("TopicPage (Step 21 - Host + read-only semantics)", () => {
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

  it("shows management entry for owner", async () => {
    const masterSeedHex = "00".repeat(64);
    const { pubkeyHex } = deriveTopicKeypairFromMasterSeedHex(masterSeedHex, "topic-1");

    global.fetch = createFetchMock({
      topicStatus: "active",
      ownerPubkey: pubkeyHex,
      childrenItems: [],
    }) as unknown as typeof fetch;

    render(<TopicPage topicId="topic-1" />);

    await screen.findByText("Topic 1");
    expect(screen.getByRole("button", { name: "Manage" })).toBeInTheDocument();
  });

  it("hides management entry for non-owner", async () => {
    global.fetch = createFetchMock({
      topicStatus: "active",
      ownerPubkey: null,
      childrenItems: [],
    }) as unknown as typeof fetch;

    render(<TopicPage topicId="topic-1" />);

    await screen.findByText("Topic 1");
    expect(screen.queryByRole("button", { name: "Manage" })).not.toBeInTheDocument();
  });

  it("disables createArgument and vote-increase when topic is frozen", async () => {
    const user = userEvent.setup();

    global.fetch = createFetchMock({
      topicStatus: "frozen",
      ownerPubkey: null,
      childrenItems: [
        {
          id: "arg-child",
          topicId: "topic-1",
          parentId: "arg-root",
          title: "Child",
          body: "Child body",
          prunedAt: null,
        },
      ],
    }) as unknown as typeof fetch;

    render(<TopicPage topicId="topic-1" />);

    const [rootButton] = await screen.findAllByRole("button", { name: "Root" });
    await user.click(rootButton);
    expect(await screen.findByText("Child")).toBeInTheDocument();

    const reply = screen.getByLabelText("Reply");
    expect(reply).toHaveAttribute("contenteditable", "false");

    const votesSlider = screen.getByLabelText("Votes");
    fireEvent.change(votesSlider, { target: { value: "1" } });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    });
  });
});
