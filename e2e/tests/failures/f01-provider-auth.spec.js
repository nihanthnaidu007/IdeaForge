// F01 — Tavily 401: the typed PROVIDER_AUTH failure (PR #10 taxonomy: the
// 503-family mapping does NOT apply to auth), no fabricated research, and
// the shipped error banner with its key-problem affordance.
import { test, expect } from "../../utils/failures-test.js";
import {
  WEB, API, installDenyList, authedStorage, setScenario,
} from "../../utils/helpers.js";

test("F01: Tavily 401 → typed auth failure, no fabricated research", async ({ page, request }) => {
  installDenyList(page, test.info());
  const email = `f01-${Date.now()}@e2e.ideaforge.dev`;
  const storage = await authedStorage(request, email);
  const token = storage.origins[0].localStorage[0].value;
  await setScenario(request, "research-tavily-401");

  // API level: the typed kind, not a generic 502.
  const res = await request.post(`${API}/api/research`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { niche: "AI agents", tone: "practical" },
  });
  const body = await res.json();
  expect((body.detail?.kind ?? body.kind)).toBe("PROVIDER_AUTH");

  // UI level: the banner renders; zero idea cards ever appear.
  await page.goto(WEB);
  await page.evaluate((t) => localStorage.setItem("ideaforge_token", t), token);
  await page.goto(`${WEB}/dashboard`);
  await page.reload();
  await page.getByTestId("generate-ideas-btn").click();
  await expect(page.getByText("Idea forging failed.")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("idea-card-0")).toHaveCount(0);
});
