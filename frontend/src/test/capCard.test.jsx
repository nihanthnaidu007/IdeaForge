// Bundled-key cap surface (Wave 1): the typed 429 normalizes to the `cap`
// kind with structured allowance facts, and ErrorState renders the honest
// card — allowance, reset time, ONE primary action routing to Settings.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { normalizeApiError } from "../api/client";
import { ErrorState } from "../components/states/AsyncStates";

const capResponse = {
  response: {
    status: 429,
    headers: { "retry-after": "8127" },
    data: {
      detail:
        "Today's bundled allowance is spent (25 calls). It resets at 2026-09-19 00:00 UTC. Add your own API key in Settings for unlimited use.",
      kind: "USAGE_CAP_EXCEEDED",
      provider: "openai",
      resource: "llm",
      allowance: 25,
      resets_at: "2026-09-19T00:00:00Z",
      request_id: "req-caps-1",
    },
  },
};

const renderCard = (error) =>
  render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <Routes>
        <Route
          path="/dashboard"
          element={<ErrorState error={error} onRetry={() => {}} />}
        />
        <Route path="/settings" element={<div data-testid="settings-page" />} />
      </Routes>
    </MemoryRouter>,
  );

describe("cap error normalization", () => {
  it("maps the USAGE_CAP_EXCEEDED envelope to the cap kind with typed facts", () => {
    const err = normalizeApiError(capResponse);
    expect(err.kind).toBe("cap");
    expect(err.status).toBe(429);
    expect(err.caps).toEqual({
      allowance: 25,
      resetsAt: "2026-09-19T00:00:00Z",
      resource: "llm",
    });
    // The backend's honest detail is the message — no rewording client-side.
    expect(err.message).toContain("25 calls");
  });

  it("carries the Retry-After header as retryAfter", () => {
    const err = normalizeApiError(capResponse);
    expect(err.retryAfter).toBe(8127);
  });
});

describe("cap error card", () => {
  it("states the allowance and reset from typed fields, with one Settings action", async () => {
    const err = normalizeApiError(capResponse);
    const user = (await import("@testing-library/user-event")).default.setup();
    renderCard(err);

    const card = screen.getByTestId("key-issue-state");
    // Allowance stated as a number with a unit, from the typed field —
    // never parsed from a string.
    expect(card).toHaveTextContent(/25 AI generation calls/);
    expect(card).toHaveTextContent(/It resets /);
    // Exactly one primary action: the BYOK recovery path.
    const action = screen.getByTestId("error-open-settings-btn");
    expect(action).toHaveTextContent(/Add your own key/i);
    await user.click(action);
    expect(await screen.findByTestId("settings-page")).toBeInTheDocument();
  });

  it("falls back to the backend message when cap fields are absent", () => {
    renderCard(
      normalizeApiError({
        response: {
          status: 429,
          headers: {},
          data: {
            detail: "Today's bundled allowance is spent (10 calls).",
            kind: "USAGE_CAP_EXCEEDED",
            provider: "tavily",
          },
        },
      }),
    );
    // No allowance facts → no composed body, no invented numbers.
    expect(screen.getByTestId("key-issue-state")).toHaveTextContent(
      /Today's bundled allowance is spent \(10 calls\)\./,
    );
    expect(screen.queryByText(/no cap/)).not.toBeInTheDocument();
  });
});
