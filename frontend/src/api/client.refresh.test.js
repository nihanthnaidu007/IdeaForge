import { describe, it, expect, vi } from "vitest";

// The interceptor contract under test lives in the real client module:
//   - provider-attributed 401s (PROVIDER_AUTH) reject to the caller — the
//     session is fine, so no refresh and no forced logout;
//   - session 401s trigger exactly one refresh attempt and, when it fails,
//     the unauthorized handler (forced logout).
// Stub axios so we can capture the client's response rejection handler and
// drive it directly.
const state = vi.hoisted(() => ({
  rejectHandler: undefined,
  refreshPost: undefined,
  retryRequest: undefined,
}));

vi.mock("axios", () => ({
  __esModule: true,
  default: {
    create: () => ({
      interceptors: {
        request: { use: () => {} },
        response: {
          use: (_ok, fail) => {
            state.rejectHandler = fail;
          },
        },
      },
      request: (...args) => state.retryRequest(...args),
    }),
    post: (...args) => state.refreshPost(...args),
  },
}));

import { isProviderAuthFailure, normalizeApiError, onUnauthorized } from "./client";

const sessionError = () => ({
  response: { status: 401, data: { detail: "Not authenticated" } },
  config: { url: "/saved", headers: {} },
});

const providerError = () => ({
  response: {
    status: 401,
    data: {
      detail: "The provider rejected this key — check Settings.",
      kind: "PROVIDER_AUTH",
      provider: "tavily",
    },
  },
  config: { url: "/keys/tavily/test", headers: {} },
});

describe("401 discrimination", () => {
  it("treats a provider-attributed 401 as a key failure, not a session failure", () => {
    const provider = normalizeApiError(providerError());
    const session = normalizeApiError(sessionError());

    expect(provider.kind).toBe("auth"); // mapped from the backend's PROVIDER_AUTH
    expect(provider.provider).toBe("tavily");
    expect(isProviderAuthFailure(provider)).toBe(true);

    expect(session.kind).toBe("auth");
    expect(session.provider).toBeUndefined();
    expect(isProviderAuthFailure(session)).toBe(false);
  });
});

describe("interceptor behavior", () => {
  it("rejects a provider-key 401 without refresh, retry, or forced logout", async () => {
    state.refreshPost = vi.fn();
    state.retryRequest = vi.fn();
    let loggedOut = 0;
    onUnauthorized(() => {
      loggedOut += 1;
    });

    await expect(state.rejectHandler(providerError())).rejects.toMatchObject({
      kind: "auth",
      provider: "tavily",
    });

    expect(state.refreshPost).not.toHaveBeenCalled();
    expect(state.retryRequest).not.toHaveBeenCalled();
    expect(loggedOut).toBe(0);
  });

  it("attempts exactly one refresh and fires the handler when it fails", async () => {
    localStorage.setItem("ideaforge_refresh", "r");
    state.refreshPost = vi.fn(async () => {
      throw new Error("refresh rejected");
    });
    state.retryRequest = vi.fn();
    let loggedOut = 0;
    onUnauthorized(() => {
      loggedOut += 1;
    });

    await expect(state.rejectHandler(sessionError())).rejects.toMatchObject({ kind: "auth" });

    expect(state.refreshPost).toHaveBeenCalledTimes(1);
    expect(state.retryRequest).not.toHaveBeenCalled();
    expect(loggedOut).toBe(1);
  });
});
