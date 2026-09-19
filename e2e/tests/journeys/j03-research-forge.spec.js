// J03 — Combined research → forge: one click renders the five fixture ideas
// (webServer env already points TAVILY_BASE_URL at the stub's /tavily/search),
// then save-time tags ride the save call onto the board (spec Tag completion).
import { test, expect } from "@playwright/test";
import {
  WEB, API, installDenyList, authedStorage, setScenario, routes,
} from "../../utils/helpers.js";

test("J03: combined research → forge renders fixture ideas", async ({ page, request }) => {
  installDenyList(page, test.info());
  const email = `j03-${Date.now()}@e2e.ideaforge.dev`;
  const storage = await authedStorage(request, email);
  await setScenario(request, "research-ok");

  await page.goto(WEB);
  await page.evaluate((t) => localStorage.setItem("ideaforge_token", t), storage.origins[0].localStorage[0].value);
  await page.goto(`${WEB}/dashboard`);
  await page.reload();
  await page.getByTestId("generate-ideas-btn").click();

  await expect(page.getByTestId("idea-card-0")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("idea-card-0")).toContainText("RAG evals are the new unit tests");
  for (let i = 1; i < 5; i++) {
    await expect(page.getByTestId(`idea-card-${i}`)).toBeAttached({ timeout: 10_000 });
  }

  // Save-time tags (spec Tag completion): the expanded card offers the
  // keyboard-first tag editor; entered tags ride the save call.
  const token = storage.origins[0].localStorage[0].value;
  await page.getByTestId("idea-card-0").click();
  const tagInput = page.getByTestId("save-tag-editor-0-input");
  await tagInput.fill("evals");
  await tagInput.press("Enter");
  await expect(page.getByTestId("save-tag-editor-0-chip")).toHaveCount(1);

  await page.getByTestId("save-idea-0-btn").click();

  // The idea lands on the board with its tags.
  const board = await request.get(`${API}${routes.board.list}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(board.ok()).toBeTruthy();
  const items = await board.json();
  const savedIdea = items.find((d) => d.topic_title === "RAG evals are the new unit tests");
  expect(savedIdea).toBeTruthy();
  expect(savedIdea.tags).toEqual(["evals"]);
});
