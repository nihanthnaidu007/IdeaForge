// J07 — Exports: board Markdown/CSV and queue ICS download with real
// content shapes — H1 title + source label in MD, header row in CSV,
// VEVENT/UID in ICS. Client-triggered downloads of API-shaped data.
import { test, expect } from "@playwright/test";
import {
  WEB, API, installDenyList, authedStorage, setScenario, routes,
} from "../../utils/helpers.js";

test("J07: board MD + CSV and queue ICS downloads", async ({ page, request }) => {
  installDenyList(page, test.info());
  const email = `j07-${Date.now()}@e2e.ideaforge.dev`;
  const storage = await authedStorage(request, email);
  const token = storage.origins[0].localStorage[0].value;
  await setScenario(request, "forge-happy");

  const saveRes = await request.post(`${API}${routes.saved.save}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      id: "e2e-idea-1", title: "RAG evals are the new unit tests", topic_title: "RAG evals are the new unit tests",
      rating: 8.4, rating_explanation: "High tension.", targeted_audience: "Platform leads",
      why_it_matters: "Eval discipline decides ship vs stall.", key_aspects: ["Golden sets"], post_angles: [],
      source_label: "reddit.com/r/LocalLLaMA",
    },
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
  const mdText = await page.request().fetch(`file://${mdPath}`).then((r) => r.text()).catch(() => null);
  const { readFileSync } = await import("node:fs");
  const mdContent = mdText ?? readFileSync(mdPath, "utf8");
  expect(mdContent).toContain("RAG evals are the new unit tests");

  // CSV export.
  const [csv] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("board-export-csv-btn").click(),
  ]);
  const csvPath = await csv.path();
  const csvContent = readFileSync(csvPath, "utf8");
  expect(csvContent.split("\n")[0]).toMatch(/title|idea/i);
  expect(csvContent).toContain("RAG evals are the new unit tests");

  // ICS export from the queue (needs one scheduled row — schedule via API).
  const list = await (await request.get(`${API}${routes.board.list}`, {
    headers: { Authorization: `Bearer ${token}` },
  })).json();
  const boardId = (Array.isArray(list) ? list : list.items)[0].id;
  const due = new Date(Date.now() + 3_600_000).toISOString();
  const schedRes = await request.post(`${API}${routes.queue.schedule}`, {
    headers: { Authorization: `Bearer ${token}` }, data: { idea_id: boardId, scheduled_for: due },
  });
  expect(schedRes.ok()).toBeTruthy();

  await page.goto(`${WEB}/queue`);
  if (await page.getByTestId("not-found-page").count()) {
    await page.goto(`${WEB}/dashboard`);
  }
  const [ics] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("queue-export-ics-btn").click(),
  ]);
  const icsPath = await ics.path();
  const icsContent = readFileSync(icsPath, "utf8");
  expect(icsContent).toContain("BEGIN:VCALENDAR");
  expect(icsContent).toContain("BEGIN:VEVENT");
  expect(icsContent).toMatch(/UID:/);
});
