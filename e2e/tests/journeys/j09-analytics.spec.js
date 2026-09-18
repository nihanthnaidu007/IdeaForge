// J09 — Honest analytics: empty state first, manual entry with validation
// (negative rejected), summary renders, comparison stays honest.
import { test, expect } from "@playwright/test";
import {
  WEB, API, installDenyList, authedStorage, setScenario, routes,
} from "../../utils/helpers.js";

async function seedIdea(request, token) {
  const saveRes = await request.post(`${API}${routes.saved.save}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      id: "e2e-idea-1", title: "RAG evals are the new unit tests", topic_title: "RAG evals are the new unit tests",
      rating: 8.4, rating_explanation: "High tension.", targeted_audience: "Platform leads",
      why_it_matters: "Eval discipline decides ship vs stall.", key_aspects: ["Golden sets"], post_angles: [],
    },
  });
  expect(saveRes.ok()).toBeTruthy();
}

test("J09: empty state → validated manual entry → summary + honest comparison", async ({ page, request }) => {
  installDenyList(page, test.info());
  const email = `j09-${Date.now()}@e2e.ideaforge.dev`;
  const storage = await authedStorage(request, email);
  const token = storage.origins[0].localStorage[0].value;
  await setScenario(request, "forge-happy");
  await seedIdea(request, token);

  await page.goto(WEB);
  await page.evaluate((t) => localStorage.setItem("ideaforge_token", t), token);
  await page.goto(`${WEB}/analytics`);
  await page.reload();
  await expect(page.getByTestId("analytics-empty")).toBeVisible();

  // Negative input → field error, nothing submitted.
  await page.getByTestId("metrics-form").scrollIntoViewIfNeeded();
  await page.getByTestId("metrics-idea-select").click();
  await page.getByRole("option", { name: /RAG evals/ }).first().click();
  await page.getByTestId("metrics-date-input").fill("2026-09-18");
  const numbers = page.getByTestId("metrics-form").locator('input[type="number"]');
  await numbers.nth(0).fill("-5");
  await numbers.nth(1).fill("12");
  await page.getByTestId("metrics-submit-btn").click();
  await expect(page.getByTestId("metrics-field-error")).toBeVisible();

  // Valid entry lands in the summary.
  await numbers.nth(0).fill("4200");
  await numbers.nth(1).fill("12");
  await page.getByTestId("metrics-submit-btn").click();
  await page.waitForTimeout(1000);
  await expect(page.getByTestId("usage-comparison")).toBeVisible();
  await expect(page.getByTestId("manual-section")).toBeVisible();
  await expect(page.getByTestId("analytics-empty")).toHaveCount(0);
});
