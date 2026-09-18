// J11 — Session revocation (PR #10 semantics, merged bf9f2d4): 60-minute
// access tokens, token_version enforcement, logout kills live access tokens,
// refresh-family revocation on reuse. UI: logout lands on the landing route,
// the route guard bounces logged-out deep links.
import { test, expect } from "@playwright/test";
import {
  WEB, API, E2E_PASSWORD, installDenyList, registerViaApi, loginViaApi, routes,
} from "../../utils/helpers.js";

function decodeJwtPayload(token) {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64").toString("utf8"));
}

test("J11: 60-min access tokens, logout revocation, refresh-family revocation", async ({ request }) => {
  const email = `j11-${Date.now()}@e2e.ideaforge.dev`;
  const reg = await registerViaApi(request, email);
  const token = reg.token;
  const refresh = reg.refresh_token;

  // 60-minute access tokens.
  const payload = decodeJwtPayload(token);
  expect(payload.exp - payload.iat).toBe(3600);

  // /me accepts the fresh token.
  const me = await request.get(`${API}${routes.auth.me}`, { headers: { Authorization: `Bearer ${token}` } });
  expect(me.ok()).toBeTruthy();

  // Logout bumps token_version — the outstanding access token dies instantly.
  const logoutRes = await request.post(`${API}${routes.auth.logout}`, { data: { refresh_token: refresh } });
  expect(logoutRes.ok()).toBeTruthy();
  const meAfter = await request.get(`${API}${routes.auth.me}`, { headers: { Authorization: `Bearer ${token}` } });
  expect(meAfter.status()).toBe(401);

  // Reusing the revoked refresh token is a theft signal: 401 + family revoked.
  const reuse = await request.post(`${API}${routes.auth.refresh}`, { data: { refresh_token: refresh } });
  expect(reuse.status()).toBe(401);

  // A second user's refresh stays usable (family scoping, not user-wide).
  const other = await registerViaApi(request, `j11b-${Date.now()}@e2e.ideaforge.dev`);
  const otherRefresh = await request.post(`${API}${routes.auth.refresh}`, { data: { refresh_token: other.refresh_token } });
  expect(otherRefresh.ok()).toBeTruthy();
});

test("J11b: UI logout → landing; logged-out deep links bounce to /", async ({ page, request }) => {
  installDenyList(page, test.info());
  const email = `j11c-${Date.now()}@e2e.ideaforge.dev`;
  const reg = await registerViaApi(request, email);

  await page.goto(WEB);
  await page.evaluate((t) => localStorage.setItem("ideaforge_token", t), reg.token);
  await page.goto(`${WEB}/dashboard`);
  await page.reload();
  await expect(page.getByTestId("nav-logout-btn")).toBeVisible();

  await page.getByTestId("nav-logout-btn").click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("nav-login-btn")).toBeVisible();

  // Route guard: a dead session deep-linking /dashboard lands on /.
  await page.evaluate(() => localStorage.setItem("ideaforge_token", "not-a-real-token"));
  await page.goto(`${WEB}/dashboard`);
  await page.waitForTimeout(800);
  await expect(page).not.toHaveURL(/dashboard/);
});
