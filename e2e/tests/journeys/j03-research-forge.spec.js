// J03 — Combined research → forge: one click renders the five fixture ideas
// (webServer env already points TAVILY_BASE_URL at the stub's /tavily/search).
import { test, expect } from "@playwright/test";
import {
  WEB, installDenyList, authedStorage, setScenario,
} from "../../utils/helpers.js";

test("J03: combined research → forge renders fixture ideas", async ({ page, request }) => {
  installDenyList(page, test.info());
  const email = `j03-${Date.now()}@e2e.ideaforge.dev`;
  const storage = await authedStorage(request, email);
  await setScenario(request, "research-ok");

  await page.goto(WEB);
  await page.evaluate((t) => localStorage.setItem("ideaforge_token", t), storage.origins[0].localStorage[0].value);
  await page.goto(`${WEB}/dashboard`);
  await page.reload();
  await page.getByTestId("generate-ideas-btn").click();

  await expect(page.getByTestId("idea-card-0")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("idea-card-0")).toContainText("RAG evals are the new unit tests");
  for (let i = 1; i < 5; i++) {
    await expect(page.getByTestId(`idea-card-${i}`)).toBeAttached({ timeout: 10_000 });
  }
});
