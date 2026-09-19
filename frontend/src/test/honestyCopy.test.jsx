import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../App";
import ContentBoard from "@/components/board/ContentBoard";

// Honesty bundle fix 3: the landing's pricing story carries only sourced
// claims (the unsourced "less than a coffee" is banned), BYOK is spelled
// as the acronym the rest of the product uses, and the Board's empty state
// names the affordance that actually exists (explicit moves, not drag).
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
    get: vi.fn((url) => {
      if (url === "/board") return Promise.resolve([]);
      if (url === "/board/tags") return Promise.resolve([]);
      return Promise.resolve({});
    }),
    post: vi.fn().mockResolvedValue({}),
    patch: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("landing pricing claims are sourced (Honesty bundle fix 3)", () => {
  it("states the craft-pack comparison instead of the unsourced coffee claim", async () => {
    window.history.pushState({}, "", "/");
    render(<App />);

    // The sourced comparison lands in the pricing section.
    expect(
      await screen.findByText(/the AI-capable LinkedIn tools this replaces charge \$20–199\/month/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Taplio's cheapest AI tier is \$69\/month/i),
    ).toBeInTheDocument();

    // The banned unsourced claim is gone.
    expect(screen.queryByText(/less than a coffee/i)).not.toBeInTheDocument();
  });

  it("spells BYOK as the acronym, everywhere it appears", async () => {
    window.history.pushState({}, "", "/");
    render(<App />);

    expect(await screen.findByText("BYOK Pricing")).toBeInTheDocument();
    // No stray "Byok" (title-case misspelling) survives anywhere.
    const byok = screen.queryAllByText((_, el) => el?.textContent === "Byok Pricing");
    expect(byok).toHaveLength(0);
  });
});

describe("board empty state names the real affordance (Honesty bundle fix 3)", () => {
  it("says move, not drag — the board is button-driven", async () => {
    render(
      <MemoryRouter>
        <ContentBoard onPreview={vi.fn()} onSchedule={vi.fn()} onExport={vi.fn()} />
      </MemoryRouter>,
    );

    const empty = await screen.findByTestId("board-empty");
    expect(empty).toHaveTextContent(/ready to move toward Ready/);
    expect(empty).not.toHaveTextContent(/drag/i);
  });
});
