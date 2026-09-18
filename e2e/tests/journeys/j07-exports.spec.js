// J07 — Exports: board Markdown/CSV and queue ICS download with real
// content shapes — title in MD, header row in CSV, VEVENT/UID in ICS.
// All three live on /board (ContentBoard + DraftQueue).
import { test, expect } from "@playwright/test";
import {
  WEB, API, installDenyList, authedStorage, setScenario, routes,
} from "../../utils/helpers.js";
import { readFileSync } from "node:fs";

const IDEA = {
  id: "e2e-idea-1", title: "RAG evals are the new unit tests", topic_title: "RAG evals are the new unit tests",
  rating: 8.4, rating_explanation: "High tension.", targeted_audience: "Platform leads",
  why_it_matters: "Eval discipline decides ship vs stall.", key_aspects: ["Golden sets"],
  post_angles: [], tags: ["evals"],
};

test("J07: board MD + CSV and queue ICS downloads", async ({ page, request }) => {
  installDenyList(page, test.info());
  const email = `j07-${Date.now()}@e2e.ideaforge.dev`;
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
  await expect(page.getByTestId("board-card").first()).toBeVisible();

  // Markdown export.
  const [md] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("board-export-md-btn").click(),
  ]);
  const mdPath = await md.path();
  const mdContent = readFileSync(mdPath, "utf8");
  expect(mdContent).toContain("RAG evals are the new unit tests");

  // CSV export.
  const [csv] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("board-export-csv-btn").click(),
  ]);
  const csvContent = readFileSync(await csv.path(), "utf8");
  expect(csvContent.split("\n")[0]).toMatch(/title|idea/i);
  expect(csvContent).toContain("RAG evals are the new unit tests");

  // ICS export from the queue section (one scheduled row via the API).
  const due = new Date(Date.now() + 3_600_000).toISOString();
  const schedRes = await request.post(`${API}/queue/e2e-idea-1/schedule`, {
    headers: { Authorization: `Bearer ${token}` }, data: { scheduled_for: due },
  });
  expect(schedRes.ok()).toBeTruthy();

  await page.reload();
  await expect(page.getByTestId("queue-row").first()).toBeVisible();
  const [ics] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("queue-export-ics-btn").click(),
  ]);
  const icsContent = readFileSync(await ics.path(), "utf8");
  expect(icsContent).toContain("BEGIN:VCALENDAR");
  expect(icsContent).toContain("BEGIN:VEVENT");
  expect(icsContent).toMatch(/UID:/);
});
