// F03a — Tavily 429 → the PR #10 merged taxonomy: ProviderRateLimitedError
// with HTTP 429 (NOT the pack's original 402 mapping). UI shows the verbatim
// §3.2 copy with a Retry-After countdown; a previous run's data stays under
// the dated stale banner instead of vanishing.
import { test, expect } from "@playwright/test";
import {
  WEB, API, installDenyList, authedStorage, setScenario, clearStubRequests, routes,
} from "../../utils/helpers.js";

test("F03a: Tavily 429 → 429 PROVIDER_RATE_LIMITED with countdown copy", async ({ page, request }) => {
  installDenyList(page, test.info());
  const email = `f03a-${Date.now()}@e2e.ideaforge.dev`;
  const storage = await authedStorage(request, email);
  const token = storage.origins[0].localStorage[0].value;
  await setScenario(request, "research-tavily-429");
  await clearStubRequests(request);

  const res = await request.post(`${API}${routes.research.run}`, {
    headers: { Authorization: `Bearer ${token}` }, data: { niche: "AI", tone: "professional" },
  });
  expect(res.status()).toBe(429);
  const body = await res.json();
  expect(body.detail.kind ?? body.kind).toBe("PROVIDER_RATE_LIMITED");

  await page.goto(WEB);
  await page.evaluate((t) => localStorage.setItem("ideaforge_token", t), token);
  await page.goto(`${WEB}/dashboard`);
  await page.reload();
  await page.getByTestId("generate-ideas-btn").click();
  await expect(page.getByText("Too many searches, too fast.").first()).toBeVisible();
  await expect(page.getByText(/Retry unlocks in/).first()).toBeVisible();
  await expect(page.getByTestId(/^idea-card/)).toHaveCount(0);
});
