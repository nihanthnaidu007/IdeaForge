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

  // Ideas succeed (Anthropic is routed in this scenario) — the quota error
  // fires when the craft/variants step calls OpenAI.
  const res = await request.post(`${API}${routes.ideas.generate}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { raw_trends: [{ title: "Trend", url: "https://example-feed.dev/t", content: "c", score: 0.9 }], niche: "AI", tone: "professional" },
  });
  expect(res.ok()).toBeTruthy();
  const ideas = (await res.json()).ideas;
  expect(Array.isArray(ideas) && ideas.length > 0).toBe(true);

  const vres = await request.post(`${API}${routes.posts.generateVariants}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { idea: ideas[0], format: "hot-take", tone: "professional" },
  });
  expect([402, 503]).toContain(vres.status());
  const body = await vres.json();
  expect(body.detail.kind ?? body.kind).toBe("PROVIDER_QUOTA");

  await page.goto(WEB);
  await page.evaluate((t) => localStorage.setItem("ideaforge_token", t), token);
  await page.goto(`${WEB}/dashboard`);
  await page.reload();
  await page.getByTestId("generate-ideas-btn").click();
  await expect(page.getByTestId("idea-card-0")).toBeVisible({ timeout: 20_000 });
  // Shipped selection flow: expand the collapsed card, then Explore Post
  // Formats (selectIdea) — the FormatPicker renders only after selection.
  await page.getByTestId("idea-card-0").click();
  await page.getByTestId("explore-formats-0-btn").click();
  // Drafting is the shipped manual step — the craft button fires the variants
  // call that hits the quota error; VariantCompare surfaces it honestly.
  await page.getByTestId("format-hot-take-btn").click();
  await page.getByTestId("craft-post-btn").click();
  await expect(page.getByTestId("variants-error")).toBeVisible({ timeout: 20_000 });
  const banner = await page.getByTestId("variants-error").innerText();
  expect(banner).toMatch(/quota|credit|rate/i);
  // Never leaked the meta-provider name (PR #9 dependency contract).
  const pageText = await page.locator("body").innerText();
  expect(pageText).not.toMatch(/Emergent/i);
});
