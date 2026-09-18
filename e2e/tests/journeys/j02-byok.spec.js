// J02 — BYOK: save the Anthropic key through the shipped Settings form
// (anthropic-key-input → save-anthropic-btn), the hint stays masked
// (anthropic-key-hint), and the one-click probe (test-anthropic-btn) runs
// against the real /keys/{provider}/test with THE USER'S key — the stub
// record carries the exact sentinel value.
import { test, expect } from "@playwright/test";
import {
  WEB, installDenyList, authedStorage, setScenario, stubRequests, clearStubRequests,
} from "../../utils/helpers.js";

const USER_KEY = "e2e-anthropic-user-key-987654321";

test("J02: save Anthropic key → probe uses the user's key → hint stays masked", async ({ page, request }) => {
  installDenyList(page, test.info());
  const email = `j02-${Date.now()}@e2e.ideaforge.dev`;
  const storage = await authedStorage(request, email);
  await setScenario(request, "byok-keytest");
  await clearStubRequests(request);

  await page.goto(WEB);
  await page.evaluate((t) => localStorage.setItem("ideaforge_token", t), storage.origins[0].localStorage[0].value);
  await page.goto(`${WEB}/settings`);
  await page.reload();
  await expect(page.getByTestId("anthropic-key-input")).toBeVisible();

  await page.getByTestId("anthropic-key-input").fill(USER_KEY);
  await page.getByTestId("save-anthropic-btn").click();
  // saveApiKey updates status and clears the input but doesn't refetch
  // key_hints — reload so the masked hint comes back from the server.
  await page.reload();
  // Once a key is on file the connected view replaces the input with the
  // masked hint + one-click test — the input is gone by design.
  await expect(page.getByTestId("anthropic-key-hint")).toBeVisible();
  const hint = await page.getByTestId("anthropic-key-hint").innerText();
  expect(hint).toContain("4321");            // last-4 only
  expect(hint).not.toContain("e2e-anthropic"); // never key material

  // One-click probe: the stub record must show the USER'S key, not a server default.
  await page.getByTestId("test-anthropic-btn").click();
  await expect(page.getByTestId("anthropic-test-line")).toBeVisible();
  await expect(page.getByTestId("anthropic-test-line")).toContainText("Key works");

  const records = await stubRequests(request);
  const probe = records.filter((r) => r.provider === "anthropic");
  expect(probe.length).toBeGreaterThanOrEqual(1);
  expect(probe.some((r) => r.headers["x-api-key"] === USER_KEY)).toBe(true);

  // The masked hint never carries key material after the probe either.
  const hintAfter = await page.getByTestId("anthropic-key-hint").innerText();
  expect(hintAfter).not.toContain(USER_KEY);
});
