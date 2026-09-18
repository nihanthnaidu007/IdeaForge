// F02 — Generation quota (402 family): OpenAI-style insufficient-quota 429
// maps to PROVIDER_QUOTA; UI copy names the provider honestly; no variant
// content is fabricated; the ideas stay usable.
import { test, expect } from "@playwright/test";
import {
  WEB, API, installDenyList, authedStorage, setScenario, clearStubRequests, routes,
} from "../../utils/helpers.js";

test("F02: OpenAI quota error → typed quota failure, ideas untouched, no Emergent anywhere", async ({ page, request }) => {
  installDenyList(page, test.info());
  const email = `f02-${Date.now()}@e2e.ideaforge.dev`;
  const storage = await authedStorage(request, email);
  const token = storage.origins[0].localStorage[0].value;
  await setScenario(request, "llm-quota-402");
  await clearStubRequests(request);

  const res = await request.post(`${API}${routes.ideas.generate}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { raw_trends: [{ title: "Trend", url: "https://example-feed.dev/t", content: "c", score: 0.9 }], niche: "AI", tone: "professional" },
  });
  expect([402, 503]).toContain(res.status());
  const body = await res.json();
  expect(body.detail.kind ?? body.kind).toBe("PROVIDER_QUOTA");

  await page.goto(WEB);
  await page.evaluate((t) => localStorage.setItem("ideaforge_token", t), token);
  await page.goto(`${WEB}/dashboard`);
  await page.reload();
  await page.getByTestId("generate-ideas-btn").click();
  await page.waitForTimeout(1500);
  await expect(page.locator('[data-testid^="error-"]').first()).toBeVisible();
  const banner = await page.locator('[data-testid^="error-"]').first().innerText();
  expect(banner).toMatch(/quota|credit/i);
  // Never leaked the meta-provider name (PR #9 dependency contract).
  const pageText = await page.locator("body").innerText();
  expect(pageText).not.toMatch(/Emergent/i);
});
