import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import ContentBoard from "@/components/board/ContentBoard";
import DraftQueue from "@/components/board/DraftQueue";
import LinkedInPreviewPane, { foldPreview } from "@/components/board/LinkedInPreviewPane";
import TagInput, { normalizeClientTags } from "@/components/board/TagInput";
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

// jsdom has no PointerEvent, so the radix Select trigger never opens under
// userEvent (data-state stays "closed") — a widget-behavior limitation, not
// a page one. Same module mock as analytics.test.jsx: an item selection
// calls onValueChange, the only contract ContentBoard uses.
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const SelectContext = React.createContext(null);
  const Select = ({ value, onValueChange, children }) =>
    React.createElement(
      SelectContext.Provider,
      { value: { value, onValueChange } },
      children
    );
  const SelectTrigger = ({ children, ...props }) =>
    React.createElement("div", props, children);
  const SelectValue = ({ placeholder }) =>
    React.createElement("span", null, placeholder);
  const SelectContent = ({ children }) => React.createElement("div", null, children);
  const SelectItem = ({ value, children }) =>
    React.createElement(SelectContext.Consumer, null, (ctx) =>
      React.createElement(
        "button",
        {
          type: "button",
          "data-testid": `select-option-${value}`,
          onClick: () => ctx?.onValueChange?.(value),
        },
        children
      )
    );
  return { Select, SelectTrigger, SelectValue, SelectContent, SelectItem };
});

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

// --- board tags (spec Tag completion) -------------------------------------------

describe("ContentBoard tags", () => {
  it("adds a tag from the card's inline editor through PATCH and settles on the response", async () => {
    const user = userEvent.setup();
    mockBoard([boardIdea()]);
    api.patch.mockResolvedValue(boardIdea({ tags: ["agents", "rag"] }));
    renderBoard();
    const input = await screen.findByTestId("board-tag-editor-input");
    await user.type(input, "rag{Enter}");
    expect(api.patch).toHaveBeenCalledWith("/board/idea_1/tags", {
      tags: ["agents", "rag"],
    });
    await waitFor(() =>
      expect(screen.getAllByTestId("board-tag-editor-chip")).toHaveLength(2),
    );
  });

  it("removes a tag through the chip's remove button and PATCHes the remaining list", async () => {
    const user = userEvent.setup();
    mockBoard([boardIdea({ tags: ["agents", "rag"] })]);
    api.patch.mockResolvedValue(boardIdea({ tags: ["agents"] }));
    renderBoard();
    await user.click(await screen.findByRole("button", { name: "Remove tag rag" }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith("/board/idea_1/tags", { tags: ["agents"] }),
    );
  });

  it("reverts the tag row and toasts when the PATCH fails", async () => {
    const { toast } = await import("sonner");
    const user = userEvent.setup();
    mockBoard([boardIdea()]);
    api.patch.mockRejectedValue(new Error("network"));
    renderBoard();
    const input = await screen.findByTestId("board-tag-editor-input");
    await user.type(input, "rag{Enter}");
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    // The optimistic chip un-happens: the card keeps exactly its old tags.
    await waitFor(() =>
      expect(screen.getAllByTestId("board-tag-editor-chip")).toHaveLength(1),
    );
    expect(screen.getByTestId("board-tag-editor-chip")).toHaveTextContent("agents");
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringMatching(/keeps its old tags/),
    );
  });

  it("suggests the existing tag set while typing and commits the highlighted suggestion with the keyboard", async () => {
    const user = userEvent.setup();
    mockBoard([boardIdea()], ["agents", "agents-eval"]);
    api.patch.mockResolvedValue(boardIdea({ tags: ["agents", "agents-eval"] }));
    renderBoard();
    const input = await screen.findByTestId("board-tag-editor-input");
    await user.type(input, "ag");
    // "agents" is already on the card — only the un-added match is offered.
    const suggestions = await screen.findByTestId("board-tag-editor-suggestions");
    expect(suggestions).toHaveTextContent("agents-eval");
    expect(suggestions).not.toHaveTextContent(/^agents$/);
    await user.keyboard("{ArrowDown}{Enter}");
    expect(api.patch).toHaveBeenCalledWith("/board/idea_1/tags", {
      tags: ["agents", "agents-eval"],
    });
  });

  it("sends the tag filter as the tag param and lets Clear restore the full board", async () => {
    const user = userEvent.setup();
    mockBoard([boardIdea()]);
    renderBoard();
    await screen.findByTestId("board-columns");
    // Select is mocked to its used contract (module mock above): selecting
    // the "agents" item drives onValueChange like the real widget would.
    await user.click(screen.getByTestId("board-tag-filter"));
    await user.click(screen.getByTestId("select-option-agents"));
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith("/board", { params: { tag: "agents" } }),
    );
    await user.click(screen.getByTestId("board-clear-filters"));
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith("/board", { params: {} }),
    );
  });

  it("caps tag entry at the backend bound with an honest placeholder", async () => {
    mockBoard([boardIdea({ tags: ["t0", "t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8", "t9"] })]);
    renderBoard();
    const input = await screen.findByTestId("board-tag-editor-input");
    expect(input).toBeDisabled();
    expect(input).toHaveProperty("placeholder", "Tag limit reached (10)");
  });
});

