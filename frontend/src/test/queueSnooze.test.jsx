import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import DraftQueue from "@/components/board/DraftQueue";
import { api } from "@/api/client";

// Honesty bundle fix 5: snooze offers the backend's real durations (1h/4h/24h
// via the existing hours parameter) on both the due-reminder card and the
// scheduled rows, instead of one hardcoded hour.
window.matchMedia =
  window.matchMedia ||
  ((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }));

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

import { toast } from "sonner";

const mockQueue = ({ scheduled = [], notifications = [] } = {}) => {
  api.get.mockImplementation((url) => {
    if (url === "/queue") return Promise.resolve({ email_enabled: false, items: scheduled });
    if (url === "/queue/notifications") return Promise.resolve(notifications);
    if (url === "/board") return Promise.resolve(scheduled);
    return Promise.resolve({});
  });
};

const renderQueue = () =>
  render(
    <MemoryRouter>
      <DraftQueue />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe("snooze offers 1h, 4h, and 24h (Honesty bundle fix 5)", () => {
  it("renders all three durations on a scheduled row and posts the chosen hours", async () => {
    const user = userEvent.setup();
    mockQueue({ scheduled: [{ id: "idea_1", topic_title: "Agents eat SaaS", scheduled_for: "2099-01-01T09:00:00Z" }] });
    renderQueue();

    // The three durations, each a distinct button with its own aria label.
    expect(await screen.findByTestId("snooze-1h-btn-idea_1")).toHaveAccessibleName("Snooze 1 hour");
    expect(screen.getByTestId("snooze-4h-btn-idea_1")).toHaveAccessibleName("Snooze 4 hours");
    expect(screen.getByTestId("snooze-24h-btn-idea_1")).toHaveAccessibleName("Snooze 24 hours");

    api.post.mockResolvedValue({});
    await user.click(screen.getByTestId("snooze-24h-btn-idea_1"));
    expect(api.post).toHaveBeenCalledWith("/queue/idea_1/snooze", { hours: 24 });
  });

  it("posts the 4h choice from the due-reminder card", async () => {
    const user = userEvent.setup();
    mockQueue({
      notifications: [
        { id: "n_1", idea_id: "idea_1", idea_title: "Agents eat SaaS", read: false },
      ],
    });
    renderQueue();

    await screen.findByTestId("queue-reminder-card");
    expect(screen.getByTestId("snooze-1h-btn-idea_1")).toBeInTheDocument();
    expect(screen.getByTestId("snooze-4h-btn-idea_1")).toBeInTheDocument();
    expect(screen.getByTestId("snooze-24h-btn-idea_1")).toBeInTheDocument();

    api.post.mockResolvedValue({});
    await user.click(screen.getByTestId("snooze-4h-btn-idea_1"));
    expect(api.post).toHaveBeenCalledWith("/queue/idea_1/snooze", { hours: 4 });
  });

  it("fails loud with an honest message when the snooze call fails", async () => {
    const user = userEvent.setup();
    mockQueue({ scheduled: [{ id: "idea_1", topic_title: "Agents eat SaaS", scheduled_for: "2099-01-01T09:00:00Z" }] });
    renderQueue();

    await screen.findByTestId("snooze-1h-btn-idea_1");
    api.post.mockRejectedValueOnce(new Error("down"));
    await user.click(screen.getByTestId("snooze-4h-btn-idea_1"));
    expect(toast.error).toHaveBeenCalledWith(
      "Couldn't snooze that — the reminder is unchanged. Try again.",
    );
  });
});
