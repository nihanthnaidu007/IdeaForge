// J04 — Insight card → variants → hook swap, on a forged idea. Cost hints
// precede every spend; variants are materially distinct; the hook swap
// re-grounds the same draft without regenerating the argument.
import { test, expect } from "@playwright/test";
import {
  WEB, installDenyList, authedStorage, setScenario, stubRequests, clearStubRequests,
} from "../../utils/helpers.js";

test("J04: insights → variants → hook swap with cost hints", async ({ page, request }) => {
  installDenyList(page, test.info());
  const email = `j04-${Date.now()}@e2e.ideaforge.dev`;
  const storage = await authedStorage(request, email);
  await setScenario(request, "forge-happy");
  await clearStubRequests(request);

  await page.goto(WEB);
  await page.evaluate((token) => localStorage.setItem("ideaforge_token", token), storage.origins[0].localStorage[0].value);
  await page.reload();
  await expect(page).toHaveURL(/dashboard|\/$/);
  await page.goto(`${WEB}/dashboard`);
  await expect(page.getByTestId("generate-ideas-btn")).toBeVisible();

  await page.getByTestId("generate-ideas-btn").click();
  await expect(page.getByTestId("idea-card-0")).toBeVisible();

  // Insight card: cost hint BEFORE the spend, then the validated card.
  await page.getByTestId("idea-card-0").click();
  await expect(page.getByTestId("insights-idle-0")).toBeVisible();
  await expect(page.getByTestId("insights-cost-hint-0")).toBeVisible();
  await page.getByTestId("generate-insights-0-btn").click();
  await expect(page.getByTestId("insights-0")).toBeVisible();
  await expect(page.getByTestId("insights-0")).toContainText("Platform and ML-engineering leads");
  await expect(page.getByTestId("insights-0")).toContainText("golden set");

  // Variants: three distinct drafts on the selected format.
  await page.getByTestId("format-hot_take-btn").click();
  await page.getByTestId("craft-post-btn").click();
  await expect(page.getByTestId("variant-column-0")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("variant-column-1")).toBeVisible();
  await expect(page.getByTestId("variant-column-2")).toBeVisible();
  await expect(page.getByTestId("variant-column-0")).toContainText("cheaper than the incident");
  await expect(page.getByTestId("variant-column-1")).toContainText("CI red on drift");
  await expect(page.getByTestId("variant-column-2")).toContainText("Data quality surprises");

  // Pick a variant, then swap the hook: the body argument survives, the
  // opening changes to the H09 pattern.
  await page.getByTestId("variant-pick-0-btn").click();
  await expect(page.getByTestId("variant-picked-note")).toBeVisible();

  await page.getByTestId("hook-picker").click();
  const h09 = page.getByText(/H09/).first();
  await h09.click();
  await page.waitForTimeout(1200);
  await expect(page.getByTestId("variant-column-0")).toContainText("Nobody asks about eval budgets");

  // Wire-level: the swap request reached the stub as a 6th+ Anthropic call.
  const records = await stubRequests(request);
  const anthropic = records.filter((r) => r.provider === "anthropic");
  expect(anthropic.length).toBeGreaterThanOrEqual(6); // ideas, insight, 3 variants, swap
});