// --- TagInput (direct) -----------------------------------------------------------

describe("TagInput", () => {
  const renderTagInput = (props = {}) => {
    const handleChange = vi.fn();
    render(
      <TagInput tags={["evals"]} onChange={handleChange} testId="tag-test" {...props} />,
    );
    return handleChange;
  };

  it("commits on Enter and comma, stripping and deduping like the backend", async () => {
    const user = userEvent.setup();
    const onChange = renderTagInput();
    const input = screen.getByTestId("tag-test-input");
    await user.type(input, "rag{Enter}");
    expect(onChange).toHaveBeenLastCalledWith(["evals", "rag"]);
    await user.type(input, "  rag  ,");
    // Exact-match dedupe — a stripped duplicate never re-fires onChange.
    expect(onChange).toHaveBeenLastCalledWith(["evals", "rag"]);
  });

  it("pops the last tag on Backspace from an empty input", async () => {
    const user = userEvent.setup();
    const onChange = renderTagInput();
    const input = screen.getByTestId("tag-test-input");
    await user.type(input, "{Backspace}");
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("Escape clears the draft and closes the suggestion list", async () => {
    const user = userEvent.setup();
    renderTagInput({ suggestions: ["rag"] });
    const input = screen.getByTestId("tag-test-input");
    await user.type(input, "ra");
    expect(screen.getByTestId("tag-test-suggestions")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("tag-test-suggestions")).not.toBeInTheDocument();
    expect(screen.getByTestId("tag-test-input")).toHaveValue("");
  });

  it("disables input at the cap with the honest placeholder", () => {
    renderTagInput({ tags: Array.from({ length: 10 }, (_, i) => `t${i}`) });
    const input = screen.getByTestId("tag-test-input");
    expect(input).toBeDisabled();
    expect(input).toHaveProperty("placeholder", "Tag limit reached (10)");
  });

  it("normalizes exactly like board.normalize_tags", () => {
    expect(normalizeClientTags([" evals ", "evals", "", "rag"])).toEqual([
      "evals",
      "rag",
    ]);
    expect(normalizeClientTags(["x".repeat(50)])).toEqual(["x".repeat(40)]);
    // The wire contract is strings — non-strings are dropped, never coerced
    // into phantom tags like "null".
    expect(normalizeClientTags(["a", null, 7])).toEqual(["a"]);
    expect(normalizeClientTags(Array.from({ length: 15 }, (_, i) => `t${i}`))).toHaveLength(10);
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

  it("keeps a preselected draft through the closed-picker wipe and shows the target chip", async () => {
    mockQueue({ board: [boardIdea()] });
    render(
      <MemoryRouter>
        <DraftQueue preselected={boardIdea()} onPreselectedConsumed={vi.fn()} />
      </MemoryRouter>,
    );
    const chip = await screen.findByTestId("schedule-target-chip");
    expect(chip).toHaveTextContent("Agents eat SaaS");
    // The bubble wipe would have reset ideaId before the fix — submit stays armed.
    expect(screen.getByTestId("schedule-submit-btn")).toBeEnabled();
  });

  it("clears the preselected draft from the target chip", async () => {
    const user = userEvent.setup();
    mockQueue({ board: [boardIdea()] });
    render(
      <MemoryRouter>
        <DraftQueue preselected={boardIdea()} onPreselectedConsumed={vi.fn()} />
      </MemoryRouter>,
    );
    await screen.findByTestId("schedule-target-chip");
    await user.click(screen.getByTestId("schedule-target-clear"));
    expect(screen.queryByTestId("schedule-target-chip")).not.toBeInTheDocument();
    expect(screen.getByTestId("schedule-submit-btn")).toBeDisabled();
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
