import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { deriveTopicKeypairFromMasterSeedHex } from "@/lib/identity";

const mockPush = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

const { TopicPage } = require("@/components/topics/TopicPage");

type MockJsonResponse = { ok: boolean; status: number; json: unknown };

function jsonResponse(response: MockJsonResponse) {
  return {
    ok: response.ok,
    status: response.status,
    text: async () => JSON.stringify(response.json),
  };
}

type ConsensusReportLatest =
  | { report: null }
  | {
      report: {
        id: string;
        topicId: string;
        status: "generating";
        contentMd: null;
        model: string | null;
        promptVersion: string | null;
        params: Record<string, unknown> | null;
        metadata: Record<string, unknown> | null;
        computedAt: null;
        createdAt: string;
      };
    }
  | {
      report: {
        id: string;
        topicId: string;
        status: "ready";
        contentMd: string;
        model: string | null;
        promptVersion: string | null;
        params: Record<string, unknown> | null;
        metadata: Record<string, unknown> | null;
        computedAt: string;
        createdAt: string;
      };
    }
  | {
      report: {
        id: string;
        topicId: string;
        status: "failed";
        contentMd: null;
        model: string | null;
        promptVersion: string | null;
        params: Record<string, unknown> | null;
        metadata: Record<string, unknown> | null;
        computedAt: string;
        createdAt: string;
      };
    };

function createFetchMock(options: {
  topicStatus: "active" | "frozen" | "archived";
  ownerPubkey: string | null;
  latestReport: ConsensusReportLatest;
  onCommand?: (body: any) => void;
}) {
  return jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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

    if (url.pathname === "/v1/topics/topic-1/consensus-report/latest") {
      return jsonResponse({ ok: true, status: 200, json: options.latestReport });
    }

    if (url.pathname === "/v1/topics/topic-1/commands") {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      options.onCommand?.(body);
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
        },
      });
    }

    throw new Error(`Unhandled request: ${url.toString()}`);
  });
}

