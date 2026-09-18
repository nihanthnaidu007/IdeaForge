// J04 — Insights → variants → hook swap with cost hints. The variants panel
// follows insights; the hook picker swaps a hook into the draft with the
// §6.5 cost line; the post content reflects the swap.
import { test, expect } from "@playwright/test";
import {
  WEB, installDenyList, authedStorage, setScenario,
} from "../../utils/helpers.js";

test("J04: insights → variants → hook swap with cost hints", async ({ page, request }) => {
  test.setTimeout(120_000);
  installDenyList(page, test.info());
  const email = `j04-${Date.now()}@e2e.ideaforge.dev`;
  const storage = await authedStorage(request, email);
  await setScenario(request, "forge-happy");

  await page.goto(WEB);
  await page.evaluate((t) => localStorage.setItem("ideaforge_token", t), storage.origins[0].localStorage[0].value);
  await page.goto(`${WEB}/dashboard`);
  await page.reload();
  await page.getByTestId("generate-ideas-btn").click();
  await expect(page.getByTestId("idea-card-0")).toBeVisible({ timeout: 20_000 });

  // Insights: fixture content renders in the card's insight panel.
  await page.getByTestId("generate-insights-0-btn").click();
  await expect(page.getByTestId("insights-0")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("insights-0")).toContainText("golden set");

  // The format pick drives the variant generation; three distinct drafts.
  await page.getByTestId("format-hot-take-btn").click();
  await expect(page.getByText("Hot take: your RAG demo dies").first()).toBeVisible({ timeout: 30_000 });

  // Pick a variant, craft the post — the hook picker lives in the post flow.
  await page.getByTestId("variant-pick-0-btn").click();
  await page.getByTestId("craft-post-btn").click();
  await expect(page.getByTestId("post-content")).toBeVisible({ timeout: 20_000 });

  // Hook swap: swap a hook into the draft — the cost hint and the new
  // hook's copy both appear.
  await page.locator('[data-testid^="hook-swap-"]').first().click();
  await expect(page.getByTestId("hooks-swap-cost-hint")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("post-content")).toContainText("Nobody asks about eval budgets", { timeout: 15_000 });
});
