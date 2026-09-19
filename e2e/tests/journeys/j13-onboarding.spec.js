// J13 — Bundled-first onboarding (Wave 1 §Onboarding): a brand-new login
// lands on the welcome mat — bundled allowance stated as facts, no manual
// setup — then the guide advances only on real events (the combined
// research→forge run), dismissal is permanent until a Settings replay, and
// the replay re-opens the guide without resetting progress.
import { test, expect } from "@playwright/test";
import {
  WEB, API, installDenyList, authedStorage, setScenario, routes,
} from "../../utils/helpers.js";

const login = async (page, storage) => {
  await page.goto(WEB);
  await page.evaluate(
    (t) => localStorage.setItem("ideaforge_token", t),
    storage.origins[0].localStorage[0].value,
  );
  await page.goto(`${WEB}/dashboard`);
  await page.reload();
};

test("J13: first login lands on the welcome mat; the guide completes on real events", async ({ page, request }) => {
  installDenyList(page, test.info());
  const email = `j13-${Date.now()}@e2e.ideaforge.dev`;
  const storage = await authedStorage(request, email);
  await setScenario(request, "research-ok");

  await login(page, storage);

  // 1. The welcome mat — the bundled-first promise with allowance facts.
  //    A bundled key exists in the E2E backend env, so the research line
  //    states the daily allowance instead of demanding a key.
  const mat = page.getByTestId("onboarding-welcome-mat");
  await expect(mat).toBeVisible();
  await expect(mat).toContainText("Your forge is live");
  await expect(page.getByTestId("onboarding-allowance-research")).toContainText("bundled key");

  // 2. Leaving the mat completes the welcome step; the stepper takes over
  //    with first_sweep as the honest next action.
  await page.getByTestId("onboarding-start-btn").click();
  await expect(page.getByTestId("onboarding-welcome-mat")).toHaveCount(0);
  const stepper = page.getByTestId("onboarding-stepper");
  await expect(stepper).toBeVisible();
  await expect(page.getByTestId("onboarding-step-first_sweep")).toHaveAttribute("data-status", "current");

  // 3. First sweep + first forge: one combined run. Both steps complete on
  //    the server from the real events — so the guide never shows an
  //    all-done state; it stands down outright.
  await page.getByTestId("generate-ideas-btn").click();
  await expect(page.getByTestId("idea-card-0")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("onboarding-stepper")).toHaveCount(0);

  // 4. The stand-down was completion, not dismissal: the server records both
  //    steps done with no dismissal timestamp.
  const token = storage.origins[0].localStorage[0].value;
  const progress = await request.get(`${API}${routes.onboarding.progress}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(progress.ok()).toBeTruthy();
  const body = await progress.json();
  expect(body.steps.first_sweep).toBe("done");
  expect(body.steps.first_forge).toBe("done");
  expect(body.dismissed_at).toBeNull();
  expect(body.completed_at).toBeTruthy();

  // 5. Settings replay re-opens the guide WITHOUT resetting state: the
  //    steps it shows are still done. (SPA navigation — the replayed guide
  //    belongs to this session's request, not a permanent pin.)
  await page.getByTestId("nav-settings-btn").click();
  await page.getByTestId("replay-onboarding-btn").click();
  await expect(page.getByText("Setup guide is back on your dashboard.")).toBeVisible();
  await page.getByTestId("back-btn").click();

  await expect(page.getByTestId("onboarding-stepper")).toBeVisible();
  await expect(page.getByTestId("onboarding-step-first_sweep")).toHaveAttribute("data-status", "done");
  await expect(page.getByTestId("onboarding-step-first_forge")).toHaveAttribute("data-status", "done");
  await expect(page.getByTestId("onboarding-welcome-mat")).toHaveCount(0);
});

test("J13: dismissal is permanent — reload does not bring the guide back", async ({ page, request }) => {
  installDenyList(page, test.info());
  const email = `j13d-${Date.now()}@e2e.ideaforge.dev`;
  const storage = await authedStorage(request, email);
  await setScenario(request, "research-ok");

  await login(page, storage);

  await page.getByTestId("onboarding-dismiss-btn").click();
  await expect(page.getByTestId("onboarding-welcome-mat")).toHaveCount(0);
  await expect(page.getByTestId("onboarding-stepper")).toHaveCount(0);

  // Permanent for the dismissal set: the state lives on the server, so a
  // full reload cannot resurrect the guide. Only Settings replay does.
  await page.reload();
  await expect(page.getByTestId("onboarding-welcome-mat")).toHaveCount(0);
  await expect(page.getByTestId("onboarding-stepper")).toHaveCount(0);
});
