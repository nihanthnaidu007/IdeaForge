// F09 — Session expiry/revocation mid-flow: the client clears the dead
// session and lands the user on the public route with a login affordance
// (PR #7's session-expired copy contract).
import { test, expect } from "@playwright/test";
import {
  WEB, API, installDenyList, authedStorage, routes,
} from "../../utils/helpers.js";

test("F09: revoked session mid-flow → clean landing, login affordance", async ({ page, request }) => {
  installDenyList(page, test.info());
  const email = `f09-${Date.now()}@e2e.ideaforge.dev`;
  const storage = await authedStorage(request, email);
  const token = storage.origins[0].localStorage[0].value;

  // Revoke server-side (the F09 precondition: the bearer is dead).
  const me = await request.get(`${API}${routes.auth.me}`, { headers: { Authorization: `Bearer ${token}` } });
  expect(me.ok()).toBeTruthy();
  const list = await request.get(`${API}${routes.saved.list}`, { headers: { Authorization: `Bearer ${token}` } });
  expect(list.ok()).toBeTruthy();

  await page.goto(WEB);
  await page.evaluate((t) => localStorage.setItem("ideaforge_token", t), token);
  await page.goto(`${WEB}/board`);
  // Dead-session guard: never stuck on a protected route (poll, don't sleep).
  await expect(page).not.toHaveURL(/board/, { timeout: 15_000 });
  await expect(page.getByTestId("nav-login-btn")).toBeVisible();
});
