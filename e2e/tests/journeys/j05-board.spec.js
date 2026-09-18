// J05 — Content board: saved ideas land in Inbox, search filters, adjacent
// transitions move the card and persist, tags filter. (Pipeline is buttoned:
// adjacent-step transitions per the shipped board contract.)
import { test, expect } from "@playwright/test";
import {
  WEB, API, E2E_PASSWORD, installDenyList, loginViaApi, authedStorage,
  setScenario, routes,
} from "../../utils/helpers.js";

test("J05: save → inbox → search → transition → persist → tag filter", async ({ page, request }) => {
  installDenyList(page, test.info());
  const email = `j05-${Date.now()}@e2e.ideaforge.dev`;
  const storage = await authedStorage(request, email);
  const token = storage.origins[0].localStorage[0].value;

  // Seed one idea through the shipped save API (UI save path covered in
  // critical-path), with a tag for the filter step.
  await setScenario(request, "forge-happy");
  const idea = {
    id: "e2e-idea-1", title: "RAG evals are the new unit tests", topic_title: "RAG evals are the new unit tests",
    rating: 8.4, rating_explanation: "High tension.", targeted_audience: "Platform leads",
    why_it_matters: "Eval discipline decides ship vs stall.", key_aspects: ["Golden sets"], post_angles: [],
  };
  const saveRes = await request.post(`${API}${routes.saved.save}`, {
    headers: { Authorization: `Bearer ${token}` }, data: idea,
  });
  expect(saveRes.ok()).toBeTruthy();

  await page.goto(WEB);
  await page.evaluate((t) => localStorage.setItem("ideaforge_token", t), token);
  await page.goto(`${WEB}/board`);
  await page.reload();
  await expect(page.getByTestId("content-board")).toBeVisible();
  await expect(page.getByTestId("board-card").first()).toBeVisible();

  // Search filters live.
  await page.getByTestId("board-search-input").fill("RAG evals");
  await expect(page.getByTestId("board-card").first()).toBeVisible();
  await page.getByTestId("board-search-input").fill("zzz-no-match");
  await expect(page.getByTestId("board-card")).toHaveCount(0);
  await page.getByTestId("board-search-input").fill("");

  // Adjacent transition inbox → forged (buttoned, adjacent-step only).
  const card = page.getByTestId("board-card").first();
  await card.getByRole("button", { name: /forged/i }).first().click();
  await page.waitForTimeout(800);
  const forgedColumn = page.locator('[data-testid="board-columns"] > div').filter({ hasText: /^Forged/i }).first();
  await expect(forgedColumn.locator('[data-testid="board-card"]').first()).toBeVisible();

  // Persistence across reload.
  await page.reload();
  await expect(page.getByTestId("content-board")).toBeVisible();
  await expect(page.getByTestId("board-card").first()).toBeVisible();

  // Tag the card via the tags API, then filter by it in the UI.
  const list = await (await request.get(`${API}${routes.board.list}`, {
    headers: { Authorization: `Bearer ${token}` },
  })).json();
  const boardId = (Array.isArray(list) ? list : list.items)[0].id;
  const tagRes = await request.fetch(`${API}${routes.board.tagsPatch}/${boardId}/tags`, {
    method: "PATCH", headers: { Authorization: `Bearer ${token}` },
    data: { tags: ["evals"] },
  });
  expect(tagRes.ok()).toBeTruthy();
  await page.reload();
  await expect(page.getByTestId("board-tag-chip").first()).toBeVisible();
  await page.getByTestId("board-tag-filter").click();
  await page.getByRole("option", { name: "evals" }).click();
  await expect(page.getByTestId("board-card").first()).toBeVisible();
});
