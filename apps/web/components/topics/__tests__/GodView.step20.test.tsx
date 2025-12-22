import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const { GodView } = require("@/components/topics/GodView");

type MockJsonResponse = { ok: boolean; status: number; json: unknown };

function jsonResponse(response: MockJsonResponse) {
  return {
    ok: response.ok,
    status: response.status,
    text: async () => JSON.stringify(response.json),
  };
}

function createClusterMapFixture(overrides?: Record<string, unknown>) {
  return {
    topicId: "topic-1",
    modelVersion: "v1-2025-12-19T12:00:00.000Z",
    computedAt: "2025-12-19T12:00:00.000Z",
    points: [
      {
        argumentId: "arg-1",
        x: 0,
        y: 0,
        clusterId: "c-1",
        stance: 1,
        weight: Math.log(11),
      },
    ],
    clusters: [
      {
        id: "c-1",
        label: "Cluster 1",
        summary: "Summary 1",
        centroid: { x: 0, y: 0 },
      },
    ],
    ...(overrides ?? {}),
  };
}

function createFetchMock(fixtures: {
  clusterMap?: unknown;
  status?: number;
  ok?: boolean;
}) {
  return jest.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input.toString());

    if (url.pathname === "/v1/topics/topic-1/cluster-map") {
      return jsonResponse({
        ok: fixtures.ok ?? true,
        status: fixtures.status ?? 200,
        json: fixtures.clusterMap ?? createClusterMapFixture(),
      });
    }

    if (url.pathname === "/v1/arguments/arg-1") {
      return jsonResponse({
        ok: true,
        status: 200,
        json: {
          argument: {
            id: "arg-1",
            topicId: "topic-1",
            parentId: "arg-root",
            title: null,
            body: "Hello world",
            bodyRich: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [
                    { type: "text", text: "Hello " },
                    { type: "text", text: "world", marks: [{ type: "bold" }] },
                  ],
                },
              ],
            },
            authorId: "0123456789abcdef",
            analysisStatus: "pending_analysis",
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
  });
}

function mockCanvasContext() {
  const ctx = {
    canvas: document.createElement("canvas"),
    save: jest.fn(),
    restore: jest.fn(),
    clearRect: jest.fn(),
    fillRect: jest.fn(),
    strokeRect: jest.fn(),
    beginPath: jest.fn(),
    arc: jest.fn(),
    fill: jest.fn(),
    stroke: jest.fn(),
    setTransform: jest.fn(),
    fillText: jest.fn(),
    measureText: jest.fn(() => ({ width: 10 })),
  };

  jest.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => {
    return ctx as unknown as CanvasRenderingContext2D;
  });

  return ctx;
}

describe("GodView (Step 20)", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = "https://example.com";
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("fetches and parses cluster-map using shared-contracts", async () => {
    mockCanvasContext();
    const fetchMock = createFetchMock({});
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<GodView topicId="topic-1" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.pathname).toBe("/v1/topics/topic-1/cluster-map");

    expect(await screen.findByTestId("godview-canvas")).toBeInTheDocument();
  });

  it("shows a degraded empty-state when cluster-map has no points", async () => {
    mockCanvasContext();
    const fetchMock = createFetchMock({
      clusterMap: createClusterMapFixture({ points: [], clusters: [] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<GodView topicId="topic-1" />);

    expect(await screen.findByRole("status")).toHaveTextContent(/no cluster/i);
    expect(screen.queryByTestId("godview-canvas")).not.toBeInTheDocument();
  });

  it("shows a degraded error-state when API request fails", async () => {
    mockCanvasContext();
    const fetchMock = createFetchMock({
      ok: false,
      status: 404,
      clusterMap: { error: { code: "TOPIC_NOT_FOUND", message: "Not found", details: {} } },
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<GodView topicId="topic-1" />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/not found/i);
  });

  it("renders a stable Calling Card on hover", async () => {
    mockCanvasContext();
    const fetchMock = createFetchMock({
      clusterMap: createClusterMapFixture({
        points: [{ argumentId: "arg-1", x: 0, y: 0, clusterId: "c-1", stance: -1, weight: Math.log(6) }],
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<GodView topicId="topic-1" />);

    const canvas = await screen.findByTestId("godview-canvas");
    Object.defineProperty(canvas, "getBoundingClientRect", {
      value: () => ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
        right: 800,
        bottom: 600,
        x: 0,
        y: 0,
        toJSON: () => "",
      }),
    });

    fireEvent.pointerMove(canvas, { clientX: 400, clientY: 300 });

    await waitFor(() => {
      const paths = fetchMock.mock.calls.map((call) => new URL(call[0] as string).pathname);
      expect(paths).toContain("/v1/arguments/arg-1");
    });

    const card = await screen.findByTestId("godview-calling-card");
    expect(card).toBeInTheDocument();
    expect(screen.getByTestId("godview-calling-card-title")).toHaveTextContent("arg-1");
    expect(screen.getByTestId("godview-calling-card-meta-cluster")).toHaveTextContent("c-1");
    expect(screen.getByTestId("godview-calling-card-meta-stance")).toHaveTextContent(/con|反对/i);
    expect(screen.getByTestId("godview-calling-card-meta-votes")).toHaveTextContent("5");

    expect(screen.getByText("Hello")).toBeInTheDocument();
    expect(screen.getByText("world").tagName.toLowerCase()).toBe("strong");
  });
});
