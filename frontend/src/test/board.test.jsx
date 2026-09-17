import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import ContentBoard from "@/components/board/ContentBoard";
import DraftQueue from "@/components/board/DraftQueue";
import LinkedInPreviewPane, { foldPreview } from "@/components/board/LinkedInPreviewPane";
import { api } from "@/api/client";

// Board + queue + preview surfaces, driven through the same api-mock pattern
// as components.test.jsx: every async state is exercised against the typed
// client seam, never a live backend.

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/api/client", () => ({
  API: "http://test/api",
  ApiError: class ApiError extends Error {
    constructor({ status = 0, kind = "unknown", message = "failed" } = {}) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.kind = kind;
    }
  },
  normalizeApiError: (e) => e,
  onUnauthorized: () => {},
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const boardIdea = (over = {}) => ({
  id: "idea_1",
  user_id: "user_1",
  topic_title: "Agents eat SaaS",
  rating: 8.5,
  rating_explanation: "Fresh signal.",
  niche: "AI",
  tone: "Professional",
  created_at: "2026-09-17T08:00:00+00:00",
  is_bookmarked: false,
  status: "inbox",
  tags: ["agents"],
  scheduled_for: null,
  reminder_fired_at: null,
  generated_post: "Line one hook.\n\nLine two argument.",
  post_format: "hot-take",
  ...over,
});

const mockBoard = (ideas, tags = ["agents"]) => {
  api.get.mockImplementation((url) => {
    if (url === "/board") return Promise.resolve(ideas);
    if (url === "/board/tags") return Promise.resolve(tags);
    if (url === "/queue") return Promise.resolve({ email_enabled: false, items: ideas.filter((i) => i.scheduled_for) });
    if (url === "/queue/notifications") return Promise.resolve([]);
    return Promise.resolve({});
  });
};

const renderBoard = (props = {}) =>
  render(
    <MemoryRouter>
      <ContentBoard onPreview={vi.fn()} onSchedule={vi.fn()} onExport={vi.fn()} {...props} />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
});

// --- ContentBoard -------------------------------------------------------------

describe("ContentBoard", () => {
  it("renders pipeline columns with cards in their status column", async () => {
    mockBoard([
      boardIdea(),
      boardIdea({ id: "idea_2", topic_title: "Second idea", status: "ready", tags: [] }),
    ]);
    renderBoard();
    expect(await screen.findByTestId("board-columns")).toBeInTheDocument();
    expect(screen.getByTestId("board-column-inbox")).toHaveTextContent("Agents eat SaaS");
    expect(screen.getByTestId("board-column-ready")).toHaveTextContent("Second idea");
    expect(screen.getByTestId("board-count-inbox")).toHaveTextContent("1");
  });

  it("offers only adjacent-step transition buttons per card", async () => {
    mockBoard([boardIdea({ status: "inbox" })]);
    renderBoard();
    expect(await screen.findByTestId("board-move-idea_1-forged")).toBeInTheDocument();
    expect(screen.queryByTestId("board-move-idea_1-drafting")).not.toBeInTheDocument();
    expect(screen.queryByTestId("board-move-idea_1-ready")).not.toBeInTheDocument();
  });

  it("moves a card optimistically and settles on the backend response", async () => {
    const user = userEvent.setup();
    mockBoard([boardIdea()]);
    api.post.mockResolvedValue(boardIdea({ status: "forged" }));
    renderBoard();
    await user.click(await screen.findByTestId("board-move-idea_1-forged"));
    await waitFor(() =>
      expect(screen.getByTestId("board-column-forged")).toHaveTextContent("Agents eat SaaS"),
    );
    expect(api.post).toHaveBeenCalledWith("/board/idea_1/transition", { to: "forged" });
  });

  it("reverts a failed move to its original column and says which card moved back", async () => {
    const { toast } = await import("sonner");
    const user = userEvent.setup();
    mockBoard([boardIdea()]);
    api.post.mockRejectedValue(new Error("network"));
    renderBoard();
    await user.click(await screen.findByTestId("board-move-idea_1-forged"));
    await waitFor(() =>
      expect(screen.getByTestId("board-column-inbox")).toHaveTextContent("Agents eat SaaS"),
    );
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringMatching(/“Agents eat SaaS” is back in Inbox/),
    );
  });

  it("renders the honest empty board state", async () => {
    mockBoard([]);
    renderBoard();
    expect(await screen.findByTestId("board-empty")).toHaveTextContent(
      "The board is where ideas grow up.",
    );
  });

  it("renders the error state with retry when the board fails to load", async () => {
    api.get.mockRejectedValue(new Error("down"));
    renderBoard();
    expect(await screen.findByTestId("board-error")).toHaveTextContent(
      "The board didn't load.",
    );
    api.get.mockImplementation((url) =>
      Promise.resolve(url === "/board/tags" ? [] : [boardIdea()]),
    );
    const retry = screen.getByRole("button", { name: /retry/i });
    await waitFor(() => expect(retry).toBeEnabled());
  });

  it("sends the search text as the q filter and shows the filter-empty state", async () => {
    const user = userEvent.setup();
    mockBoard([boardIdea()]);
    renderBoard();
    await screen.findByTestId("board-columns");
    api.get.mockResolvedValue([]);
    await user.type(screen.getByTestId("board-search-input"), "agents");
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith("/board", { params: { q: "agents" } }),
    );
    expect(await screen.findByTestId("board-filter-empty")).toBeInTheDocument();
  });

  it("shows reminder chips for scheduled cards", async () => {
    mockBoard([boardIdea({ scheduled_for: "2099-01-01T09:00:00Z" })]);
    renderBoard();
    expect(await screen.findByTestId("board-card-reminder")).toBeInTheDocument();
  });
});

