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
});
