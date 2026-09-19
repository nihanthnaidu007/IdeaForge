import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";

// Honesty bundle fix 7: the Dashboard copy path runs the same
// /preview/linkedin lint the Board preview runs. The component test drives
// research → ideas → format → variants → pick → copy and asserts the lint
// call, the gate's decision (error checks block the clipboard), and the
// honest failure when the linter itself is down. The pane under the draft
// shows the same checks, so a blocked copy's reason is never a mystery.
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
  Toaster: () => null,
}));

const authMe = vi.fn();
vi.mock("@/api/client", () => ({
  API: "http://test/api",
  ERROR_KINDS: {
    MISSING_KEY: "missing_key",
    AUTH: "auth",
    QUOTA: "quota",
    RATE_LIMITED: "rate_limited",
    RESEARCH_FAILED: "research_failed",
    GENERATION_FAILED: "generation_failed",
    UNAVAILABLE: "unavailable",
    VALIDATION: "validation",
    CONFLICT: "conflict",
    NOT_FOUND: "not_found",
    NETWORK: "network",
    SERVER: "server",
    CAP: "cap",
    UNKNOWN: "unknown",
  },
  ApiError: class ApiError extends Error {
    constructor({ status, kind, message, provider, detail, caps }) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.kind = kind;
      this.provider = provider;
      this.detail = detail;
      this.caps = caps;
    }
  },
  isKeyIssueError: (e) => ["missing_key", "auth", "quota", "cap"].includes(e?.kind),
  normalizeApiError: (e) => e,
  onUnauthorized: () => {},
  api: {
    get: vi.fn((url) => {
      if (url === "/auth/me") return authMe();
      return Promise.resolve({});
    }),
    post: vi.fn().mockResolvedValue({}),
    patch: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
  },
}));

import { api } from "@/api/client";
import { toast } from "sonner";

// userEvent.setup() installs its own navigator.clipboard stub, so the spy is
// attached AFTER setup — against whatever clipboard is live at that point.
let clipboardSpy;

const renderRoute = (path) => {
  window.history.pushState({}, "", path);
  return render(<App />);
};

const cleanLint = { clean: true, checks: [], char_count: 120, char_limit: 3000 };
const flaggedLint = {
  clean: false,
  checks: [
    { id: "markdown", severity: "error", message: "LinkedIn shows these markdown marks literally: **bold**" },
  ],
  char_count: 120,
  char_limit: 3000,
};
const warnOnlyLint = {
  clean: false,
  checks: [{ id: "unicode", severity: "warn", message: "unicode fake-bold" }],
  char_count: 120,
  char_limit: 3000,
};

const variantSet = {
  id: "vs1",
  variants: [
    { status: "ready", post_text: "Draft text about the trend.", brief_name: "Contrarian", brief_id: "contrarian" },
  ],
};

// Drives the loop to a picked variant, so the PostPreview copy button and
// the LinkedIn preview pane are on screen. `lint` is what /preview/linkedin
// answers for every call (the pane's debounced check and the copy gate).
const draftAndPick = async (lint) => {
  api.post.mockImplementation((url) => {
    if (url === "/research") return Promise.resolve({ raw_trends: [] });
    if (url === "/generate-ideas")
      return Promise.resolve({
        ideas: [{ title: "Trend one", rating: 8.5, rating_explanation: "Strong signal" }],
      });
    if (url === "/generate-variants") return Promise.resolve({ variant_set: variantSet });
    if (url === "/preview/linkedin")
      return lint instanceof Error ? Promise.reject(lint) : Promise.resolve(lint);
    return Promise.resolve({});
  });
  const user = userEvent.setup();
  // Spy on the clipboard AFTER user-event's setup installs its own stub —
  // a module-scope mock would be replaced by it.
  clipboardSpy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  renderRoute("/dashboard");
  await screen.findByTestId("generate-ideas-btn");
  await user.click(screen.getByTestId("generate-ideas-btn"));
  await screen.findByText("Trend one");
  await user.click(screen.getByTestId("idea-card-0"));
  await user.click(screen.getByTestId("explore-formats-0-btn"));
  await user.click(screen.getByTestId("format-hot-take-btn"));
  await user.click(screen.getByTestId("craft-post-btn"));
  await user.click(await screen.findByTestId("variant-pick-0-btn"));
  // The fix renders the Board's preview pane under the picked draft — the
  // same checks, visible before the copy attempt.
  await screen.findByTestId("linkedin-preview");
  return user;
};

const lintCalls = () =>
  api.post.mock.calls.filter(([url]) => url === "/preview/linkedin").length;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("ideaforge_token", "tok");
  authMe.mockResolvedValue({ email: "dev@example.com", name: "Dev" });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("Dashboard copy path runs the LinkedIn lint (Honesty bundle fix 7)", () => {
  it("lints the draft before copying, then copies with the boundary line", async () => {
    const user = await draftAndPick(cleanLint);
    await user.click(screen.getByTestId("copy-post-btn"));

    await waitFor(() => expect(lintCalls()).toBeGreaterThan(0));
    await waitFor(() =>
      expect(clipboardSpy).toHaveBeenCalledWith("Draft text about the trend."),
    );
    expect(toast.success).toHaveBeenCalledWith(
      "Copied. Paste it into LinkedIn and post it yourself.",
    );
  });

  it("blocks the copy when an error-severity check fires, and says which", async () => {
    const user = await draftAndPick(flaggedLint);
    await user.click(screen.getByTestId("copy-post-btn"));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "LinkedIn shows these markdown marks literally: **bold**",
      ),
    );
    expect(clipboardSpy).not.toHaveBeenCalled();
  });

  it("copies with a notes reminder when only warn/info checks fire", async () => {
    const user = await draftAndPick(warnOnlyLint);
    await user.click(screen.getByTestId("copy-post-btn"));

    await waitFor(() =>
      expect(clipboardSpy).toHaveBeenCalledWith("Draft text about the trend."),
    );
    expect(toast.success).toHaveBeenCalledWith(
      "Copied with notes — review the checks under the post.",
    );
  });

  it("fails closed with an honest message when the linter is unreachable", async () => {
    const user = await draftAndPick(new Error("down"));
    await user.click(screen.getByTestId("copy-post-btn"));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "The LinkedIn checks didn't run, so nothing was copied. Try again.",
      ),
    );
    expect(clipboardSpy).not.toHaveBeenCalled();
  });
});
