// J09 — Honest analytics: the empty state first, then (after usage exists)
// the manual metrics form, validated entry, and the honest comparison.
import { test, expect } from "@playwright/test";
import {
  WEB, installDenyList, authedStorage, setScenario,
} from "../../utils/helpers.js";

test("J09: empty state → validated manual entry → summary + honest comparison", async ({ page, request }) => {
  test.setTimeout(120_000);
  installDenyList(page, test.info());
  const email = `j09-${Date.now()}@e2e.ideaforge.dev`;
  const storage = await authedStorage(request, email);
  const token = storage.origins[0].localStorage[0].value;
  await setScenario(request, "research-ok");

  await page.goto(WEB);
  await page.evaluate((t) => localStorage.setItem("ideaforge_token", t), token);
  await page.goto(`${WEB}/analytics`);
  await page.reload();
  // Fresh account: the honest empty state, no fabricated numbers.
  await expect(page.getByTestId("analytics-empty")).toBeVisible();

  // Generate ideas so usage events exist — the summary renders after that.
  await page.goto(`${WEB}/dashboard`);
  await page.getByTestId("generate-ideas-btn").click();
  await expect(page.getByTestId("idea-card-0")).toBeVisible({ timeout: 20_000 });
  // The analytics idea picker lists SAVED ideas — save one first.
  await page.getByTestId("idea-card-0").click();
  await page.getByTestId("save-idea-0-btn").click();
  await page.waitForTimeout(600);

  await page.goto(`${WEB}/analytics`);
  await page.reload();
  await expect(page.getByTestId("metrics-form")).toBeVisible({ timeout: 15_000 });

  // Pick the idea first — the submit is disabled without one.
  await page.getByTestId("metrics-idea-select").click();
  // Scope to the Radix portal's listbox: the trigger embeds an aria-hidden
  // native <select> whose <option> elements also match getByRole("option").
  await page.getByRole("listbox").getByRole("option", { name: /RAG evals/i }).click({ timeout: 10_000 });
  // The radix trigger reflects the pick — fail fast if the value never bound.
  await expect(page.getByTestId("metrics-idea-select")).toContainText(/RAG evals/i);
  // Disabled means onValueChange never fired — a crisp assertion here beats a
  // 120s submit-click timeout.
  await expect(page.getByTestId("metrics-submit-btn")).toBeEnabled();

  // Manual entry: numbers only — the four count fields in DOM order.
  const numbers = page.getByTestId("metrics-form").locator('input[inputmode="numeric"]');
  await numbers.nth(0).fill("1200");
  await numbers.nth(1).fill("84");
  await numbers.nth(2).fill("12");
  await numbers.nth(3).fill("3");

  // Non-numeric input → the typed field error at change time; the controlled
  // field keeps its last valid value, so garbage never enters the app state.
  await numbers.nth(0).fill("abc");
  await expect(page.getByTestId("metrics-field-error")).toBeVisible();

  // Correcting the field clears the error. The correction must be a DIFFERENT
  // value: the controlled field reverted to "1200" when the garbage was
  // rejected, and a same-value fill never fires React's onChange (the value
  // tracker dedupes it), so the error would stay. "1300" clears it; the final
  // "1200" below is a real change again and is what the submit logs.
  await numbers.nth(0).fill("1300");
  await expect(page.getByTestId("metrics-field-error")).toBeHidden();
  await numbers.nth(0).fill("1200");

  // Submit logs the results. A successful log refreshes the summary and the
  // form remounts with a fresh idea pick (the shipped reset) — one submit
  // per entry, so this is the spec's only submit click.
  await page.getByTestId("metrics-submit-btn").click();

  // The logged numbers render; the comparison is honest about the zero baseline.
  await expect(page.getByTestId("manual-week-impressions")).toContainText("1200", { timeout: 15_000 });
  await expect(page.getByTestId("usage-comparison")).toBeVisible();
});
