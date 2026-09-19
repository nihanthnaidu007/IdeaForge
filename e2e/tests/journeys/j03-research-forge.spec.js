// J03 — Combined research → forge: one click renders the five fixture ideas
// (webServer env already points TAVILY_BASE_URL at the stub's /tavily/search),
// then save-time tags ride the save call onto the board (spec Tag completion).
// Wave 1 Trend Radar surface: the same run renders the trends it caught —
// source chip, deterministic freshness chip, honest "No signal yet" why-now
// (the research-ok scenario is unenriched) — and "Forge from this" re-forges
// a single cached trend via trend_ids without a second search.
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

  // Trend Radar surface (Wave 1): the research run's trends render as cards.
  // research-ok is unenriched, so the why-now line is the explicit unknown —
  // never snippet text dressed up as an insight.
  await expect(page.getByTestId("trend-card-0")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("trend-card-0")).toContainText("RAG evals are the new unit tests — change my mind");
  await expect(page.getByTestId("trend-source-0")).toHaveText(/site:reddit\.com|Unknown source/);
  await expect(page.getByTestId("trend-freshness-0")).toHaveText(/This week|This month|Older|No signal yet/);
  await expect(page.getByTestId("trend-why-now-0")).toContainText("No signal yet.");
  const sourceLink = page.getByTestId("trend-card-link-0");
  await expect(sourceLink).toHaveAttribute("target", "_blank");
  await expect(sourceLink).toHaveAttribute("rel", "noopener noreferrer");

  // Per-trend forge (spec): scoped to the cached row via trend_ids — no
  // re-search. Watch the API boundary: the scoped forge must carry
  // trend_ids (never raw_trends), and no second /research call may fire.
  const apiCalls = [];
  page.on("request", (req) => {
    if (req.method() === "POST" && (req.url().includes("/generate-ideas") || req.url().includes("/research"))) {
      apiCalls.push({ path: new URL(req.url()).pathname, body: req.postDataJSON() });
    }
  });
  const callsBeforeForge = apiCalls.length;
  await page.getByTestId("forge-from-trend-0-btn").click();
  await expect(page.getByTestId("idea-card-0")).toContainText("RAG evals are the new unit tests", { timeout: 20_000 });

  const forgeCalls = apiCalls.slice(callsBeforeForge);
  expect(forgeCalls).toHaveLength(1);
  expect(forgeCalls[0].path).toBe("/api/generate-ideas");
  expect(forgeCalls[0].body.trend_ids).toHaveLength(1);
  expect(typeof forgeCalls[0].body.trend_ids[0]).toBe("string");
  expect(forgeCalls[0].body.raw_trends).toBeUndefined();

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
