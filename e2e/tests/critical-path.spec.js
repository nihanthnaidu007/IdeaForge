// Critical path — register → keys → research → forge → variants → save → board.
// Auth is API-seeded (J01 owns UI registration); the path asserts the shipped
// happy flow end to end on the production preview.
import { test, expect } from "@playwright/test";
import {
  WEB, API, installDenyList, authedStorage, setScenario, routes,
} from "../utils/helpers.js";

test("critical path: register → keys → research → forge → variants → save → board", async ({ page, request }) => {
  test.setTimeout(120_000);
  installDenyList(page, test.info());
  const email = `cp-${Date.now()}@e2e.ideaforge.dev`;
  const storage = await authedStorage(request, email);
  const token = storage.origins[0].localStorage[0].value;
  await setScenario(request, "forge-happy");

  // Keys: save a Tavily key through the shipped preferences API.
  const keyRes = await request.put(`${API}${routes.preferences.put}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { tavily_api_key: "e2e-tavily-user-key-1234567890" },
  });
  expect(keyRes.ok()).toBeTruthy();

  // Research + forge: the dashboard's one-click generate.
  await page.goto(WEB);
  await page.evaluate((t) => localStorage.setItem("ideaforge_token", t), token);
  await page.goto(`${WEB}/dashboard`);
  await page.reload();
  await page.getByTestId("generate-ideas-btn").click();
  await expect(page.getByTestId("idea-card-0")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("idea-card-4")).toBeAttached({ timeout: 10_000 });
  await expect(page.getByTestId("idea-card-0")).toContainText("RAG evals are the new unit tests");

  // Insights on the first card.
  await page.getByTestId("generate-insights-0-btn").click();
  await expect(page.getByTestId("insights-0")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("insights-0")).toContainText("golden set");

  // The format pick drives the variant generation (VariantCompare's picker).
  await page.getByTestId("format-hot-take-btn").click();
  await expect(page.getByText("Hot take: your RAG demo dies").first()).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("variant-pick-0-btn").click();
  await page.getByTestId("craft-post-btn").click();
  await expect(page.getByTestId("post-content")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("post-content")).toContainText("golden set");

  // Save with the post → the board shows the card.
  await page.getByTestId("save-with-post-btn").click();
  await page.waitForTimeout(800);
  await page.goto(`${WEB}/board`);
  await page.reload();
  await expect(page.getByTestId("board-card").first()).toBeVisible({ timeout: 10_000 });
});