// --- DraftQueue -----------------------------------------------------------------

describe("DraftQueue", () => {
  // DraftQueue reads three feeds: the scheduled queue, the notifications, and
  // the board (schedule-form candidates come from the full idea inventory).
  const mockQueue = ({ scheduled = [], notifications = [], board = null, emailEnabled = false } = {}) => {
    api.get.mockImplementation((url) => {
      if (url === "/queue") return Promise.resolve({ email_enabled: emailEnabled, items: scheduled });
      if (url === "/queue/notifications") return Promise.resolve(notifications);
      if (url === "/board") return Promise.resolve(board ?? scheduled);
      return Promise.resolve({});
    });
  };

  it("renders scheduled rows with absolute and relative times", async () => {
    mockQueue({ scheduled: [boardIdea({ status: "drafting", scheduled_for: "2099-01-01T09:00:00Z" })] });
    render(<MemoryRouter><DraftQueue /></MemoryRouter>);
    expect(await screen.findByTestId("queue-row")).toHaveTextContent("Agents eat SaaS");
    expect(screen.getByTestId("queue-row-when")).toHaveTextContent("Jan 1");
    expect(screen.getByTestId("queue-channel-line")).toHaveTextContent(
      "Reminders fire in-app. Email delivery appears here when it's connected for this deployment.",
    );
  });

  it("states the email channel truthfully when email is enabled", async () => {
    mockQueue({ emailEnabled: true });
    render(<MemoryRouter><DraftQueue /></MemoryRouter>);
    expect(await screen.findByTestId("queue-channel-line")).toHaveTextContent(
      "Reminders fire in-app and by email for this deployment.",
    );
  });

  it("renders the never-posts empty state", async () => {
    mockQueue({});
    render(<MemoryRouter><DraftQueue /></MemoryRouter>);
    expect(await screen.findByTestId("queue-empty")).toHaveTextContent(
      "IdeaForge never posts for you.",
    );
  });

  it("schedules a reminder with an ISO timestamp and confirms the absolute time", async () => {
    const { toast } = await import("sonner");
    const user = userEvent.setup();
    mockQueue({ board: [boardIdea()] });
    api.post.mockResolvedValue(boardIdea({ scheduled_for: "2099-01-01T09:00:00Z" }));
    render(
      <MemoryRouter>
        <DraftQueue preselected={boardIdea()} onPreselectedConsumed={vi.fn()} />
      </MemoryRouter>,
    );
    await screen.findByTestId("schedule-form");
    await user.click(screen.getByTestId("schedule-submit-btn"));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [url, body] = api.post.mock.calls[0];
    expect(url).toBe("/queue/idea_1/schedule");
    expect(new Date(body.scheduled_for).getTime()).toBeGreaterThan(Date.now());
    expect(toast.success).toHaveBeenCalledWith(
      expect.stringContaining("The draft will be waiting here."),
    );
  });

  it("rejects scheduling a past time before touching the API", async () => {
    const { toast } = await import("sonner");
    const user = userEvent.setup();
    mockQueue({ board: [boardIdea()] });
    render(
      <MemoryRouter>
        <DraftQueue preselected={boardIdea()} onPreselectedConsumed={vi.fn()} />
      </MemoryRouter>,
    );
    await screen.findByTestId("schedule-form");
    const input = screen.getByTestId("schedule-when-input");
    await user.clear(input);
    await user.type(input, "2020-01-01T09:00");
    await user.click(screen.getByTestId("schedule-submit-btn"));
    expect(api.post).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("time is in the past"),
    );
  });

  it("renders due reminders with open/snooze/mark-read and marks read", async () => {
    const user = userEvent.setup();
    mockQueue({
      scheduled: [boardIdea({ status: "drafting", scheduled_for: "2020-01-01T09:00:00Z" })],
      notifications: [
        { id: "n_1", user_id: "user_1", idea_id: "idea_1", idea_title: "Agents eat SaaS", channel: "in_app", fired_at: "2026-09-17T09:00:00Z", read: false },
      ],
    });
    render(<MemoryRouter><DraftQueue /></MemoryRouter>);
    expect(await screen.findByTestId("queue-reminder-card")).toHaveTextContent(
      "Reminder: “Agents eat SaaS” is due.",
    );
    api.post.mockResolvedValue({ read: true });
    await user.click(screen.getByTestId("reminder-read-btn-n_1"));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/queue/notifications/n_1/read"),
    );
    await waitFor(() =>
      expect(screen.queryByTestId("queue-reminder-card")).not.toBeInTheDocument(),
    );
  });

  it("unschedules a reminder", async () => {
    const user = userEvent.setup();
    mockQueue({ scheduled: [boardIdea({ scheduled_for: "2099-01-01T09:00:00Z" })] });
    api.delete.mockResolvedValue(boardIdea());
    render(<MemoryRouter><DraftQueue /></MemoryRouter>);
    await user.click(await screen.findByTestId("queue-unschedule-btn-idea_1"));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith("/queue/idea_1/schedule"));
  });
});

