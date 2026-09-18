import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import VoiceDNAEditor from "@/components/settings/VoiceDNAEditor";
import HookPicker from "@/components/dashboard/HookPicker";

// jsdom lacks matchMedia; sonner's Toaster calls it.
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

// Mock the api client at the module seam, per the componentization PR's
// test pattern — no network, no backend, deterministic state driving.
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
    constructor({ status, kind, message, provider, detail } = {}) {
      super(message ?? "Request failed");
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
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

import { api, ApiError } from "@/api/client";
import { toast } from "sonner";

// CRUD flows assert the toast contract (success/error) directly, so sonner is
// mocked at the module seam like board.test.jsx does — no Toaster, no jsdom
// matchMedia dance, deterministic assertions.
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const activeProfileResponse = {
  profile: {
    structure: {
      opening_pattern: "Opens on a number or a contrary one-liner.",
      body_pattern: "Two to four short assertion paragraphs.",
      closing_pattern: "Ends on the last assertion itself.",
      paragraph_style: "One- to two-sentence paragraphs.",
      line_break_habit: "beat_based",
    },
    vocabulary: {
      register: "Technical-casual.",
      jargon_level: "light",
      signature_phrases: ["Nobody asks about"],
      verb_energy: "Declarative and short.",
    },
    energy: {
      overall_level: 6,
      punctuation_style: "No exclamation marks.",
      emoji_use: "none",
      emphasis_tactics: "Bare assertion.",
    },
    signature_moves: [
      {
        move: "Leads with a measured before/after from own data.",
        evidence: "We cut eval time from 3 days to 40 minutes.",
      },
    ],
  },
  sentence_rhythm: { avg_sentence_length_words: 9.4, variation: "Short with punch lines.", fragment_use: "occasional" },
  do_list: ["Open on a number or a contrary one-liner; never open with context."],
  dont_list: ["Never use emoji or exclamation marks."],
  notes: "All samples are the same format.",
  confidence: 0.82,
  sample_count: 3,
  source: "extraction",
  version: 2,
  total_versions: 2,
  extracted_at: "2026-09-17T12:00:00Z",
};

const hookListResponse = {
  hooks: [
    {
      id: "H01",
      text_pattern: "Unpopular opinion: {claim}.",
      style: "contrarian",
      format: "hot_take",
      tags: ["bold", "low_risk"],
      is_builtin: true,
    },
    {
      id: "H09",
      text_pattern: "{stat}. That number isn't the story. What it says about {topic} is.",
      style: "data",
      format: "hot_take",
      tags: ["requires_source", "high_specificity"],
      is_builtin: true,
    },
    {
      id: "H10",
      text_pattern: "I analyzed {n} {artifacts} from {own context}. {Finding} showed up more than anything else.",
      style: "data",
      format: "hot_take",
      tags: ["requires_own_data", "high_specificity"],
      is_builtin: true,
    },
  ],
  count: 3,
};

// Same list plus a user-saved pattern — makes the "filters exclude
// everything" empty state reachable (the Mine chip alone isn't enough).
const hookListWithUserHook = {
  hooks: [
    ...hookListResponse.hooks,
    {
      id: "H52",
      text_pattern: "My own pattern about {topic}.",
      style: "data",
      format: "hot_take",
      tags: [],
      is_builtin: false,
      user_id: "usr_test",
    },
  ],
  count: 4,
};

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockResolvedValue({});
  api.post.mockResolvedValue({});
  api.put.mockResolvedValue({});
  api.delete.mockResolvedValue({});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("VoiceDNAEditor", () => {
  it("renders the pack's empty state with cost hint and a disabled CTA until 3 samples are pasted", async () => {
    api.get.mockResolvedValue({ profile: null, versions: [] });
    render(<VoiceDNAEditor />);

    await waitFor(() => {
      expect(screen.getByTestId("voice-dna-empty")).toBeInTheDocument();
    });

    // §6.3 empty-state copy verbatim.
    expect(screen.getByText("IdeaForge doesn't know your voice yet.")).toBeInTheDocument();
    expect(
      screen.getByText(/Nobody else's posts, ever: samples must be yours\./),
    ).toBeInTheDocument();
    // §6 cost hint (AI pack #8, honest fallback for the price slot).
    expect(
      screen.getByText(/Voice extraction runs one model call on your key/),
    ).toBeInTheDocument();

    const cta = screen.getByTestId("voice-extract-btn");
    expect(cta).toBeDisabled();

    const input = screen.getByTestId("voice-samples-input");
    await userEvent.type(input, "Post one about evals.{enter}{enter}Post two about agents.{enter}{enter}Post three about retrieval.");

    expect(screen.getByTestId("voice-sample-count")).toHaveTextContent("3 posts detected.");
    expect(screen.getByTestId("voice-extract-btn")).toBeEnabled();
  });

  it("posts the parsed samples on extract, shows the progress copy, and renders the profile on success", async () => {
    api.get.mockResolvedValue({ profile: null, versions: [] });
    // Deferred so the transient loading state is observable before resolve.
    let resolveExtract;
    api.post.mockImplementation(
      () => new Promise((resolve) => { resolveExtract = resolve; }),
    );
    render(<VoiceDNAEditor />);

    const input = await screen.findByTestId("voice-samples-input");
    await userEvent.type(input, "Sample A.\n\nSample B.\n\nSample C.");
    await userEvent.click(screen.getByTestId("voice-extract-btn"));

    expect(api.post).toHaveBeenCalledWith("/voice/profile", {
      samples: ["Sample A.", "Sample B.", "Sample C."],
    });
    expect(
      screen.getByText(/Reading how you write — structure, vocabulary, energy/),
    ).toBeInTheDocument();
    expect(
      screen.getByText("This runs one model call on your key. The profile is editable after."),
    ).toBeInTheDocument();

    resolveExtract(activeProfileResponse);

    // Ready view: confidence word (never the decimal), do/don't rows, moves.
    await screen.findByTestId("voice-dna-profile");
    expect(screen.getByTestId("voice-confidence-chip")).toHaveTextContent("Confident");
    expect(
      screen.getByText("Confident — this profile is built on your real posts and matches them closely."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("voice-do-list")).toBeInTheDocument();
    expect(
      screen.getByText("Open on a number or a contrary one-liner; never open with context."),
    ).toBeInTheDocument();
    expect(screen.getByText(/Leads with a measured before\/after from own data\./)).toBeInTheDocument();
  });

  it("shows the pack's extraction-failure copy with retry, and the missing-key variant for 400s", async () => {
    api.get.mockResolvedValue({ profile: null, versions: [] });
    api.post.mockRejectedValue(
      new ApiError({ status: 502, kind: "generation_failed", message: "Voice extraction failed" }),
    );
    render(<VoiceDNAEditor />);

    const input = await screen.findByTestId("voice-samples-input");
    await userEvent.type(input, "Sample A.\n\nSample B.\n\nSample C.");
    await userEvent.click(screen.getByTestId("voice-extract-btn"));

    const alert = await screen.findByTestId("voice-extract-error");
    expect(alert).toHaveTextContent("Voice extraction failed.");
    expect(alert).toHaveTextContent(
      "Nothing was saved. If your samples are very short or very alike, add one more post and try again.",
    );
    expect(screen.getByTestId("voice-retry-btn")).toBeInTheDocument();

    // 400 missing_key renders the pack's "No generation key connected." line.
    api.post.mockRejectedValue(
      new ApiError({ status: 400, kind: "missing_key", message: "No key" }),
    );
    await userEvent.click(screen.getByTestId("voice-retry-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("voice-extract-error")).toHaveTextContent(
        "No generation key connected.",
      );
    });
  });

  it("saves edits through PUT and lists versions with restore-as-save", async () => {
    api.get.mockImplementation((url) => {
      if (url === "/voice/profile") return Promise.resolve(activeProfileResponse);
      if (url === "/voice/profile/versions")
        return Promise.resolve({
          versions: [
            { version: 2, sample_count: 3, confidence: 0.82, do_list: ["new"], dont_list: [], notes: "", extracted_at: "2026-09-17T12:00:00Z" },
            { version: 1, sample_count: 3, confidence: 0.6, do_list: ["old"], dont_list: [], notes: "", extracted_at: "2026-09-16T12:00:00Z" },
          ],
        });
      return Promise.resolve({});
    });
    api.put.mockResolvedValue({ ...activeProfileResponse, do_list: ["old"], version: 3, total_versions: 3 });
    render(<VoiceDNAEditor />);

    await screen.findByTestId("voice-dna-profile");
    await userEvent.click(screen.getByTestId("voice-history-toggle"));

    const history = await screen.findByTestId("voice-history");
    expect(history).toHaveTextContent("confidence high");
    expect(history).toHaveTextContent("confidence mid");
    // Newest first; the active version is marked Current, others restorable.
    const rows = within(history).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Current");
    expect(screen.getByTestId("voice-restore-1-btn")).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("voice-restore-1-btn"));
    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith("/voice/profile", {
        do_list: ["old"],
        dont_list: [],
        notes: "",
      });
    });
  });
});

