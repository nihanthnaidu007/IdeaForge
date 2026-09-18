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
  await page.getByRole("option", { name: /RAG evals/i }).first().click();
  // The radix trigger reflects the pick — fail fast if the value never bound.
  await expect(page.getByTestId("metrics-idea-select")).toContainText(/RAG evals/i);

  // Manual entry: numbers only — the four count fields in DOM order.
  const numbers = page.getByTestId("metrics-form").locator('input[inputmode="numeric"]');
  await numbers.nth(0).fill("1200");
  await numbers.nth(1).fill("84");
  await numbers.nth(2).fill("12");
  await numbers.nth(3).fill("3");

  // Non-numeric input → the typed field error, no submit.
  await numbers.nth(0).fill("abc");
  await page.getByTestId("metrics-submit-btn").click();
  await expect(page.getByTestId("metrics-field-error")).toBeVisible();

  await numbers.nth(0).fill("1200");
  await page.getByTestId("metrics-submit-btn").click();

  // The logged numbers render; the comparison is honest about the zero baseline.
  await expect(page.getByTestId("manual-week-impressions")).toContainText("1200", { timeout: 15_000 });
  await expect(page.getByTestId("usage-comparison")).toBeVisible();
});
