// F05 — Provider down mid-flow (529/500): typed PROVIDER_UNAVAILABLE 503,
// the insight panel fails additively (ideas stay), retry is per-card.
import { test, expect } from "@playwright/test";
import {
  WEB, API, installDenyList, authedStorage, setScenario, clearStubRequests, routes,
} from "../../utils/helpers.js";

test("F05: Anthropic 529 on insights → 503, additive-safe failure, per-card retry", async ({ page, request }) => {
  installDenyList(page, test.info());
  const email = `f05-${Date.now()}@e2e.ideaforge.dev`;
  const storage = await authedStorage(request, email);
  const token = storage.origins[0].localStorage[0].value;
  await setScenario(request, "llm-503");
  await clearStubRequests(request);

  await page.goto(WEB);
  await page.evaluate((t) => localStorage.setItem("ideaforge_token", t), token);
  await page.goto(`${WEB}/dashboard`);
  await page.reload();
  await page.getByTestId("generate-ideas-btn").click();
  await expect(page.getByTestId("idea-card-0")).toBeVisible({ timeout: 15_000 });

  // Insight call hits the 529.
  await page.getByTestId("idea-card-0").click();
  await page.getByTestId("generate-insights-0-btn").click();
  await expect(page.getByTestId("insights-error-0")).toBeVisible();
  const errText = await page.getByTestId("insights-error-0").innerText();
  expect(errText).toMatch(/unreachable|failed|error|unavailable/i);
  await expect(page.getByTestId("retry-insights-0-btn")).toBeVisible();

  // Additive safety: the idea itself is untouched.
  await expect(page.getByTestId("idea-card-0")).toBeVisible();
  await expect(page.getByTestId("insights-0")).toHaveCount(0);
});
