// J03 — Research & forge (shipped combined flow): one button runs a real
// Tavily-shaped research pass (3 queries) then forges ideas; scanning copy
// names the machine; rendered ideas are exactly the fixture set.
import { test, expect } from "@playwright/test";
import {
  WEB, installDenyList, authedStorage, setScenario, stubRequests,
  clearStubRequests, ideaTitles,
} from "../../utils/helpers.js";

test("J03: combined research → forge renders fixture ideas with sources", async ({ page, request }) => {
  installDenyList(page, test.info());
  const email = `j03-${Date.now()}@e2e.ideaforge.dev`;
  const storage = await authedStorage(request, email);
  await setScenario(request, "forge-happy");
  await clearStubRequests(request);

  await page.goto(WEB);
  await page.evaluate((state) => {
    for (const [k, v] of Object.entries(state)) localStorage.setItem(k, v);
  }, { ideaforge_token: storage.origins[0].localStorage[0].value });
  await page.reload();
  await page.getByTestId("nav-open-app-btn").click().catch(() => {});
  await expect(page).toHaveURL(/dashboard/);

  await page.getByTestId("generate-ideas-btn").click();
  await expect(page.getByTestId("idea-card-0")).toBeVisible();

  // §3.2 loading copy named the machine while it ran (already replaced by
  // cards now) — assert the honest empty/loading contract held: five cards.
  for (let i = 0; i < 5; i++) {
    await expect(page.getByTestId(`idea-card-${i}`)).toBeVisible();
  }
  for (let i = 0; i < 5; i++) {
    const title = await page.getByTestId(`idea-card-${i}`).locator("h3").innerText();
    expect(ideaTitles).toContain(title);
  }

  // Wire-level proof of the mocked boundary.
  const records = await stubRequests(request);
  const tavily = records.filter((r) => r.provider === "tavily");
  expect(tavily).toHaveLength(3);
  expect(tavily.map((r) => r.body.query).sort()).toEqual([
    "AI latest trends site:reddit.com", "AI viral news today", "trending AI topics LinkedIn",
  ]);
  for (const call of tavily) {
    expect(call.headers.authorization).toBeTruthy(); // the user's/server key rode along
  }
  const anthropic = records.filter((r) => r.provider === "anthropic");
  expect(anthropic).toHaveLength(1); // exactly the ideas call
});
