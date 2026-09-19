// F09 — Revoked session mid-flow: the dead access token's 401 triggers the
// single-flight refresh; the revoked refresh fails (reuse detection revokes
// the family) and the shipped handler surfaces "Your session expired — log
// in again." — either the redirect to / or the toast is the honest signal.
import { test, expect } from "../../utils/failures-test.js";
import {
  WEB, API, installDenyList, authedStorage, setScenario, routes,
} from "../../utils/helpers.js";

test("F09: revoked session mid-flow → clean landing, login affordance", async ({ page, request }) => {
  installDenyList(page, test.info());
  const email = `f09-${Date.now()}@e2e.ideaforge.dev`;
  const storage = await authedStorage(request, email);
  const entries = storage.origins[0].localStorage;
  const token = entries.find((e) => e.name === "ideaforge_token")?.value;
  const refresh = entries.find((e) => e.name === "ideaforge_refresh")?.value;

  // Revoke server-side: logout bumps token_version and revokes the family.
  const logout = await request.post(`${API}${routes.auth.logout}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { refresh_token: refresh },
  });
  expect(logout.ok()).toBeTruthy();

  // Mid-flow: the browser still holds the (now dead) token pair.
  await page.goto(WEB);
  await page.evaluate(([t, r]) => {
    localStorage.setItem("ideaforge_token", t);
    if (r) localStorage.setItem("ideaforge_refresh", r);
  }, [token, refresh]);

  await page.goto(`${WEB}/board`);
  await expect.poll(async () => {
    const redirected = !page.url().includes("/board");
    const toast = await page
      .getByText("Your session expired — log in again.")
      .isVisible()
      .catch(() => false);
    return redirected || toast;
  }, { timeout: 15_000 }).toBe(true);
  await expect(page.getByTestId("nav-login-btn")).toBeVisible();
});
