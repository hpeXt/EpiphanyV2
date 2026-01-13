import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { createTranslator, defaultLocale } from "@/lib/i18n";

const t = createTranslator(defaultLocale);

const mockReplace = jest.fn();
const mockPush = jest.fn();
const mockSearchParams = new URLSearchParams();

jest.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams,
  useRouter: () => ({
    replace: mockReplace,
    push: mockPush,
  }),
  usePathname: () => "/topics/mock",
}));

jest.mock("@/components/topics/hooks/useTopicSse", () => ({
  useTopicSse: () => {},
}));

jest.mock("@/components/topics/hooks/useTopicTree", () => ({
  useTopicTree: jest.fn(),
}));

jest.mock("@/components/topics/ConsensusReportModal", () => ({
  ConsensusReportModal: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" aria-label="Consensus report">
      <p>Report modal</p>
      <button type="button" onClick={onClose}>
        Close report
      </button>
    </div>
  ),
}));

jest.mock("@/components/visualizations/Sunburst", () => ({
  Sunburst: (props: {
    onSelectedIdChange?: (id: string | null) => void;
    onHoverChange?: (value: { id: string; pointer: { x: number; y: number } } | null) => void;
  }) => (
    <div>
      <button
        type="button"
        onMouseEnter={() => props.onHoverChange?.({ id: "arg-1", pointer: { x: 120, y: 90 } })}
        onMouseLeave={() => props.onHoverChange?.(null)}
      >
        Hover arg-1
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          props.onSelectedIdChange?.("arg-1");
        }}
      >
        Select arg-1
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          props.onSelectedIdChange?.(null);
        }}
      >
        Blank
      </button>
    </div>
  ),
}));

type MockJsonResponse = { ok: boolean; status: number; json: unknown };

function jsonResponse(response: MockJsonResponse) {
  return {
    ok: response.ok,
    status: response.status,
    text: async () => JSON.stringify(response.json),
  };
}

const TOPIC_ID = "0193e3a6-0b7d-7a8d-9f2c-2f3aa3ad1a11";
const MASTER_SEED_HEX =
  "c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e53495531f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04";
const MY_PUBKEY_HEX = "af2962c0ae4ef74ad7ae9169b53a8542850813dfa367878e72a601c4d5816c09";
const MY_AUTHOR_ID = "f3177ff017b5af29";

function mockTopicTree() {
  return {
    status: "success" as const,
    errorMessage: "",
    topic: {
      id: TOPIC_ID,
      title: "Topic 1",
      rootArgumentId: "arg-root",
      status: "active" as const,
      ownerPubkey: null,
      visibility: "public" as const,
      rootBody: "Root body",
    },
    nodes: [
      { id: "arg-root", parentId: null, label: "Root" },
      { id: "arg-1", parentId: "arg-root", label: "My Argument" },
    ],
    arguments: [
      {
        id: "arg-root",
        topicId: TOPIC_ID,
        parentId: null,
        title: "Root",
        body: "Root body",
        authorId: "66687aadf862bd77",
        analysisStatus: "ready",
        stanceScore: null,
        totalVotes: 0,
        totalCost: 0,
        prunedAt: null,
        createdAt: "2025-12-19T12:34:56.789Z",
        updatedAt: "2025-12-19T12:34:56.789Z",
      },
      {
        id: "arg-1",
        topicId: TOPIC_ID,
        parentId: "arg-root",
        title: "My Argument",
        body: "My body",
        authorId: MY_AUTHOR_ID,
        analysisStatus: "ready",
        stanceScore: null,
        totalVotes: 3,
        totalCost: 9,
        prunedAt: null,
        createdAt: "2025-12-19T13:00:00.000Z",
        updatedAt: "2025-12-19T13:00:00.000Z",
      },
    ],
  };
}

