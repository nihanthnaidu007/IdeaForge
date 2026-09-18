// J01 — Registration & login: create an account, duplicate e-mail and short
// password rejected, logout, login again. No provider egress at any step.
import { test, expect } from "@playwright/test";
import {
  WEB, E2E_PASSWORD, installDenyList, registerViaApi, stubRequests, clearStubRequests, API, routes,
} from "../../utils/helpers.js";

test("J01: register → duplicate rejected → bad password rejected → logout → login", async ({ page, request }) => {
  installDenyList(page, test.info());
  const email = `j01-${Date.now()}@e2e.ideaforge.dev`;
  await clearStubRequests(request);

  await page.goto(WEB);
  await expect(page.getByTestId("navbar")).toBeVisible();
  await page.getByTestId("nav-signup-btn").click();
  await expect(page.getByTestId("auth-modal")).toBeVisible();

  // Create the account.
  await page.getByTestId("auth-name-input").fill("J One");
  await page.getByTestId("auth-email-input").fill(email);
  await page.getByTestId("auth-password-input").fill(E2E_PASSWORD);
  await page.getByTestId("auth-submit-btn").click();
  await expect(page).toHaveURL(/dashboard/);
  await expect(page.getByTestId("navbar")).toContainText("J One");

  // Logout (revokes the refresh family server-side).
  await page.getByTestId("nav-logout-btn").click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("nav-login-btn")).toBeVisible();

  // Duplicate email is rejected loudly in the modal.
  await page.getByTestId("nav-signup-btn").click();
  await page.getByTestId("auth-name-input").fill("Again");
  await page.getByTestId("auth-email-input").fill(email);
  await page.getByTestId("auth-password-input").fill(E2E_PASSWORD);
  await page.getByTestId("auth-submit-btn").click();
  await expect(page.getByTestId("auth-error")).toBeVisible();

  // Passwords violating policy are rejected (letter+digit rule, 9 chars).
  await page.getByTestId("auth-email-input").fill(`j01b-${Date.now()}@e2e.ideaforge.dev`);
  await page.getByTestId("auth-password-input").fill("123456789");
  await page.getByTestId("auth-submit-btn").click();
  await expect(page.getByTestId("auth-error")).toBeVisible();

  // Login again with the original credentials.
  await page.getByTestId("nav-login-btn").click();
  await page.getByTestId("auth-email-input").fill(email);
  await page.getByTestId("auth-password-input").fill(E2E_PASSWORD);
  await page.getByTestId("auth-submit-btn").click();
  await expect(page).toHaveURL(/dashboard/);

  // No-fabrication: a pure auth journey never touches a provider.
  expect(await stubRequests(request)).toEqual([]);
});

test("J01b: short password rejected at the API (typed 422)", async ({ request }) => {
  const res = await request.post(`${API}${routes.auth.register}`, {
    data: { email: `j01c-${Date.now()}@e2e.ideaforge.dev`, password: "123456789" },
  });
  expect(res.status()).toBe(422);
});
