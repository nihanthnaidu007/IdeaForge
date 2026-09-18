// F07 — Empty research: zero trends must not hallucinate content. The forge
// refuses loudly (GENERATION_REFUSED) instead of inventing ideas.
import { test, expect } from "@playwright/test";
import {
  WEB, API, installDenyList, authedStorage, setScenario, clearStubRequests, routes,
} from "../../utils/helpers.js";

test("F07: empty Tavily results → typed refusal, zero fabricated ideas", async ({ page, request }) => {
  installDenyList(page, test.info());
  const email = `f07-${Date.now()}@e2e.ideaforge.dev`;
  const storage = await authedStorage(request, email);
  const token = storage.origins[0].localStorage[0].value;
  await setScenario(request, "forge-no-sources");
  await clearStubRequests(request);

  const res = await request.post(`${API}${routes.ideas.generate}`, {
    headers: { Authorization: `Bearer ${token}` }, data: { raw_trends: [], niche: "AI", tone: "professional" },
  });
  expect([502, 422]).toContain(res.status());

  await page.goto(WEB);
  await page.evaluate((t) => localStorage.setItem("ideaforge_token", t), token);
  await page.goto(`${WEB}/dashboard`);
  await page.reload();
  await page.getByTestId("generate-ideas-btn").click();
  await page.waitForTimeout(2000);
  await expect(page.getByTestId(/^idea-card/)).toHaveCount(0);
  // Either the typed error banner or the honest empty state renders — never
  // fabricated cards.
  const body = await page.locator("body").innerText();
  expect(body).toMatch(/error|refus|empty|no trends|failed|pick/i);
});
