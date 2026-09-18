// J10 — Unknown routes: shipped 404 page (PR #7 copy — no board-action
// line), home button recovers, navbar stays.
import { test, expect } from "@playwright/test";
import { WEB, installDenyList, authedStorage } from "../../utils/helpers.js";

test("J10: unknown route renders the shipped 404 and recovers", async ({ page, request }) => {
  installDenyList(page, test.info());
  const email = `j10-${Date.now()}@e2e.ideaforge.dev`;
  const storage = await authedStorage(request, email);

  await page.goto(WEB);
  await page.evaluate((t) => localStorage.setItem("ideaforge_token", t), storage.origins[0].localStorage[0].value);
  await page.goto(`${WEB}/routes-that-do-not-exist`);
  await page.reload();

  await expect(page.getByTestId("not-found-page")).toBeVisible();
  await expect(page.getByTestId("navbar")).toBeVisible();
  // PR #7 canonical copy: the 404 must NOT carry the board-action line.
  const nf = await page.getByTestId("not-found-page").innerText();
  expect(nf).not.toMatch(/board/i);
  await page.getByTestId("not-found-home-btn").click();
  await expect(page).toHaveURL(/\/$/);
});