describe("TopicStage interactions", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = "https://example.com";
    window.localStorage.clear();
    window.localStorage.setItem("tm:master-seed:v1", MASTER_SEED_HEX);

    const { useTopicTree } = require("@/components/topics/hooks/useTopicTree");
    (useTopicTree as jest.Mock).mockReturnValue(mockTopicTree());
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("shows hover card and supports blank fallback", async () => {
    const { TopicStage } = require("@/components/topics/TopicStage");

    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === "string" ? input : input.toString());

      if (url.pathname === `/v1/topics/${TOPIC_ID}/ledger/me`) {
        return jsonResponse({
          ok: true,
          status: 200,
          json: {
            topicId: TOPIC_ID,
            pubkey: MY_PUBKEY_HEX,
            balance: 100,
            myTotalVotes: 0,
            myTotalCost: 0,
            lastInteractionAt: null,
          },
        });
      }

      if (url.pathname === `/v1/topics/${TOPIC_ID}/stakes/me`) {
        return jsonResponse({
          ok: true,
          status: 200,
          json: {
            topicId: TOPIC_ID,
            pubkey: MY_PUBKEY_HEX,
            items: [],
          },
        });
      }

      if (url.pathname === "/v1/arguments/arg-1") {
        return jsonResponse({
          ok: true,
          status: 200,
          json: {
            argument: {
              id: "arg-1",
              topicId: TOPIC_ID,
              parentId: "arg-root",
              title: "My Argument",
              body: "My body",
              bodyRich: null,
              authorId: MY_AUTHOR_ID,
              analysisStatus: "ready",
              stanceScore: null,
              totalVotes: 3,
              totalCost: 9,
              prunedAt: null,
              createdAt: "2025-12-19T13:00:00.000Z",
              updatedAt: "2025-12-19T13:00:00.000Z",
            },
          },
        });
      }

      if (url.pathname === "/v1/arguments/arg-root") {
        return jsonResponse({
          ok: true,
          status: 200,
          json: {
            argument: {
              id: "arg-root",
              topicId: TOPIC_ID,
              parentId: null,
              title: "Root",
              body: "Root body",
              bodyRich: null,
              authorId: "66687aadf862bd77",
              analysisStatus: "ready",
              stanceScore: null,
              totalVotes: 0,
              totalCost: 0,
              prunedAt: null,
              createdAt: "2025-12-19T12:34:56.789Z",
              updatedAt: "2025-12-19T12:34:56.789Z",
            },
          },
        });
      }

      throw new Error(`Unhandled request: ${url.toString()}`);
    }) as unknown as typeof fetch;

    const user = userEvent.setup();
    render(<TopicStage topicId={TOPIC_ID} />);

    await screen.findByRole("heading", { name: "Topic 1", level: 2 });

    const hoverButton = screen.getByRole("button", { name: "Hover arg-1" });
    await user.hover(hoverButton);
    expect(await screen.findByTestId("sunburst-hover-card")).toBeInTheDocument();
    await user.unhover(hoverButton);

    await user.click(screen.getByRole("button", { name: "Select arg-1" }));
    expect(await screen.findByRole("heading", { name: "My Argument" })).toBeInTheDocument();

    await user.hover(hoverButton);
    expect(await screen.findByTestId("sunburst-hover-card")).toBeInTheDocument();
    await user.unhover(hoverButton);

    await user.click(screen.getByRole("button", { name: "Blank" }));
    expect(await screen.findByRole("heading", { name: "Root" })).toBeInTheDocument();
  });

  it("can quote selected text into the reply editor", async () => {
    const { TopicStage } = require("@/components/topics/TopicStage");

    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === "string" ? input : input.toString());

      if (url.pathname === `/v1/topics/${TOPIC_ID}/ledger/me`) {
        return jsonResponse({
          ok: true,
          status: 200,
          json: {
            topicId: TOPIC_ID,
            pubkey: MY_PUBKEY_HEX,
            balance: 100,
            myTotalVotes: 0,
            myTotalCost: 0,
            lastInteractionAt: null,
          },
        });
      }

      if (url.pathname === `/v1/topics/${TOPIC_ID}/stakes/me`) {
        return jsonResponse({
          ok: true,
          status: 200,
          json: {
            topicId: TOPIC_ID,
            pubkey: MY_PUBKEY_HEX,
            items: [],
          },
        });
      }

      if (url.pathname === "/v1/arguments/arg-1") {
        return jsonResponse({
          ok: true,
          status: 200,
          json: {
            argument: {
              id: "arg-1",
              topicId: TOPIC_ID,
              parentId: "arg-root",
              title: "My Argument",
              body: "My body",
              bodyRich: null,
              authorId: MY_AUTHOR_ID,
              analysisStatus: "ready",
              stanceScore: null,
              totalVotes: 3,
              totalCost: 9,
              prunedAt: null,
              createdAt: "2025-12-19T13:00:00.000Z",
              updatedAt: "2025-12-19T13:00:00.000Z",
            },
          },
        });
      }

      if (url.pathname === "/v1/arguments/arg-root") {
        return jsonResponse({
          ok: true,
          status: 200,
          json: {
            argument: {
              id: "arg-root",
              topicId: TOPIC_ID,
              parentId: null,
              title: "Root",
              body: "Root body",
              bodyRich: null,
              authorId: "66687aadf862bd77",
              analysisStatus: "ready",
              stanceScore: null,
              totalVotes: 0,
              totalCost: 0,
              prunedAt: null,
              createdAt: "2025-12-19T12:34:56.789Z",
              updatedAt: "2025-12-19T12:34:56.789Z",
            },
          },
        });
      }

      throw new Error(`Unhandled request: ${url.toString()}`);
    }) as unknown as typeof fetch;

    const user = userEvent.setup();
    render(<TopicStage topicId={TOPIC_ID} />);

    await screen.findByRole("heading", { name: "Topic 1", level: 2 });
    await user.click(screen.getByRole("button", { name: "Select arg-1" }));
    await screen.findByRole("heading", { name: "My Argument" });

    const readerParagraph = await screen.findByText("My body");

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(readerParagraph);
    (range as any).getBoundingClientRect = () => ({
      width: 12,
      height: 12,
      top: 100,
      left: 100,
      right: 112,
      bottom: 112,
      x: 100,
      y: 100,
      toJSON: () => ({}),
    });

    selection?.removeAllRanges();
    selection?.addRange(range);
    fireEvent(document, new Event("selectionchange"));

    const quoteButton = await screen.findByTestId("selection-quote-button");
    await user.click(quoteButton);

    const reply = screen.getByLabelText(t("dialogue.replyLabel"));
    expect(reply).toHaveTextContent("My body");
  });

  it("does not auto-expand the layout when crossing the divider", async () => {
    const { TopicStage } = require("@/components/topics/TopicStage");

    // JSDOM doesn't implement PointerEvent; React only wires `onPointerMove*` when it's available.
    if (!(window as any).PointerEvent) {
      (window as any).PointerEvent = MouseEvent as any;
    }

    jest.useFakeTimers();

    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === "string" ? input : input.toString());

      if (url.pathname === `/v1/topics/${TOPIC_ID}/ledger/me`) {
        return jsonResponse({
          ok: true,
          status: 200,
          json: {
            topicId: TOPIC_ID,
            pubkey: MY_PUBKEY_HEX,
            balance: 100,
            myTotalVotes: 0,
            myTotalCost: 0,
            lastInteractionAt: null,
          },
        });
      }

      if (url.pathname === `/v1/topics/${TOPIC_ID}/stakes/me`) {
        return jsonResponse({
          ok: true,
          status: 200,
          json: {
            topicId: TOPIC_ID,
            pubkey: MY_PUBKEY_HEX,
            items: [],
          },
        });
      }

      if (url.pathname === "/v1/arguments/arg-root") {
        return jsonResponse({
          ok: true,
          status: 200,
          json: {
            argument: {
              id: "arg-root",
              topicId: TOPIC_ID,
              parentId: null,
              title: "Root",
              body: "Root body",
              bodyRich: null,
              authorId: "66687aadf862bd77",
              analysisStatus: "ready",
              stanceScore: null,
              totalVotes: 0,
              totalCost: 0,
              prunedAt: null,
              createdAt: "2025-12-19T12:34:56.789Z",
              updatedAt: "2025-12-19T12:34:56.789Z",
            },
          },
        });
      }

      throw new Error(`Unhandled request: ${url.toString()}`);
    }) as unknown as typeof fetch;

    render(<TopicStage topicId={TOPIC_ID} />);

    const topicHeading = screen.getByRole("heading", { name: "Topic 1" });

    const findAncestor = (node: HTMLElement, includes: string) => {
      let current: HTMLElement | null = node;
      while (current) {
        if (typeof current.className === "string" && current.className.includes(includes)) return current;
        current = current.parentElement;
      }
      return null;
    };

    const leftColumn = findAncestor(topicHeading, "md:border-r");
    if (!leftColumn) {
      throw new Error("Failed to locate left column container.");
    }

    // Simulate the divider at clientX=200.
    (leftColumn as any).getBoundingClientRect = () => ({ right: 200 });

    expect(leftColumn.className).toContain("md:w-[420px]");

    fireEvent.pointerMove(leftColumn, { clientX: 100 });
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(leftColumn.className).toContain("md:w-[420px]");

    fireEvent.pointerMove(leftColumn, { clientX: 300 });

    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(leftColumn.className).toContain("md:w-[420px]");
  });

  it("does not auto-expand the layout in read mode", async () => {
    const { TopicStage } = require("@/components/topics/TopicStage");

    // JSDOM doesn't implement PointerEvent; React only wires `onPointerMove*` when it's available.
    if (!(window as any).PointerEvent) {
      (window as any).PointerEvent = MouseEvent as any;
    }

    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === "string" ? input : input.toString());

      if (url.pathname === `/v1/topics/${TOPIC_ID}/ledger/me`) {
        return jsonResponse({
          ok: true,
          status: 200,
          json: {
            topicId: TOPIC_ID,
            pubkey: MY_PUBKEY_HEX,
            balance: 100,
            myTotalVotes: 0,
            myTotalCost: 0,
            lastInteractionAt: null,
          },
        });
      }

      if (url.pathname === `/v1/topics/${TOPIC_ID}/stakes/me`) {
        return jsonResponse({
          ok: true,
          status: 200,
          json: {
            topicId: TOPIC_ID,
            pubkey: MY_PUBKEY_HEX,
            items: [],
          },
        });
      }

      if (url.pathname === "/v1/arguments/arg-root") {
        return jsonResponse({
          ok: true,
          status: 200,
          json: {
            argument: {
              id: "arg-root",
              topicId: TOPIC_ID,
              parentId: null,
              title: "Root",
              body: "Root body",
              bodyRich: null,
              authorId: "66687aadf862bd77",
              analysisStatus: "ready",
              stanceScore: null,
              totalVotes: 0,
              totalCost: 0,
              prunedAt: null,
              createdAt: "2025-12-19T12:34:56.789Z",
              updatedAt: "2025-12-19T12:34:56.789Z",
            },
          },
        });
      }

      if (url.pathname === "/v1/arguments/arg-1") {
        return jsonResponse({
          ok: true,
          status: 200,
          json: {
            argument: {
              id: "arg-1",
              topicId: TOPIC_ID,
              parentId: "arg-root",
              title: "My Argument",
              body: "My body",
              bodyRich: null,
              authorId: MY_AUTHOR_ID,
              analysisStatus: "ready",
              stanceScore: null,
              totalVotes: 3,
              totalCost: 9,
              prunedAt: null,
              createdAt: "2025-12-19T13:00:00.000Z",
              updatedAt: "2025-12-19T13:00:00.000Z",
            },
          },
        });
      }

      throw new Error(`Unhandled request: ${url.toString()}`);
    }) as unknown as typeof fetch;

    render(<TopicStage topicId={TOPIC_ID} />);

    const topicHeading = await screen.findByRole("heading", { name: "Topic 1" });

    const findAncestor = (node: HTMLElement, includes: string) => {
      let current: HTMLElement | null = node;
      while (current) {
        if (typeof current.className === "string" && current.className.includes(includes)) return current;
        current = current.parentElement;
      }
      return null;
    };

    const leftColumn = findAncestor(topicHeading, "md:border-r");
    if (!leftColumn) {
      throw new Error("Failed to locate left column container.");
    }

    // Simulate the divider at clientX=200.
    (leftColumn as any).getBoundingClientRect = () => ({ right: 200 });

    fireEvent.click(screen.getByRole("button", { name: "Select arg-1" }));
    await screen.findByRole("heading", { name: "My Argument" });

    expect(leftColumn.className).toContain("md:w-[360px]");

    jest.useFakeTimers();
    fireEvent.pointerMove(leftColumn, { clientX: 100 });
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(leftColumn.className).toContain("md:w-[360px]");

    fireEvent.pointerMove(leftColumn, { clientX: 300 });
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(leftColumn.className).toContain("md:w-[360px]");
  });

  it("can create argument, vote, open report, and edit own comment", async () => {
    const { TopicStage } = require("@/components/topics/TopicStage");

    let lastCreateArgumentBody: unknown = null;
    let lastSetVotesBody: unknown = null;
    let lastEditArgumentBody: unknown = null;

    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());

      if (url.pathname === `/v1/topics/${TOPIC_ID}/ledger/me`) {
        return jsonResponse({
          ok: true,
          status: 200,
          json: {
            topicId: TOPIC_ID,
            pubkey: MY_PUBKEY_HEX,
            balance: 100,
            myTotalVotes: 0,
            myTotalCost: 0,
            lastInteractionAt: null,
          },
        });
      }

      if (url.pathname === `/v1/topics/${TOPIC_ID}/stakes/me`) {
        return jsonResponse({
          ok: true,
          status: 200,
          json: {
            topicId: TOPIC_ID,
            pubkey: MY_PUBKEY_HEX,
            items: [],
          },
        });
      }

      if (url.pathname === "/v1/arguments/arg-1") {
        return jsonResponse({
          ok: true,
          status: 200,
          json: {
            argument: {
              id: "arg-1",
              topicId: TOPIC_ID,
              parentId: "arg-root",
              title: "My Argument",
              body: "My body",
              bodyRich: null,
              authorId: MY_AUTHOR_ID,
              analysisStatus: "ready",
              stanceScore: null,
              totalVotes: 3,
              totalCost: 9,
              prunedAt: null,
              createdAt: "2025-12-19T13:00:00.000Z",
              updatedAt: "2025-12-19T13:00:00.000Z",
            },
          },
        });
      }

      if (url.pathname === "/v1/arguments/arg-root") {
        return jsonResponse({
          ok: true,
          status: 200,
          json: {
            argument: {
              id: "arg-root",
              topicId: TOPIC_ID,
              parentId: null,
              title: "Root",
              body: "Root body",
              bodyRich: null,
              authorId: "66687aadf862bd77",
              analysisStatus: "ready",
              stanceScore: null,
              totalVotes: 0,
              totalCost: 0,
              prunedAt: null,
              createdAt: "2025-12-19T12:34:56.789Z",
              updatedAt: "2025-12-19T12:34:56.789Z",
            },
          },
        });
      }

      if (url.pathname === `/v1/topics/${TOPIC_ID}/arguments`) {
        lastCreateArgumentBody = init?.body ? JSON.parse(String(init.body)) : null;
        return jsonResponse({
          ok: true,
          status: 200,
          json: {
            argument: {
              id: "arg-new",
              topicId: TOPIC_ID,
              parentId: "arg-root",
              title: "Draft title",
              body: "Hello world",
              bodyRich: null,
              authorId: MY_AUTHOR_ID,
              analysisStatus: "pending_analysis",
              stanceScore: null,
              totalVotes: 0,
              totalCost: 0,
              prunedAt: null,
              createdAt: "2025-12-19T14:00:00.000Z",
              updatedAt: "2025-12-19T14:00:00.000Z",
            },
            ledger: {
              topicId: TOPIC_ID,
              pubkey: MY_PUBKEY_HEX,
              balance: 100,
              myTotalVotes: 0,
              myTotalCost: 0,
              lastInteractionAt: null,
            },
          },
        });
      }

      if (url.pathname === "/v1/arguments/arg-1/votes") {
        lastSetVotesBody = init?.body ? JSON.parse(String(init.body)) : null;
        return jsonResponse({
          ok: true,
          status: 200,
          json: {
            argumentId: "arg-1",
            previousVotes: 0,
            targetVotes: 1,
            deltaVotes: 1,
            previousCost: 0,
            targetCost: 1,
            deltaCost: 1,
            ledger: {
              topicId: TOPIC_ID,
              pubkey: MY_PUBKEY_HEX,
              balance: 99,
              myTotalVotes: 1,
              myTotalCost: 1,
              lastInteractionAt: null,
            },
          },
        });
      }

      if (url.pathname === "/v1/arguments/arg-1/edit") {
        lastEditArgumentBody = init?.body ? JSON.parse(String(init.body)) : null;
        return jsonResponse({
          ok: true,
          status: 200,
          json: {
            argument: {
              id: "arg-1",
              topicId: TOPIC_ID,
              parentId: "arg-root",
              title: "Updated title",
              body: "My body",
              bodyRich: null,
              authorId: MY_AUTHOR_ID,
              analysisStatus: "pending_analysis",
              stanceScore: null,
              totalVotes: 3,
              totalCost: 9,
              prunedAt: null,
              createdAt: "2025-12-19T13:00:00.000Z",
              updatedAt: "2025-12-19T15:00:00.000Z",
            },
          },
        });
      }

      throw new Error(`Unhandled request: ${url.toString()}`);
    }) as unknown as typeof fetch;

    const user = userEvent.setup();
    render(<TopicStage topicId={TOPIC_ID} />);

    await screen.findByRole("heading", { name: "Topic 1", level: 2 });
    await screen.findByLabelText(t("dialogue.replyLabel"));

    const replyTitle = screen.getByPlaceholderText(t("stage.titleOptionalPlaceholder"));
    const reply = screen.getByLabelText(t("dialogue.replyLabel"));
    const submitNew = screen.getByRole("button", { name: t("stage.submit") });

    await waitFor(() => {
      expect(replyTitle).toBeEnabled();
      expect(reply).toHaveAttribute("contenteditable", "true");
      expect(submitNew).toBeDisabled();
    });

    await user.type(replyTitle, "Draft title");
    await user.click(reply);
    await user.type(reply, "Hello world");

    await waitFor(() => expect(submitNew).toBeEnabled());

    await user.click(submitNew);
    await waitFor(() => {
      expect(lastCreateArgumentBody).toMatchObject({
        parentId: "arg-root",
        title: "Draft title",
        body: "Hello world",
        initialVotes: 0,
      });
      expect((lastCreateArgumentBody as any)?.bodyRich?.type).toBe("doc");
    });

    await user.click(screen.getByRole("button", { name: "Select arg-1" }));
    await screen.findByRole("heading", { name: "My Argument" });

    await user.click(screen.getByLabelText(t("stage.increaseVotes")));
    await user.click(screen.getByRole("button", { name: t("stage.confirmVotes") }));
    await waitFor(() => {
      expect(lastSetVotesBody).toEqual({ targetVotes: 1 });
    });

    await user.click(screen.getByRole("button", { name: t("stage.openReport") }));
    expect(mockPush).toHaveBeenCalledWith(`/topics/${TOPIC_ID}/report`);

    const editButton = await screen.findByRole("button", { name: t("stage.edit") });
    await waitFor(() => expect(editButton).toBeEnabled());
    await user.click(editButton);

    const titleInput = await screen.findByLabelText(t("stage.editTitleAria"));
    fireEvent.change(titleInput, { target: { value: "Updated title" } });

    const saveButton = screen.getByRole("button", { name: t("stage.saveChanges") });
    await waitFor(() => expect(saveButton).toBeEnabled());
    await user.click(saveButton);
    await waitFor(() => {
      expect(lastEditArgumentBody).toEqual({
        title: "Updated title",
        body: "My body",
        bodyRich: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "My body" }] }],
        },
      });
    });
  });

  it("loads and saves topic display name (server-stored)", async () => {
    jest.useFakeTimers();
    const { TopicStage } = require("@/components/topics/TopicStage");

    let lastProfileBody: unknown = null;

    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());

      if (url.pathname === `/v1/topics/${TOPIC_ID}/ledger/me`) {
        return jsonResponse({
          ok: true,
          status: 200,
          json: {
            topicId: TOPIC_ID,
            pubkey: MY_PUBKEY_HEX,
            balance: 100,
            myTotalVotes: 0,
            myTotalCost: 0,
            lastInteractionAt: null,
            displayName: "Matrix",
          },
        });
      }

      if (url.pathname === `/v1/topics/${TOPIC_ID}/stakes/me`) {
        return jsonResponse({
          ok: true,
          status: 200,
          json: {
            topicId: TOPIC_ID,
            pubkey: MY_PUBKEY_HEX,
            items: [],
          },
        });
      }

      if (url.pathname === `/v1/topics/${TOPIC_ID}/profile/me`) {
        lastProfileBody = init?.body ? JSON.parse(String(init.body)) : null;
        return jsonResponse({
          ok: true,
          status: 200,
          json: { topicId: TOPIC_ID, displayName: "Alice" },
        });
      }

      throw new Error(`Unhandled request: ${url.toString()}`);
    }) as unknown as typeof fetch;

    render(<TopicStage topicId={TOPIC_ID} />);

    const input = screen.getByTestId("topic-display-name-input");
    await waitFor(() => expect(input).toHaveValue("Matrix"));

    fireEvent.change(input, { target: { value: "Alice" } });

    jest.advanceTimersByTime(700);
    await waitFor(() => expect(lastProfileBody).toEqual({ displayName: "Alice" }));
    jest.useRealTimers();
  });
});
