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

// A second idea with a tag the first card lacks — the autocomplete demo
// needs a tag that is in the set but not yet on the card under test.
const IDEA2 = {
  title: "Voice DNA drift", topic_title: "Voice DNA drift",
  rating: 7.1, rating_explanation: "Real voice is the moat.", tags: ["roadmap"],
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

  // --- Inline tag management on the card (spec Tag completion) -----------
  // A reload resets the client-side filter — work from the full board.
  await request.post(`${API}${routes.saved.save}`, {
    headers: { Authorization: `Bearer ${token}` }, data: IDEA2,
  });
  await page.reload();
  const card1 = page.getByTestId("board-card").filter({ hasText: "RAG evals are the new unit tests" });
  const card2 = page.getByTestId("board-card").filter({ hasText: "Voice DNA drift" });
  await expect(card1).toBeVisible();
  await expect(card2).toBeVisible();

  // Free-typed creation: no matches, Enter commits the raw draft.
  const tagInput = card1.getByTestId("board-tag-editor-input");
  await tagInput.fill("rag");
  await tagInput.press("Enter");
  await expect(card1.getByTestId("board-tag-editor-chip").filter({ hasText: "rag" })).toHaveCount(1);

  // Autocomplete from the existing set: "ro" matches "roadmap" (in the set,
  // not on this card); Enter accepts the top match — keyboard-first.
  await tagInput.fill("ro");
  await expect(card1.getByTestId("board-tag-editor-suggestions")).toContainText("roadmap");
  await tagInput.press("Enter");
  await expect(card1.getByTestId("board-tag-editor-chip")).toHaveCount(3); // evals, rag, roadmap

  // The PATCH persisted: all three tags survive a reload.
  await page.reload();
  await expect(card1.getByTestId("board-tag-editor-chip")).toHaveCount(3);

  // Chip removal PATCHes the remaining list and persists too.
  await card1.getByRole("button", { name: "Remove tag roadmap" }).click();
  await expect(card1.getByTestId("board-tag-editor-chip")).toHaveCount(2);
  await page.reload();
  await expect(card1.getByTestId("board-tag-editor-chip")).toHaveCount(2);

  // The tag filter follows tags added in-session: roadmap lives only on
  // card 2, so filtering by it keeps card 2 and drops card 1.
  await page.getByTestId("board-tag-filter").click();
  await page.getByRole("option", { name: /roadmap/i }).first().click();
  await expect(card2).toBeVisible();
  await expect(card1).toHaveCount(0);
});
