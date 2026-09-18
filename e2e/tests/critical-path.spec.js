// The AC row 6 composite (E2E pack §6): register → save keys → research →
// forge → insights → variants → save to board → board shows entry. One user,
// one page, the shipped flow end to end with mocked providers.
import { test, expect } from "@playwright/test";
import {
  routes, API, WEB, E2E_PASSWORD, setScenario, stubRequests, clearStubRequests,
  installDenyList, registerViaApi, saveKeysViaApi, ideaTitles,
} from "../utils/helpers.js";

let email;

test.beforeEach(async ({}, testInfo) => {
  email = `critical-${Date.now()}-${testInfo.workerIndex}@e2e.ideaforge.dev`;
});

test("register → keys → research → forge → variants → save → board", async ({ page, request }) => {
  test.info().annotations.push({ type: "e2e", description: "critical path composite" });
  installDenyList(page, test.info());

  // 1. Register through the UI (the only UI step that cannot be an API seed).
  await page.goto(WEB);
  await page.getByTestId("nav-signup-btn").click();
  await expect(page.getByTestId("auth-modal")).toBeVisible();
  await page.getByTestId("auth-name-input").fill("Critical Path");
  await page.getByTestId("auth-email-input").fill(email);
  await page.getByTestId("auth-password-input").fill(E2E_PASSWORD);
  await page.getByTestId("auth-submit-btn").click();
  await expect(page).toHaveURL(/dashboard/);

  // 2. Save keys through the API (Settings UI path is J02's job).
  await saveKeysViaApi(request, email, E2E_PASSWORD, {
    tavily_api_key: "tvly-e2e-user-key-123456",
    anthropic_api_key: "sk-ant-e2e-user-key-123456",
  });

  // 3-4. Combined research → forge flow (the shipped dashboard contract).
  await setScenario(request, "forge-happy");
  await clearStubRequests(request);
  await page.getByTestId("generate-ideas-btn").click();
  await expect(page.getByTestId("idea-card-0")).toBeVisible();
  for (let i = 0; i < 5; i++) {
    await expect(page.getByTestId(`idea-card-${i}`)).toBeVisible();
  }

  // No fabrication: rendered titles come from the fixture set.
  for (let i = 0; i < 5; i++) {
    const title = await page.getByTestId(`idea-card-${i}`).locator("h3").innerText();
    expect(ideaTitles).toContain(title);
  }

  // 5. Insight card for the first idea (cost hint precedes the spend).
  await page.getByTestId("idea-card-0").click();
  await expect(page.getByTestId("insights-idle-0")).toBeVisible();
  await expect(page.getByTestId("insights-cost-hint-0")).toBeVisible();
  await page.getByTestId("generate-insights-0-btn").click();
  await expect(page.getByTestId("insights-0")).toBeVisible();

  // 6. Variants: pick a format, craft, compare three distinct drafts.
  await page.getByTestId("format-hot_take-btn").click();
  await page.getByTestId("craft-post-btn").click();
  await expect(page.getByTestId("variant-column-0")).toBeVisible();
  await expect(page.getByTestId("variant-column-1")).toBeVisible();
  await expect(page.getByTestId("variant-column-2")).toBeVisible();
  await expect(page.getByTestId("variant-column-0")).toContainText("cheaper than the incident");
  await expect(page.getByTestId("variant-column-1")).toContainText("CI red on drift");
  await expect(page.getByTestId("variant-column-2")).toContainText("Data quality surprises");

  // Wire-level proof: research hit Tavily three times, forge hit Anthropic.
  const records = await stubRequests(request);
  const tavily = records.filter((r) => r.provider === "tavily");
  const anthropic = records.filter((r) => r.provider === "anthropic");
  expect(tavily.map((r) => r.body.query).sort()).toEqual([
    "AI latest trends site:reddit.com", "AI viral news today", "trending AI topics LinkedIn",
  ]);
  expect(anthropic.length).toBeGreaterThanOrEqual(5); // ideas + insight + 3 variants

  // 7. Save the idea → the board shows the entry.
  await page.getByTestId("idea-card-0").click();
  await page.getByRole("button", { name: /save/i }).first().click();
  await page.getByTestId("nav-board-btn").click();
  await expect(page.getByTestId("content-board")).toBeVisible();
  await expect(page.getByTestId("board-card").first()).toBeVisible();
  await expect(page.getByTestId("board-card").first()).toContainText(ideaTitles[0]);
});
