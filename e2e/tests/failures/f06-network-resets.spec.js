// F06 — Mid-flight network failure: full reset (all 3 queries) → typed
// RESEARCH_FAILED banner + zero cards; partial reset (1 of 3) → partial
// success semantics (the forge proceeds on what it got, no error banner).
import { test, expect } from "@playwright/test";
import {
  WEB, installDenyList, authedStorage, setScenario, stubRequests, clearStubRequests,
} from "../../utils/helpers.js";

test("F06a: all connections reset → typed network failure, zero cards", async ({ page, request }) => {
  installDenyList(page, test.info());
  const email = `f06-${Date.now()}@e2e.ideaforge.dev`;
  const storage = await authedStorage(request, email);
  const token = storage.origins[0].localStorage[0].value;
  await setScenario(request, "tavily-reset-all");
  await clearStubRequests(request);

  await page.goto(WEB);
  await page.evaluate((t) => localStorage.setItem("ideaforge_token", t), token);
  await page.goto(`${WEB}/dashboard`);
  await page.reload();
  await page.getByTestId("generate-ideas-btn").click();
  await page.waitForTimeout(1500);
  await expect(page.locator('[data-testid^="error-"]').first()).toBeVisible();
  const banner = await page.locator('[data-testid^="error-"]').first().innerText();
  expect(banner).toMatch(/failed|unreachable|network|Tavily/i);
  await expect(page.getByTestId(/^idea-card/)).toHaveCount(0);

  const records = await stubRequests(request);
  expect(records.filter((r) => r.provider === "tavily").length).toBeGreaterThanOrEqual(1);
});

test("F06b: one connection reset → partial success, forge proceeds", async ({ page, request }) => {
  installDenyList(page, test.info());
  const email = `f06b-${Date.now()}@e2e.ideaforge.dev`;
  const storage = await authedStorage(request, email);
  const token = storage.origins[0].localStorage[0].value;
  await setScenario(request, "tavily-reset-partial");
  await clearStubRequests(request);

  await page.goto(WEB);
  await page.evaluate((t) => localStorage.setItem("ideaforge_token", t), token);
  await page.goto(`${WEB}/dashboard`);
  await page.reload();
  await page.getByTestId("generate-ideas-btn").click();
  // Partial success: research returned what it got; the forge continues.
  await expect(page.getByTestId("idea-card-0")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-testid^="error-"]')).toHaveCount(0);

  const records = await stubRequests(request);
  expect(records.filter((r) => r.provider === "tavily")).toHaveLength(3);
});
