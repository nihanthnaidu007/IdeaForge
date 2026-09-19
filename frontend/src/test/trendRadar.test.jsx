import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import TrendRadar from "../components/dashboard/TrendRadar";

// Honesty bundle fix 2: the Trend Radar panel is scoped to the user's
// niche — its heading and subcopy must track the selected niche instead of
// the hardcoded "Tech & AI" that contradicted four of the five options.
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

const renderPanel = (niche) =>
  render(
    <TrendRadar
      niche={niche}
      onNicheChange={vi.fn()}
      tone="Professional"
      onToneChange={vi.fn()}
      loading={false}
      scanningText={null}
      scanningSub={null}
      costHint={null}
      onGenerate={vi.fn()}
    />,
  );

describe("TrendRadar heading tracks the selected niche (Honesty bundle fix 2)", () => {
  it("names the selected niche in the heading and subcopy", () => {
    renderPanel("Data Science");

    expect(screen.getByTestId("trend-radar-heading")).toHaveTextContent(
      "What's trending in Data Science right now?",
    );
    expect(
      screen.getByText(/Run research to pull what's moving in Data Science right now/),
    ).toBeInTheDocument();
    // The hardcoded niche is gone from the surface entirely.
    expect(screen.queryByText(/Tech & AI/)).not.toBeInTheDocument();
  });

  it("updates when the selected niche changes", () => {
    const { unmount } = renderPanel("AI");
    expect(screen.getByTestId("trend-radar-heading")).toHaveTextContent(
      "What's trending in AI right now?",
    );
    unmount();

    renderPanel("Web Dev");
    expect(screen.getByTestId("trend-radar-heading")).toHaveTextContent(
      "What's trending in Web Dev right now?",
    );
    expect(screen.queryByText(/Tech & AI/)).not.toBeInTheDocument();
  });
});
