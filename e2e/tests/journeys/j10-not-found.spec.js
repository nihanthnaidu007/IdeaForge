// J10 — Unknown route: the shipped 404 (PR #7 copy — no board-action line)
// and recovery through its own home affordance. The 404 page renders
// standalone (no navbar by design).
import { test, expect } from "@playwright/test";
import { WEB, installDenyList } from "../../utils/helpers.js";

test("J10: unknown route renders the shipped 404 and recovers", async ({ page }) => {
  installDenyList(page, test.info());
  await page.goto(`${WEB}/definitely-not-a-route`);
  await expect(page.getByTestId("not-found-page")).toBeVisible();
  const nf = await page.getByTestId("not-found-page").innerText();
  expect(nf).not.toMatch(/board/i);
  await page.getByTestId("not-found-home-btn").click();
  await expect(page).not.toHaveURL(/definitely-not-a-route/);
  await expect(page.getByTestId("nav-login-btn")).toBeVisible();
});
