import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockPush = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

const { CreateTopicForm } = require("@/components/topics/CreateTopicForm");

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

describe("CreateTopicForm", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = "https://example.com";
    mockPush.mockReset();
  });

  it("validates required fields", async () => {
    const user = userEvent.setup();

    render(<CreateTopicForm />);

    await user.click(screen.getByRole("button", { name: /create/i }));

    expect(screen.getByText("Title is required")).toBeInTheDocument();
    expect(screen.getByText("Body is required")).toBeInTheDocument();
  });

  it("submits and navigates to /topics/{topicId}", async () => {
    const user = userEvent.setup();

    mockFetchOnce({
      ok: true,
      status: 200,
      json: {
        topicId: "topic-123",
        rootArgumentId: "arg-123",
        claimToken: "token",
        expiresAt: "2025-12-19T12:34:56.789Z",
      },
    });

    render(<CreateTopicForm />);

    await user.type(screen.getByLabelText("Title"), "My topic");
    await user.type(screen.getByLabelText("Body"), "Hello");
    await user.click(screen.getByRole("button", { name: /create/i }));

    expect(mockPush).toHaveBeenCalledWith("/topics/topic-123");
  });
});
