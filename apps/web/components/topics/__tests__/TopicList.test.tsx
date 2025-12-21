import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const { TopicList } = require("@/components/topics/TopicList");

function mockFetchOnce(response: {
  ok: boolean;
  status: number;
  json: unknown;
}) {
  global.fetch = jest.fn(async () => ({
    ok: response.ok,
    status: response.status,
    text: async () => JSON.stringify(response.json),
  })) as unknown as typeof fetch;
}

describe("TopicList", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = "https://example.com";
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders topics when fetch succeeds", async () => {
    mockFetchOnce({
      ok: true,
      status: 200,
      json: {
        items: [
          {
            id: "topic-1",
            title: "First topic",
            rootArgumentId: "arg-1",
            status: "active",
            ownerPubkey: null,
            createdAt: "2025-12-19T12:34:56.789Z",
            updatedAt: "2025-12-19T12:34:56.789Z",
          },
        ],
        nextBeforeId: null,
      },
    });

    render(<TopicList />);

    expect(await screen.findByRole("link", { name: "First topic" })).toHaveAttribute(
      "href",
      "/topics/topic-1",
    );
  });

  it("shows an error state when fetch fails", async () => {
    global.fetch = jest.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    render(<TopicList />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Network error");
  });

  it("shows a user-friendly error when contract parse fails", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});

    mockFetchOnce({
      ok: true,
      status: 200,
      json: { unexpected: true },
    });

    render(<TopicList />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unexpected server response",
    );
  });
});
