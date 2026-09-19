import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import App from "../App";

// Honesty bundle fix 1: the Dashboard opens on the SAVED niche and tone —
// the Settings promise ("research scopes to your niche; drafts start from
// your tone") must hold across sessions. The Radix Select trigger displays
// the selected value's text, so the page's loaded state is observable
// without opening the dropdown.
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
    constructor({ status, kind, message, provider, detail }) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.kind = kind;
      this.provider = provider;
      this.detail = detail;
    }
  },
  isKeyIssueError: (e) =>
    ["missing_key", "auth", "quota", "cap"].includes(e?.kind),
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

const renderRoute = (path) => {
  window.history.pushState({}, "", path);
  return render(<App />);
};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("ideaforge_token", "tok");
  authMe.mockResolvedValue({ email: "dev@example.com", name: "Dev" });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("dashboard opens on the saved defaults (Honesty bundle fix 1)", () => {
  it("loads the saved niche and tone from preferences on mount", async () => {
    api.get.mockImplementation((url) => {
      if (url === "/auth/me") return authMe();
      if (url === "/preferences")
        return Promise.resolve({
          default_tone: "casual",
          default_niche: "Data Science",
          has_tavily_key: true,
        });
      return Promise.resolve({});
    });

    renderRoute("/dashboard");

    // The stored lowercase tone renders as the display-cased option —
    // the value the selector can actually show, not the raw stored string.
    // findBy* resolves on element EXISTENCE, which races the preferences
    // response: the selector is already mounted with the default before the
    // saved values land, so the matcher must retry on content (both
    // selectors update in the same commit once the read resolves).
    const nicheSelector = await screen.findByTestId("niche-selector");
    await waitFor(() =>
      expect(nicheSelector).toHaveTextContent("Data Science"),
    );
    expect(screen.getByTestId("tone-selector-main")).toHaveTextContent(
      "Casual",
    );
  });

  it("keeps the honest defaults when a saved value is not one of the shipped options", async () => {
    api.get.mockImplementation((url) => {
      if (url === "/auth/me") return authMe();
      if (url === "/preferences")
        return Promise.resolve({
          default_tone: "whimsical",
          default_niche: "Fintech",
        });
      return Promise.resolve({});
    });

    renderRoute("/dashboard");

    // Unknown values are ignored, never guessed into the selectors.
    expect(await screen.findByTestId("niche-selector")).toHaveTextContent("AI");
    expect(screen.getByTestId("tone-selector-main")).toHaveTextContent(
      "Professional",
    );
  });

  it("keeps the honest defaults and stays usable when the preferences read fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    api.get.mockImplementation((url) => {
      if (url === "/auth/me") return authMe();
      if (url === "/preferences") return Promise.reject(new Error("down"));
      return Promise.resolve({});
    });

    renderRoute("/dashboard");

    // A failed read never blocks the first run — the empty-state dashboard
    // renders with the fallback defaults.
    expect(await screen.findByTestId("dashboard-empty-state")).toBeInTheDocument();
    expect(screen.getByTestId("niche-selector")).toHaveTextContent("AI");
    expect(consoleError).toHaveBeenCalledWith(
      "Preference load failed:",
      expect.any(Error),
    );
    consoleError.mockRestore();
  });
});
