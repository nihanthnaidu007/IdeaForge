// J05 — Content board: save → inbox card → search filter → adjacent-step
// transition (board-move-<id>-forged) → persist across reload → tag filter.
import { test, expect } from "@playwright/test";
import {
  WEB, API, installDenyList, authedStorage, setScenario, routes,
} from "../../utils/helpers.js";

const IDEA = {
  id: "e2e-idea-1", title: "RAG evals are the new unit tests", topic_title: "RAG evals are the new unit tests",
  rating: 8.4, rating_explanation: "High tension.", targeted_audience: "Platform leads",
  why_it_matters: "Eval discipline decides ship vs stall.", key_aspects: ["Golden sets"],
  post_angles: [], tags: ["evals"],
};

test("J05: inbox → search → transition → persist → tag filter", async ({ page, request }) => {
  installDenyList(page, test.info());
  const email = `j05-${Date.now()}@e2e.ideaforge.dev`;
  const storage = await authedStorage(request, email);
  const token = storage.origins[0].localStorage[0].value;
  await setScenario(request, "forge-happy");

  const saveRes = await request.post(`${API}${routes.saved.save}`, {
    headers: { Authorization: `Bearer ${token}` }, data: IDEA,
  });
  expect(saveRes.ok()).toBeTruthy();

  await page.goto(WEB);
  await page.evaluate((t) => localStorage.setItem("ideaforge_token", t), token);
  await page.goto(`${WEB}/board`);
  await page.reload();
  await expect(page.getByTestId("board-card")).toBeVisible();
  await expect(page.getByTestId("board-card")).toContainText("RAG evals are the new unit tests");

  // Search narrows the board.
  await page.getByTestId("board-search-input").fill("RAG evals");
  await expect(page.getByTestId("board-card")).toBeVisible();
  await page.getByTestId("board-search-input").fill("zzz-no-match-zzz");
  await expect(page.getByTestId("board-card")).toHaveCount(0);
  await page.getByTestId("board-search-input").fill("");

  // Adjacent-step transition inbox → forged. The server assigns idea ids,
  // so match the move button by prefix/suffix, not by my fixture id.
  const moveBtn = page.locator('[data-testid^="board-move-"][data-testid$="-forged"]').first();
  const moveTestId = await moveBtn.getAttribute("data-testid");
  await moveBtn.click();
  // The board refetches after the transition — the moved card's button set
  // no longer offers "forged".
  await expect(page.locator(`[data-testid="${moveTestId}"]`)).toHaveCount(0, { timeout: 10_000 });
  await page.reload();
  await expect(page.getByTestId("board-card")).toBeVisible();
  // The transition persisted across reload.
  await expect(page.locator(`[data-testid="${moveTestId}"]`)).toHaveCount(0);

  // Tag filter narrows and restores.
  await page.getByTestId("board-tag-filter").click();
  await page.getByRole("option", { name: /evals/i }).first().click();
  await expect(page.getByTestId("board-card").first()).toBeVisible();
});
