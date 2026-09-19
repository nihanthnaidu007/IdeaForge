import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
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

const renderRoute = (path) => {
  window.history.pushState({}, "", path);
  render(<App />);
};

const expectLandingShell = async () => {
  const matches = await screen.findAllByText(
    // Pack §4.2 hero headline — appears in the hero and the bottom CTA.
    /Catch the trend while it/i,
    {},
    { timeout: 10000 }
  );
  expect(matches.length).toBeGreaterThan(0);
};

describe("App route shells", () => {
  it("renders the landing page at /", async () => {
    renderRoute("/");
    await expectLandingShell();
  });

  it("redirects unauthenticated /dashboard visits to the landing shell", async () => {
    renderRoute("/dashboard");
    await expectLandingShell();
  });

  it("redirects unauthenticated /saved visits to the landing shell", async () => {
    renderRoute("/saved");
    await expectLandingShell();
  });

  it("redirects unauthenticated /settings visits to the landing shell", async () => {
    renderRoute("/settings");
    await expectLandingShell();
  });
});
