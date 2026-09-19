// F04 — Malformed model output fails loudly (no fabricated cards), then the
// SAME retry recovers when the provider behaves (stub flips scenario).
import { test, expect } from "../../utils/failures-test.js";
import {
  WEB, API, installDenyList, authedStorage, setScenario, clearStubRequests, routes,
} from "../../utils/helpers.js";

// Unquarantined per the F04 root-cause diagnosis (art_vqwfyodR). History:
// quarantined as test.fixme during the 2026-09-18 CI flakes; PR #17's
// unquarantine attempt re-died on run 35344981425 — with request-level stub
// tracing in place, the retry's Anthropic insight call never left the backend
// process (tavily research ran, then 15.7s of server-side silence; the stub
// answered everything that arrived). Evidence and trace timeline:
// https://github.com/nihanthnaidu007/IdeaForge/issues/16#issuecomment-5730080443
//
// The stall class is now structurally bounded instead of silent: the axios
// client aborts a wedged request at 30s into the honest NETWORK error card,
// the Mongo client bounds socket reads at 15s, and this project's page
// fixture attaches a request-failure/HAR timeline whenever a test fails —
// so a recurrence is both self-healing (retry recovers by construction) and
// diagnostic (the timeline names the dead request).
test(
  "F04: bad JSON once → typed failure with zero cards → retry recovers",
  async ({ page, request }) => {
  installDenyList(page, test.info());
  const email = `f04-${Date.now()}@e2e.ideaforge.dev`;
  const storage = await authedStorage(request, email);
  const token = storage.origins[0].localStorage[0].value;
  await setScenario(request, "llm-badjson-both");
  await clearStubRequests(request);

  const res = await request.post(`${API}${routes.ideas.generate}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { raw_trends: [{ title: "Trend", url: "https://example-feed.dev/t", content: "c", score: 0.9 }], niche: "AI", tone: "professional" },
  });
  expect(res.status()).toBe(502);
  const body = await res.json();
  expect(body.detail.kind ?? body.kind).toBe("GENERATION_FAILED");

  await page.goto(WEB);
  await page.evaluate((t) => localStorage.setItem("ideaforge_token", t), token);
  await page.goto(`${WEB}/dashboard`);
  await page.reload();
  await page.getByTestId("generate-ideas-btn").click();
  // No fixed wait — Playwright auto-waiting covers the async generation flow;
  // the extended budget only absorbs CI runner load.
  await expect(page.locator('[data-testid^="error-"]').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId(/^idea-card/)).toHaveCount(0);

  // Provider recovers → the retry affordance actually recovers.
  await setScenario(request, "research-ok");
  await page.getByTestId("error-retry-btn").first().click();
  await expect(page.getByTestId("idea-card-0")).toBeVisible({ timeout: 15_000 });
  for (let i = 0; i < 5; i++) {
    await expect(page.getByTestId(`idea-card-${i}`)).toBeVisible();
  }
});
