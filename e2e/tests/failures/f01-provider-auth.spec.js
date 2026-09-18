// F01 — Provider returns 401 mid-journey (BYOK or server key): typed
// PROVIDER_AUTH error, banner names rejection, zero content, retry affordance.
import { test, expect } from "@playwright/test";
import {
  WEB, API, installDenyList, authedStorage, setScenario, stubRequests, clearStubRequests, routes,
} from "../../utils/helpers.js";

test("F01: Tavily 401 → typed auth failure, no fabricated research", async ({ page, request }) => {
  installDenyList(page, test.info());
  const email = `f01-${Date.now()}@e2e.ideaforge.dev`;
  const storage = await authedStorage(request, email);
  const token = storage.origins[0].localStorage[0].value;
  await setScenario(request, "research-tavily-401");
  await clearStubRequests(request);

  const res = await request.post(`${API}${routes.research.run}`, {
    headers: { Authorization: `Bearer ${token}` }, data: { niche: "AI", tone: "professional" },
  });
  expect(res.status()).toBe(401);
  const body = await res.json();
  expect(body.detail.kind ?? body.kind).toBe("PROVIDER_AUTH");

  await page.goto(WEB);
  await page.evaluate((t) => localStorage.setItem("ideaforge_token", t), token);
  await page.goto(`${WEB}/dashboard`);
  await page.reload();
  await page.getByTestId("generate-ideas-btn").click();
  await page.waitForTimeout(1500);
  await expect(page.locator('[data-testid^="error-"]').first()).toBeVisible();
  const banner = await page.locator('[data-testid^="error-"]').first().innerText();
  expect(banner).toMatch(/rejected|key|API/i);
  await expect(page.getByTestId("error-retry-btn").first()).toBeVisible();
  await expect(page.getByTestId(/^idea-card/)).toHaveCount(0);
});
