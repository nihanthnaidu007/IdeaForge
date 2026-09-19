import { describe, it, expect, vi } from "vitest";

// The F04 fix contract (art_vqwfyodR): the shared client carries a 30s
// deadline, and a timeout — an error with `request` set and no `response` —
// normalizes to the existing NETWORK typed state, so a wedged request exits
// the pending UI into the honest error card with its retry affordance.
const state = vi.hoisted(() => ({ createConfig: undefined }));

vi.mock("axios", () => ({
  __esModule: true,
  default: {
    create: (config) => {
      state.createConfig = config;
      return {
        interceptors: {
          request: { use: () => {} },
          response: { use: () => {} },
        },
        request: () => Promise.resolve({ data: {} }),
      };
    },
    post: () => Promise.reject(new Error("unused")),
  },
}));

import { normalizeApiError, ERROR_KINDS } from "./client";

const timeoutError = () => {
  const error = new Error("timeout of 30000ms exceeded");
  error.code = "ECONNABORTED"; // axios's timeout code
  error.request = { method: "POST", path: "/api/generate-ideas" };
  return error;
};

describe("client timeout contract", () => {
  it("bounds every request with the 30s deadline", () => {
    expect(state.createConfig?.timeout).toBe(30000);
  });

  it("maps a timeout to the existing NETWORK typed state", () => {
    const apiError = normalizeApiError(timeoutError());
    expect(apiError.kind).toBe(ERROR_KINDS.NETWORK);
    expect(apiError.status).toBe(0);
  });
});
