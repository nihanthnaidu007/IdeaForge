import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";

// jsdom lacks matchMedia; sonner's Toaster (via next-themes) calls it.
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

// Mock the api client so surfaces can be driven into loading/error/quota
// states without a backend. AuthContext shares this mock.
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

import { api, ApiError, ERROR_KINDS } from "@/api/client";

const renderRoute = (path) => {
  window.history.pushState({}, "", path);
  return render(<App />);
};

beforeEach(() => {
  localStorage.clear();
  authMe.mockResolvedValue({ email: "dev@example.com", name: "Dev" });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("componentization", () => {
  it("renders exactly one navbar on the landing page", async () => {
    renderRoute("/");
    expect(await screen.findByTestId("navbar")).toBeInTheDocument();
    expect(screen.getAllByTestId("navbar")).toHaveLength(1);
  });

  it("opens the shared auth modal from the navbar Sign In button", async () => {
    const user = userEvent.setup();
    renderRoute("/");
    await screen.findByTestId("navbar");

    await user.click(screen.getByTestId("nav-login-btn"));
    const modal = await screen.findByTestId("auth-modal");
    expect(modal).toBeInTheDocument();
    expect(screen.getByTestId("auth-email-input")).toBeInTheDocument();
  });

  it("renders the 404 page for unknown routes", async () => {
    renderRoute("/no-such-page");
    expect(await screen.findByTestId("not-found-page")).toBeInTheDocument();
    expect(screen.getByTestId("not-found-home-btn")).toBeInTheDocument();
  });

  it("shows an error state with retry when idea generation fails", async () => {
    // Authenticated: /auth/me returns a user
    localStorage.setItem("ideaforge_token", "tok");
    const user = userEvent.setup();
    renderRoute("/dashboard");
    await screen.findByTestId("generate-ideas-btn");

    // Fail the live research call with the backend's typed 502
    api.post.mockRejectedValueOnce(
      new ApiError({
        status: 502,
        kind: ERROR_KINDS.RESEARCH_FAILED,
        provider: "tavily",
        message: "The research service didn't return usable results — try again.",
      })
    );

    await user.click(screen.getByTestId("generate-ideas-btn"));

    // Honest failure — no fabricated trends, retry available. §3.2 card copy.
    const errorState = await screen.findByTestId("error-state");
    expect(errorState).toBeInTheDocument();
    expect(errorState).toHaveTextContent(/Research failed\./i);
    expect(errorState).toHaveTextContent(/Nothing was saved/i);
    expect(screen.getByTestId("error-retry-btn")).toBeInTheDocument();

    // Retry re-issues the research call (which chains into idea generation)
    api.post.mockResolvedValueOnce({ raw_trends: [] });
    await user.click(screen.getByTestId("error-retry-btn"));
    await waitFor(() =>
      expect(api.post.mock.calls.filter(([url]) => url === "/research")).toHaveLength(2)
    );
  });

  it("shows a quota state routing to Settings when the provider quota is hit", async () => {
    localStorage.setItem("ideaforge_token", "tok");
    const user = userEvent.setup();
    renderRoute("/dashboard");
    await screen.findByTestId("generate-ideas-btn");

    api.post.mockRejectedValueOnce(
      new ApiError({
        status: 402,
        kind: ERROR_KINDS.QUOTA,
        message: "Your provider account is out of credit — add balance or switch keys in Settings.",
      })
    );

    await user.click(screen.getByTestId("generate-ideas-btn"));

    const quotaState = await screen.findByTestId("key-issue-state");
    expect(quotaState).toBeInTheDocument();
    expect(quotaState).toHaveTextContent(/out of credit/i);

    // The key-issue CTA routes to Settings, not a pointless retry
    const settingsBtn = screen.getByTestId("error-open-settings-btn");
    expect(settingsBtn).toBeInTheDocument();
    await user.click(settingsBtn);
    expect(await screen.findByTestId("settings-skeleton")).toBeInTheDocument();
  });

  it("renders the cap card over old ideas when a refresh hits the bundled allowance", async () => {
    localStorage.setItem("ideaforge_token", "tok");
    const user = userEvent.setup();
    renderRoute("/dashboard");
    await screen.findByTestId("generate-ideas-btn");

    // First run succeeds: ideas land on screen (cap consumed 1/1)
    api.post.mockResolvedValueOnce({ raw_trends: [] });
    api.post.mockResolvedValueOnce({
      ideas: [{ title: "Trend one", rating: 8.5, rating_explanation: "Strong signal" }],
    });
    await user.click(screen.getByTestId("generate-ideas-btn"));
    expect(await screen.findByText("Trend one")).toBeInTheDocument();

    // Second run: the ideas call crosses the bundled allowance (typed 429)
    api.post.mockResolvedValueOnce({ raw_trends: [] });
    api.post.mockRejectedValueOnce(
      new ApiError({
        status: 429,
        kind: ERROR_KINDS.CAP,
        provider: "anthropic",
        message: "Today's bundled allowance is spent (1 calls). It resets at 2026-09-19 00:00 UTC. Add your own API key in Settings for unlimited use.",
        caps: { resource: "llm", allowance: 1, resetsAt: "2026-09-19T00:00:00+00:00" },
      })
    );
    await user.click(screen.getByTestId("generate-ideas-btn"));

    // The honest cap card renders — with allowance, reset, and the one
    // primary action — instead of collapsing into the stale-banner path.
    const capCard = await screen.findByTestId("key-issue-state");
    expect(capCard).toHaveTextContent(/Daily allowance spent\./i);
    expect(capCard).toHaveTextContent(/daily allowance of 1 AI generation calls/i);
    expect(capCard).toHaveTextContent(/no cap/i);
    const settingsBtn = screen.getByTestId("error-open-settings-btn");
    expect(settingsBtn).toHaveTextContent(/Add your own key/i);

    // Old ideas remain on screen below the card (nothing was overwritten)
    expect(screen.getByText("Trend one")).toBeInTheDocument();
  });

  it("renders the masked hint and the §5.3 failed test-key line on a rejected key", async () => {
    localStorage.setItem("ideaforge_token", "tok");
    const origGet = api.get.getMockImplementation();
    api.get.mockImplementation((url) => {
      if (url === "/auth/me") return authMe();
      if (url === "/preferences")
        return Promise.resolve({
          default_tone: "professional",
          default_niche: "AI",
          has_tavily_key: true,
          key_hints: { tavily: "****abcd" },
        });
      return Promise.resolve({});
    });

    try {
      const user = userEvent.setup();
      renderRoute("/settings");

      // §5.2: the masked hint comes from PR #9's key_hints map — the only
      // key-derived data any response carries.
      expect(await screen.findByTestId("tavily-key-hint")).toHaveTextContent("****abcd");

      // §5.3 failed state: the typed auth failure renders its verbatim line.
      api.post.mockRejectedValueOnce(
        new ApiError({
          status: 401,
          kind: ERROR_KINDS.AUTH,
          provider: "tavily",
          message: "The provider rejected this key — check Settings.",
        })
      );
      await user.click(screen.getByTestId("test-tavily-btn"));
      const line = await screen.findByTestId("tavily-test-line");
      expect(line).toHaveTextContent(
        "Key rejected — check for a paste error or a revoked key, then re-enter it."
      );
    } finally {
      api.get.mockImplementation(origGet);
    }
  });

  it("renders the §5.3 passed line when the provider accepts the key", async () => {
    localStorage.setItem("ideaforge_token", "tok");
    const origGet = api.get.getMockImplementation();
    api.get.mockImplementation((url) => {
      if (url === "/auth/me") return authMe();
      if (url === "/preferences")
        return Promise.resolve({ has_openai_key: true, key_hints: { openai: "****ef12" } });
      return Promise.resolve({});
    });

    try {
      const user = userEvent.setup();
      renderRoute("/settings");
      await screen.findByTestId("openai-key-hint");

      api.post.mockResolvedValueOnce({ provider: "openai", valid: true, hint: "****ef12" });
      await user.click(screen.getByTestId("test-openai-btn"));
      const line = await screen.findByTestId("openai-test-line");
      expect(line).toHaveTextContent("Key works — OpenAI accepted it just now.");
    } finally {
      api.get.mockImplementation(origGet);
    }
  });
});