describe("TopicPage (Step 22 - Consensus Report)", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = "https://example.com";
    mockPush.mockReset();
    window.localStorage.clear();
    window.localStorage.setItem("tm:master-seed:v1", "00".repeat(64));
    (globalThis.EventSource as any)?.reset?.();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("opens modal and renders markdown when latest report is ready", async () => {
    global.fetch = createFetchMock({
      topicStatus: "active",
      ownerPubkey: null,
      latestReport: {
        report: {
          id: "report-1",
          topicId: "topic-1",
          status: "ready",
          contentMd: "# Consensus Report\n\n- one",
          model: "mock-report-model",
          promptVersion: "v1",
          params: { maxArguments: 30 },
          metadata: null,
          computedAt: "2025-12-19T12:35:56.789Z",
          createdAt: "2025-12-19T12:34:56.789Z",
        },
      },
    }) as unknown as typeof fetch;

    const user = userEvent.setup();

    render(<TopicPage topicId="topic-1" />);

    await screen.findByText("Topic 1");
    await user.click(screen.getByRole("button", { name: /Report|报告/i }));

    expect(
      await screen.findByRole("heading", {
        level: 2,
        name: /Consensus report|共识报告/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("one")).toBeInTheDocument();
  });

  it("renders [S#] citations as footnotes when source mapping exists", async () => {
    global.fetch = createFetchMock({
      topicStatus: "active",
      ownerPubkey: null,
      latestReport: {
        report: {
          id: "report-1",
          topicId: "topic-1",
          status: "ready",
          contentMd: "# Consensus Report\n\nA claim. [S1]\n\n- bullet. [S2]",
          model: "mock-report-model",
          promptVersion: "v2",
          params: { maxArguments: 30 },
          metadata: {
            sources: {
              S1: { argumentId: "arg-a", authorId: "0123456789abcdef" },
              S2: { argumentId: "arg-b", authorId: "fedcba9876543210" },
            },
          },
          computedAt: "2025-12-19T12:35:56.789Z",
          createdAt: "2025-12-19T12:34:56.789Z",
        },
      },
    }) as unknown as typeof fetch;

    const user = userEvent.setup();

    render(<TopicPage topicId="topic-1" />);

    await screen.findByText("Topic 1");
    await user.click(screen.getByRole("button", { name: /Report|报告/i }));

    expect(await screen.findByRole("heading", { name: /Footnotes|脚注/i })).toBeInTheDocument();
    expect(screen.getByText("S1")).toBeInTheDocument();
    expect(screen.getByText("S2")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Open|打开/i })).toHaveLength(2);
  });

  it("shows generating state when latest report is generating", async () => {
    global.fetch = createFetchMock({
      topicStatus: "active",
      ownerPubkey: null,
      latestReport: {
        report: {
          id: "report-1",
          topicId: "topic-1",
          status: "generating",
          contentMd: null,
          model: null,
          promptVersion: "v1",
          params: { maxArguments: 30 },
          metadata: null,
          computedAt: null,
          createdAt: "2025-12-19T12:34:56.789Z",
        },
      },
    }) as unknown as typeof fetch;

    const user = userEvent.setup();
    render(<TopicPage topicId="topic-1" />);

    await screen.findByText("Topic 1");
    await user.click(screen.getByRole("button", { name: /Report|报告/i }));

    expect(await screen.findByText(/Generating report…|正在生成报告…/i)).toBeInTheDocument();
  });

  it("shows failed state when latest report is failed", async () => {
    global.fetch = createFetchMock({
      topicStatus: "active",
      ownerPubkey: null,
      latestReport: {
        report: {
          id: "report-1",
          topicId: "topic-1",
          status: "failed",
          contentMd: null,
          model: "mock-report-model",
          promptVersion: "v1",
          params: { maxArguments: 30 },
          metadata: { error: { message: "Provider failed" } },
          computedAt: "2025-12-19T12:35:56.789Z",
          createdAt: "2025-12-19T12:34:56.789Z",
        },
      },
    }) as unknown as typeof fetch;

    const user = userEvent.setup();
    render(<TopicPage topicId="topic-1" />);

    await screen.findByText("Topic 1");
    await user.click(screen.getByRole("button", { name: /Report|报告/i }));

    expect(await screen.findByText(/Report failed|报告生成失败/i)).toBeInTheDocument();
    expect(screen.getByText("Provider failed")).toBeInTheDocument();
  });

  it("allows owner to trigger generation when there is no report yet", async () => {
    const masterSeedHex = "00".repeat(64);
    const { pubkeyHex } = deriveTopicKeypairFromMasterSeedHex(masterSeedHex, "topic-1");

    let latestReport: ConsensusReportLatest = { report: null };
    const onCommand = (body: any) => {
      if (body?.type === "GENERATE_CONSENSUS_REPORT") {
        latestReport = {
          report: {
            id: "report-1",
            topicId: "topic-1",
            status: "generating",
            contentMd: null,
            model: null,
            promptVersion: "v1",
            params: { maxArguments: 30 },
            metadata: null,
            computedAt: null,
            createdAt: "2025-12-19T12:34:56.789Z",
          },
        };
      }
    };

    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (url.pathname === "/v1/topics/topic-1/consensus-report/latest") {
        return jsonResponse({ ok: true, status: 200, json: latestReport });
      }
      return (createFetchMock({
        topicStatus: "active",
        ownerPubkey: pubkeyHex,
        latestReport,
        onCommand,
      }) as any)(input, init);
    }) as unknown as typeof fetch;

    const user = userEvent.setup();
    render(<TopicPage topicId="topic-1" />);

    await screen.findByText("Topic 1");
    await user.click(screen.getByRole("button", { name: /Report|报告/i }));

    const button = await screen.findByRole("button", { name: /Generate report|生成报告/i });
    await user.click(button);

    expect(await screen.findByText(/Generating report…|正在生成报告…/i)).toBeInTheDocument();
  });
});