describe("LinkedInPreviewPane", () => {
  const clean = {
    char_count: 30,
    char_limit: 3000,
    clean: true,
    checks: [{ id: "char_limit", severity: "info", message: "30 / 3000 characters — under the limit." }],
    first_two_lines: "Line one hook.",
  };

  it("renders the clean verdict from the backend linter", async () => {
    api.post.mockResolvedValue(clean);
    render(<MemoryRouter><LinkedInPreviewPane text="Line one hook." /></MemoryRouter>);
    await waitFor(() =>
      expect(screen.getByTestId("preview-checks")).toHaveTextContent(
        "Clean — this is what LinkedIn will show.",
      ),
    );
    expect(api.post).toHaveBeenCalledWith("/preview/linkedin", { text: "Line one hook." });
  });

  it("renders severity checks when the linter flags the draft", async () => {
    api.post.mockResolvedValue({
      ...clean,
      clean: false,
      checks: [
        { id: "markdown_remnants", severity: "error", message: "Markdown leftovers — ** bold ** won't render." },
        { id: "unicode_fake_formatting", severity: "warn", message: "2 characters of fake formatting." },
      ],
    });
    render(<MemoryRouter><LinkedInPreviewPane text="**bold** text" /></MemoryRouter>);
    const checks = await screen.findByTestId("preview-checks");
    expect(checks).toHaveTextContent("Markdown leftovers");
    expect(checks).toHaveTextContent("fake formatting");
  });

  it("shows the honest error state when checks fail, with retry", async () => {
    const user = userEvent.setup();
    api.post.mockRejectedValueOnce(new Error("down"));
    render(<MemoryRouter><LinkedInPreviewPane text="hello" /></MemoryRouter>);
    expect(await screen.findByTestId("preview-checks-error")).toHaveTextContent(
      "your draft is untouched",
    );
    api.post.mockResolvedValue(clean);
    await user.click(screen.getByTestId("preview-retry-btn"));
    await waitFor(() =>
      expect(screen.getByTestId("preview-checks")).toHaveTextContent("Clean"),
    );
  });

  it("copies the draft and names the no-auto-post boundary", async () => {
    const { toast } = await import("sonner");
    // userEvent.setup() installs its own Clipboard on navigator — stub AFTER
    // setup, or the component copies into the real clipboard, not the spy.
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    api.post.mockResolvedValue(clean);
    render(<MemoryRouter><LinkedInPreviewPane text="Line one hook." /></MemoryRouter>);
    await screen.findByTestId("preview-checks");
    await user.click(screen.getByTestId("preview-copy-btn"));
    expect(writeText).toHaveBeenCalledWith("Line one hook.");
    expect(toast.success).toHaveBeenCalledWith(
      "Copied. Paste it into LinkedIn and post it yourself.",
    );
  });

  it("folds the preview to two lines and truncates per device", () => {
    expect(foldPreview("One.\n\nTwo.\nThree.", 210)).toBe("One.\nTwo.");
    const long = foldPreview("A".repeat(300) + "\nsecond line", 210);
    expect(long.length).toBeLessThanOrEqual(211);
    expect(long.endsWith("…")).toBe(true);
  });
});
