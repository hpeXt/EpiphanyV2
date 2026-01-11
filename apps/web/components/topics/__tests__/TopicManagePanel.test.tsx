import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TopicManagePanel } from "@/components/topics/TopicManagePanel";

type MockJsonResponse = { ok: boolean; status: number; json: unknown };

function jsonResponse(response: MockJsonResponse) {
  return {
    ok: response.ok,
    status: response.status,
    text: async () => JSON.stringify(response.json),
  };
}

describe("TopicManagePanel", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = "https://example.com";
    window.localStorage.clear();
    window.localStorage.setItem("tm:master-seed:v1", "00".repeat(64));
    jest.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("prefills prune argument id from defaultArgumentId", () => {
    render(
      <TopicManagePanel
        topicId="topic-1"
        topicTitle="Topic 1"
        topicStatus="active"
        topicVisibility="public"
        rootBody="Root body"
        defaultArgumentId="arg-123"
        onInvalidate={() => {}}
        onClose={() => {}}
      />,
    );

    expect(screen.getByLabelText(/Argument ID|节点 ID/i)).toHaveValue("arg-123");
  });

  it("sends BLACKLIST_PUBKEY topic command", async () => {
    let lastCommand: unknown = null;

    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());

      if (url.pathname === "/v1/topics/topic-1/commands") {
        lastCommand = init?.body ? JSON.parse(String(init.body)) : null;
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
              visibility: "public",
              createdAt: "2025-12-19T12:34:56.789Z",
              updatedAt: "2025-12-19T12:34:56.789Z",
            },
          },
        });
      }

      throw new Error(`Unhandled request: ${url.toString()}`);
    }) as unknown as typeof fetch;

    const onInvalidate = jest.fn();
    const user = userEvent.setup();

    render(
      <TopicManagePanel
        topicId="topic-1"
        topicTitle="Topic 1"
        topicStatus="active"
        topicVisibility="public"
        rootBody="Root body"
        onInvalidate={onInvalidate}
        onClose={() => {}}
      />,
    );

    await user.type(screen.getByLabelText(/Target pubkey \\(hex\\)|目标公钥/i), "ab".repeat(32));
    await user.type(screen.getByLabelText(/Blacklist reason \\(optional\\)|拉黑原因/i), "spam");

    await user.click(screen.getByRole("button", { name: /Blacklist|拉黑/i }));

    await waitFor(() => {
      expect(lastCommand).toEqual({
        type: "BLACKLIST_PUBKEY",
        payload: { pubkey: "ab".repeat(32), reason: "spam" },
      });
      expect(onInvalidate).toHaveBeenCalledTimes(1);
    });
  });
});
