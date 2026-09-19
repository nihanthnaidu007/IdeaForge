import { describe, it, expect } from "vitest";
import { copyGateFor } from "@/lib/linkedinLint";

// Honesty bundle fix 7: the Dashboard copy gate. The lint verdict decides
// whether the copy proceeds — error-severity checks block, warn/info copy
// with a note, and no verdict never copies (fail closed: the checks must
// not be skippable on the most natural exit).
describe("copyGateFor — the Dashboard copy gate", () => {
  it("allows the copy with the boundary line when the lint is clean", () => {
    const gate = copyGateFor({ clean: true, checks: [], char_count: 120, char_limit: 3000 });
    expect(gate.allowed).toBe(true);
    expect(gate.message).toBe("Copied. Paste it into LinkedIn and post it yourself.");
  });

  it("blocks the copy with the first error check's message", () => {
    const gate = copyGateFor({
      clean: false,
      checks: [
        { id: "hashtags", severity: "info", message: "Hashtag restraint note." },
        { id: "markdown", severity: "error", message: "LinkedIn shows these markdown marks literally: **bold**" },
        { id: "whitespace", severity: "warn", message: "Long gaps collapse." },
      ],
    });
    expect(gate.allowed).toBe(false);
    expect(gate.message).toBe("LinkedIn shows these markdown marks literally: **bold**");
  });

  it("allows warn/info-only results with the notes reminder", () => {
    const gate = copyGateFor({
      clean: false,
      checks: [{ id: "unicode", severity: "warn", message: "unicode fake-bold" }],
    });
    expect(gate.allowed).toBe(true);
    expect(gate.message).toBe("Copied with notes — review the checks under the post.");
  });

  it("fails closed when no verdict exists — no silent skip", () => {
    expect(copyGateFor(null)).toEqual({
      allowed: false,
      message: "The LinkedIn checks didn't run, so nothing was copied. Try again.",
    });
    expect(copyGateFor(undefined)).toEqual({
      allowed: false,
      message: "The LinkedIn checks didn't run, so nothing was copied. Try again.",
    });
  });
});
