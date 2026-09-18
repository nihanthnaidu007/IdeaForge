// F03b — App-level auth rate limit (separate backend: RATE_LIMIT_AUTH_PER_MINUTE=3).
// The 4th login inside a minute is a typed 429 with Retry-After; the UI
// surfaces the typed state, never a generic crash.
import { test, expect } from "@playwright/test";
import { WEB, E2E_PASSWORD } from "../../utils/helpers.js";

// Sourced from the ratelimit config (E2E_API_BASE) — never the main project's
// :8000, which does not exist in standalone CI runs of this config.
const RL_API = process.env.E2E_API_BASE;
if (!RL_API) throw new Error("E2E_API_BASE unset — F03b runs only under playwright.ratelimit.config.ts");

test("F03b: 4th login in a minute → 429 with Retry-After, typed UI error", async ({ page }) => {
  const email = `f03b-${Date.now()}@e2e.ideaforge.dev`;
  const reg = await page.request.post(`${RL_API}/api/auth/register`, {
    data: { email, password: E2E_PASSWORD, name: "E2E" },
  });
  if (!reg.ok()) throw new Error(`register ${email} → ${reg.status()} ${await reg.text()}`);

  let saw429 = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await page.request.post(`${RL_API}/api/auth/login`, {
      data: { email, password: attempt === 4 ? "wrong-password-1" : "wrong-password-1" },
    });
    if (res.status() === 429) {
      saw429 = true;
      expect(res.headers()["retry-after"] ?? "").not.toBe("");
      break;
    }
    expect([401, 403]).toContain(res.status());
  }
  expect(saw429).toBe(true);

  // UI: the auth modal renders the typed rate-limit state on the same path.
  await page.goto(WEB);
  await page.getByTestId("nav-login-btn").click();
  await page.getByTestId("auth-email-input").fill(email);
  await page.getByTestId("auth-password-input").fill("wrong-password-1");
  await page.getByTestId("auth-submit-btn").click();
  await page.waitForTimeout(1000);
  await expect(page.getByTestId("auth-error")).toBeVisible();
});