describe("HookPicker", () => {
  it("loads hooks for the format and applies a selection", async () => {
    api.get.mockResolvedValue(hookListResponse);
    const onSelect = vi.fn();
    const { rerender } = render(
      <HookPicker format="hot-take" onSelect={onSelect} />,
    );

    await screen.findByTestId("hook-row-H01");
    expect(screen.getByText("Unpopular opinion: {claim}.")).toBeInTheDocument();
    // Request converts kebab frontend format to the backend's snake_case.
    expect(api.get).toHaveBeenCalledWith("/hooks?format=hot_take");

    await userEvent.click(screen.getByTestId("hook-use-H01"));
    // The contract is the hook ID (the Dashboard stores it and sends it as
    // hook_id) — not the hook object.
    expect(onSelect).toHaveBeenCalledWith("H01");

    // With the ID selected, the row flips to its Remove control.
    rerender(<HookPicker format="hot-take" selectedHookId="H01" onSelect={onSelect} />);
    expect(screen.getByTestId("hook-remove-H01")).toBeInTheDocument();
  });

  it("source-locks requires_source hooks without sourced claims", async () => {
    api.get.mockResolvedValue(hookListResponse);
    render(<HookPicker format="hot-take" hasSourcedClaims={false} />);

    await screen.findByTestId("hook-row-H09");
    const lockedRow = screen.getByTestId("hook-row-H09");
    // The lock is visible (chip), not just structural.
    expect(within(lockedRow).getByText("Source-locked")).toBeInTheDocument();
    expect(screen.queryByTestId("hook-use-H09")).not.toBeInTheDocument();

    // §6.2 reveal: the lock is an explainer, not a dead end.
    await userEvent.click(screen.getByTestId("hook-why-H09"));
    expect(screen.getByTestId("hook-why-text-H09")).toHaveTextContent(
      "Needs a sourced stat. This idea's trend context has no sources yet — run research or pick a trend with sources, then this hook unlocks.",
    );
  });

  it("unlocks requires_source hooks when the trend context carries a sourced claim", async () => {
    api.get.mockResolvedValue(hookListResponse);
    render(<HookPicker format="hot-take" hasSourcedClaims />);

    await screen.findByTestId("hook-use-H09");
    expect(screen.queryByTestId("hook-why-H09")).not.toBeInTheDocument();
  });

  it("flags requires_own_data hooks with the pack's amber warning", async () => {
    api.get.mockResolvedValue(hookListResponse);
    render(<HookPicker format="hot-take" hasSourcedClaims />);

    await screen.findByTestId("hook-row-H10");
    expect(screen.getByTestId("hook-own-data-H10")).toHaveTextContent(
      "Wants your own numbers — add your result, or it reads generic.",
    );
  });

  it("swaps a hook into the live draft with the cost line and reports the new post", async () => {
    api.get.mockResolvedValue(hookListResponse);
    api.post.mockResolvedValue({ post: "Rewritten draft" });
    const onSwapped = vi.fn();
    render(
      <HookPicker
        format="hot-take"
        originalPost="Current draft"
        idea={{ topic_title: "Eval debt" }}
        onSwapped={onSwapped}
      />,
    );

    expect(await screen.findByTestId("hooks-swap-cost-hint")).toHaveTextContent(
      "New hook, new draft — runs one model call on your key",
    );
    await userEvent.click(screen.getByTestId("hook-swap-H01"));
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith("/swap-hook", {
        original_post: "Current draft",
        hook_id: "H01",
        idea: { topic_title: "Eval debt" },
        format: "hot_take",
        tone: "professional",
      });
      expect(onSwapped).toHaveBeenCalledWith("Rewritten draft");
    });
  });

  it("renders the pack's load-failure state with retry", async () => {
    api.get.mockRejectedValue(
      new ApiError({ status: 503, kind: "unavailable", message: "API is unreachable" }),
    );
    render(<HookPicker format="hot-take" />);
    const errorBox = await screen.findByTestId("hooks-error");
    expect(errorBox).toHaveTextContent("The hook library didn't load.");
    expect(errorBox).toHaveTextContent(
      "Nothing was changed — built-ins and your saved patterns are safe in the database.",
    );

    // Retry recovers.
    api.get.mockResolvedValue(hookListResponse);
    await userEvent.click(screen.getByTestId("hooks-retry-btn"));
    await screen.findByTestId("hook-row-H01");
  });

  it("renders the pack's empty-mine state when no user hooks are saved", async () => {
    api.get.mockResolvedValue(hookListResponse);
    render(<HookPicker format="hot-take" />);

    await screen.findByTestId("hook-row-H01");
    await userEvent.click(screen.getByTestId("hook-mine-chip"));
    const mineEmpty = await screen.findByTestId("hooks-empty-mine");
    expect(mineEmpty).toHaveTextContent("You haven't saved any hooks yet.");
    // The body names only actions that exist: Save a copy lives on built-in
    // rows, Edit and Delete live on user rows once the copy lands.
    expect(mineEmpty).toHaveTextContent(
      'Use "Save a copy" on any built-in pattern — your copy lands here, where Edit and Delete work on it.',
    );
    await userEvent.click(screen.getByTestId("hooks-browse-builtins-btn"));
    await screen.findByTestId("hook-row-H01");
  });

  it("renders the pack's filtered-empty state when filters exclude everything", async () => {
    api.get.mockResolvedValue(hookListWithUserHook);
    render(<HookPicker format="hot-take" />);

    // Mine shows the user's saved pattern.
    await screen.findByTestId("hook-row-H01");
    await userEvent.click(screen.getByTestId("hook-mine-chip"));
    await screen.findByTestId("hook-row-H52");

    // …but no user hook matches the contrarian style → filters-empty.
    await userEvent.click(screen.getByTestId("hook-style-chip-contrarian"));
    const filteredEmpty = await screen.findByTestId("hooks-empty-filtered");
    expect(filteredEmpty).toHaveTextContent('No hooks match "contrarian".');
    await userEvent.click(screen.getByTestId("hooks-clear-filters-btn"));
    await screen.findByTestId("hook-row-H01");
  });

  it("toggles a style chip off on re-click instead of requiring the clear button", async () => {
    api.get.mockResolvedValue(hookListResponse);
    render(<HookPicker format="hot-take" />);

    await screen.findByTestId("hook-row-H01");

    // Filter to the data style: the contrarian H01 disappears…
    const dataChip = screen.getByTestId("hook-style-chip-data");
    await userEvent.click(dataChip);
    await screen.findByTestId("hook-row-H09");
    expect(screen.queryByTestId("hook-row-H01")).toBeNull();

    // …and re-clicking the pressed chip is a toggle-off (aria-pressed contract).
    await userEvent.click(dataChip);
    await screen.findByTestId("hook-row-H01");
    expect(dataChip).toHaveAttribute("aria-pressed", "false");
  });

  it("saves a copy of a built-in through POST /hooks and reveals it under Mine", async () => {
    // Mutable backing list simulates the backend: the POST inserts, the next
    // GET (the picker's refresh) returns the catalog plus the new user copy.
    const userCopy = {
      id: "U-copy1",
      text_pattern: "Unpopular opinion: {claim}.",
      style: "contrarian",
      format: "hot_take",
      tags: ["bold", "low_risk"],
      is_builtin: false,
      user_id: "usr_test",
    };
    const hooksNow = [...hookListResponse.hooks];
    api.get.mockImplementation(() =>
      Promise.resolve({ hooks: [...hooksNow], count: hooksNow.length }),
    );
    api.post.mockImplementation(() => {
      hooksNow.push(userCopy);
      return Promise.resolve(userCopy);
    });
    render(<HookPicker format="hot-take" />);

    await screen.findByTestId("hook-row-H01");
    await userEvent.click(screen.getByTestId("hook-save-copy-H01"));

    // The duplicate carries the built-in's pattern, style, format, and tags —
    // the backend derives requires_source itself (no route changes).
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith("/hooks", {
        text_pattern: "Unpopular opinion: {claim}.",
        style: "contrarian",
        format: "hot_take",
        tags: ["bold", "low_risk"],
      });
    });
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        "Copy saved to your Mine set — edit it there.",
      );
    });
    // The Mine view auto-reveals the duplicate — the empty state's promised
    // flow (save a copy from Built-ins, then edit it there).
    expect(await screen.findByTestId("hook-row-U-copy1")).toBeInTheDocument();
    expect(screen.getByTestId("hook-mine-chip")).toHaveAttribute("aria-pressed", "true");
  });

  it("surfaces a failed save-a-copy without touching the list", async () => {
    api.get.mockResolvedValue(hookListResponse);
    api.post.mockRejectedValue(
      new ApiError({ status: 422, kind: "validation", message: "Pattern is too long — 280 characters max." }),
    );
    render(<HookPicker format="hot-take" />);

    await screen.findByTestId("hook-row-H01");
    await userEvent.click(screen.getByTestId("hook-save-copy-H01"));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Pattern is too long — 280 characters max.");
    });
    // Nothing was changed: the catalog still renders, no Mine switch happened.
    expect(screen.getByTestId("hook-row-H01")).toBeInTheDocument();
    expect(screen.getByTestId("hook-mine-chip")).toHaveAttribute("aria-pressed", "false");
  });

  it("edits a user hook through the editor and PUTs only the pattern", async () => {
    api.get.mockResolvedValue(hookListWithUserHook);
    render(<HookPicker format="hot-take" />);

    await screen.findByTestId("hook-row-H52");

    await userEvent.click(screen.getByTestId("hook-mine-chip"));
    await userEvent.click(screen.getByTestId("hook-edit-H52"));

    // The editor opens pre-filled with the row's current pattern.
    const editor = await screen.findByTestId("hook-edit-input-H52");
    expect(editor).toHaveValue("My own pattern about {topic}.");

    // fireEvent, not userEvent.type: hook patterns use {placeholder} braces,
    // which userEvent would parse as special-key tokens.
    const nextPattern = "Rewritten pattern: {angle} without the throat-clearing";
    await userEvent.clear(editor);
    fireEvent.change(editor, { target: { value: nextPattern } });
    await userEvent.click(screen.getByTestId("hook-edit-save-H52"));

    // HookUpdate forbids extra fields — the PUT carries the pattern only.
    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith("/hooks/H52", {
        text_pattern: nextPattern,
      });
    });
    expect(toast.success).toHaveBeenCalledWith("Hook updated.");
    // Saved: the editor closes and the Mine list refreshes without a skeleton.
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(await screen.findByTestId("hook-row-H52")).toBeInTheDocument();
    expect(screen.queryByTestId("hook-edit-form-H52")).not.toBeInTheDocument();
  });

  it("blocks an edit below the pattern floor with an inline error and no request", async () => {
    api.get.mockResolvedValue(hookListWithUserHook);
    render(<HookPicker format="hot-take" />);

    await screen.findByTestId("hook-row-H52");
    await userEvent.click(screen.getByTestId("hook-mine-chip"));
    await userEvent.click(screen.getByTestId("hook-edit-H52"));

    const editor = await screen.findByTestId("hook-edit-input-H52");
    await userEvent.clear(editor);
    await userEvent.type(editor, "no");
    await userEvent.click(screen.getByTestId("hook-edit-save-H52"));

    expect(await screen.findByTestId("hook-edit-error-H52")).toHaveTextContent(
      "Pattern is required — at least 3 characters.",
    );
    expect(api.put).not.toHaveBeenCalled();
    // The user's draft stays on screen — a failed edit loses nothing.
    expect(screen.getByTestId("hook-edit-form-H52")).toBeInTheDocument();
  });

  it("blocks an edit above the pattern ceiling with an inline error and no request", async () => {
    api.get.mockResolvedValue(hookListWithUserHook);
    render(<HookPicker format="hot-take" />);

    await screen.findByTestId("hook-row-H52");
    await userEvent.click(screen.getByTestId("hook-mine-chip"));
    await userEvent.click(screen.getByTestId("hook-edit-H52"));

    const editor = await screen.findByTestId("hook-edit-input-H52");
    await userEvent.clear(editor);
    await userEvent.type(editor, `x${"y".repeat(280)}`);
    await userEvent.click(screen.getByTestId("hook-edit-save-H52"));

    expect(await screen.findByTestId("hook-edit-error-H52")).toHaveTextContent(
      "Pattern is too long — 280 characters max.",
    );
    expect(api.put).not.toHaveBeenCalled();
  });

  it("deletes a user hook only after the inline confirm", async () => {
    api.get
      .mockResolvedValueOnce(hookListWithUserHook)
      .mockResolvedValueOnce(hookListResponse);
    render(<HookPicker format="hot-take" />);

    await screen.findByTestId("hook-row-H52");
    await userEvent.click(screen.getByTestId("hook-mine-chip"));

    // First click asks: the confirm block appears, no DELETE yet.
    await userEvent.click(screen.getByTestId("hook-delete-H52"));
    expect(await screen.findByTestId("hook-delete-confirm-H52")).toHaveTextContent(
      "Delete this hook? This can't be undone.",
    );
    expect(api.delete).not.toHaveBeenCalled();

    // Second click commits.
    await userEvent.click(screen.getByTestId("hook-delete-confirm-btn-H52"));
    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith("/hooks/H52");
    });
    expect(toast.success).toHaveBeenCalledWith("Hook deleted.");
    // The picker stays in Mine, which now shows its honest empty state — no
    // silent filter flip. The empty state's affordance walks back to All.
    expect(await screen.findByTestId("hooks-empty-mine")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("hooks-browse-builtins-btn"));
    await screen.findByTestId("hook-row-H01");
    expect(screen.queryByTestId("hook-row-H52")).not.toBeInTheDocument();
  });

  it("cancel in the delete confirm makes no request and keeps the row", async () => {
    api.get.mockResolvedValue(hookListWithUserHook);
    render(<HookPicker format="hot-take" />);

    await screen.findByTestId("hook-row-H52");
    await userEvent.click(screen.getByTestId("hook-mine-chip"));
    await userEvent.click(screen.getByTestId("hook-delete-H52"));
    await userEvent.click(screen.getByTestId("hook-delete-cancel-H52"));

    expect(api.delete).not.toHaveBeenCalled();
    expect(screen.queryByTestId("hook-delete-confirm-H52")).not.toBeInTheDocument();
    expect(screen.getByTestId("hook-row-H52")).toBeInTheDocument();
  });
});
