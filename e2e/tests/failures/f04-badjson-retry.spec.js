// F04 — Malformed model output fails loudly (no fabricated cards), then the
// SAME retry recovers when the provider behaves (stub flips scenario).
import { test, expect } from "@playwright/test";
import {
  WEB, API, installDenyList, authedStorage, setScenario, clearStubRequests, routes,
} from "../../utils/helpers.js";

test("F04: bad JSON once → typed failure with zero cards → retry recovers", async ({ page, request }) => {
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
