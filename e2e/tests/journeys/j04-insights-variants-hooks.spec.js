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

  // Insights: expand the collapsed card, then generate.
  await page.getByTestId("idea-card-0").click();
  await page.getByTestId("generate-insights-0-btn").click();
  await expect(page.getByTestId("insights-0")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("insights-0")).toContainText("golden set");

  // Shipped selection flow: Explore Post Formats calls selectIdea — the
  // FormatPicker (and format-hot-take-btn) render only after it.
  await page.getByTestId("explore-formats-0-btn").click();

  // The format pick opens VariantCompare; drafting the three variants is the
  // shipped manual step — the craft button inside the compare panel.
  await page.getByTestId("format-hot-take-btn").click();
  await page.getByTestId("craft-post-btn").click();
  await expect(page.getByTestId("variant-column-0")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("variant-column-0")).toContainText("Hot take: your RAG demo dies");

  // Pick a variant — the post preview renders the picked draft directly.
  await page.getByTestId("variant-pick-0-btn").click();
  await expect(page.getByTestId("post-content")).toBeVisible({ timeout: 20_000 });

  // Hook swap: swap a hook into the draft — the cost hint and the new
  // hook's copy both appear.
  await page.locator('[data-testid^="hook-swap-"]').first().click();
  await expect(page.getByTestId("hooks-swap-cost-hint")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("post-content")).toContainText("Nobody asks about eval budgets", { timeout: 15_000 });
});
