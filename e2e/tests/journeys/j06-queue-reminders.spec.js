// J06 — Queue & reminders: the board's Remind-me button targets the card in
// the DraftQueue schedule form (same page), the queue row renders, and the
// reminder worker delivers a visible reminder card after the due time.
// No LinkedIn egress, ever.
import { test, expect } from "@playwright/test";
import {
  WEB, API, installDenyList, authedStorage, setScenario, stubRequests, clearStubRequests, routes,
} from "../../utils/helpers.js";

test("J06: schedule → queue row → reminder card within the interval", async ({ page, request }) => {
  test.setTimeout(150_000);
  installDenyList(page, test.info());
  const email = `j06-${Date.now()}@e2e.ideaforge.dev`;
  const storage = await authedStorage(request, email);
  const token = storage.origins[0].localStorage[0].value;
  await setScenario(request, "forge-happy");
  await clearStubRequests(request);

  const saveRes = await request.post(`${API}${routes.saved.save}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      id: "e2e-idea-1", title: "RAG evals are the new unit tests", topic_title: "RAG evals are the new unit tests",
      rating: 8.4, rating_explanation: "High tension.", targeted_audience: "Platform leads",
      why_it_matters: "Eval discipline decides ship vs stall.", key_aspects: ["Golden sets"], post_angles: [],
    },
  });
  expect(saveRes.ok()).toBeTruthy();

  // Schedule through the shipped flow: board card → Remind me → form.
  await page.goto(WEB);
  await page.evaluate((t) => localStorage.setItem("ideaforge_token", t), token);
  await page.goto(`${WEB}/board`);
  await page.reload();
  await expect(page.getByTestId("board-card").first()).toBeVisible();
  await page.getByTestId("board-card-schedule-btn").first().click();
  await expect(page.getByTestId("schedule-form")).toBeVisible();

  // Due in ~70s so the worker (interval: 1s in E2E env) delivers promptly.
  const due = new Date(Date.now() + 70_000);
  const pad = (n) => String(n).padStart(2, "0");
  const whenLocal = `${due.getFullYear()}-${pad(due.getMonth() + 1)}-${pad(due.getDate())}T${pad(due.getHours())}:${pad(due.getMinutes())}`;
  await expect(page.getByTestId("schedule-target-chip")).toBeVisible();
  await page.getByTestId("schedule-when-input").fill(whenLocal);
  await page.getByTestId("schedule-submit-btn").click();
  await page.waitForTimeout(1000);

  await expect(page.getByTestId("queue-row").first()).toBeVisible();
  await expect(page.getByTestId("queue-scheduled-count")).toBeVisible();

  // The reminder: due passes, the worker (REMINDER_INTERVAL_SECONDS=1 in E2E)
  // delivers it, and the queue — which loads on mount/refreshKey, not on a
  // timer — shows it after the next reload. Poll with reloads until due+tick.
  let delivered = false;
  for (let i = 0; i < 10 && !delivered; i++) {
    await page.waitForTimeout(10_000);
    await page.reload();
    delivered = await page.getByTestId("queue-reminder-card").first().isVisible().catch(() => false);
  }
  await expect(page.getByTestId("queue-reminder-card").first()).toBeVisible();
  await expect(page.getByTestId("queue-notifications")).toBeVisible();

  // Hard boundary: the reminder pipeline never touches LinkedIn.
  const records = await stubRequests(request);
  expect(records.filter((r) => /linkedin/.test(JSON.stringify(r)))).toEqual([]);
});
