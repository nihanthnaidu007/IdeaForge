// J12 — Dashboard copy runs the LinkedIn lint. The Dashboard's copy path is
// the most natural exit (craft → pick → copy), so it must run the same
// /preview/linkedin checks as the Board preview: the picked draft renders
// the shared preview pane, and the copy click lints before the clipboard.
import { test, expect } from "@playwright/test";
import {
  WEB, installDenyList, authedStorage, setScenario,
} from "../../utils/helpers.js";

test("J12: dashboard copy runs the LinkedIn lint before the clipboard", async ({ page, request }) => {
  test.setTimeout(120_000);
  installDenyList(page, test.info());
  const email = `j12-${Date.now()}@e2e.ideaforge.dev`;
  const storage = await authedStorage(request, email);
  await setScenario(request, "forge-happy");

  await page.goto(WEB);
  await page.evaluate((t) => localStorage.setItem("ideaforge_token", t), storage.origins[0].localStorage[0].value);
  await page.goto(`${WEB}/dashboard`);
  await page.reload();
  await page.getByTestId("generate-ideas-btn").click();
  await expect(page.getByTestId("idea-card-0")).toBeVisible({ timeout: 20_000 });

  // Same shipped loop as J04: expand → explore → format → craft → pick.
  await page.getByTestId("idea-card-0").click();
  await page.getByTestId("explore-formats-0-btn").click();
  await page.getByTestId("format-hot-take-btn").click();
  await page.getByTestId("craft-post-btn").click();
  await expect(page.getByTestId("variant-column-0")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("variant-pick-0-btn").click();
  await expect(page.getByTestId("post-content")).toBeVisible({ timeout: 20_000 });

  // The shared preview pane renders under the picked draft — the same fold,
  // char counter, and formatting checks the Board preview shows.
  await expect(page.getByTestId("linkedin-preview")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("preview-checks")).toBeVisible({ timeout: 10_000 });

  // The copy click lints: the pane's debounced mount check already ran, so
  // the next lint POST is the copy gate's — fired before any clipboard write.
  const lintRequest = page.waitForRequest(
    (req) => req.method() === "POST" && req.url().includes("/api/preview/linkedin"),
  );
  await page.context().grantPermissions(["clipboard-write", "clipboard-read"]);
  await page.getByTestId("copy-post-btn").click();
  const lint = await lintRequest;
  const lintBody = lint.postDataJSON();
  expect(lintBody?.text).toBeTruthy();

  // The clipboard received the picked draft — the gate let a clean verdict
  // through. Poll: the write lands one microtask after the lint response.
  await expect
    .poll(async () => page.evaluate(() => navigator.clipboard.readText()), { timeout: 5_000 })
    .toBe(lintBody.text);
  await expect(page.getByText("Copy failed")).toHaveCount(0);
});
