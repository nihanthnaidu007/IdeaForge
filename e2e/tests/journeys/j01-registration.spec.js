// J01 — Registration & login: the full auth lifecycle with typed validation.
// The signup tab: nav-signup-btn opens the modal; if it lands on the login
// tab, the shipped auth-toggle-btn switches it (both are first-class UI).
import { test, expect } from "@playwright/test";
import {
  WEB, E2E_PASSWORD, installDenyList, routes, API,
} from "../../utils/helpers.js";

async function openSignup(page) {
  await page.goto(WEB);
  await page.getByTestId("nav-signup-btn").click();
  await expect(page.getByTestId("auth-modal")).toBeVisible();
  if (!(await page.getByTestId("auth-name-input").isVisible().catch(() => false))) {
    await page.getByTestId("auth-toggle-btn").click();
  }
  await expect(page.getByTestId("auth-name-input")).toBeVisible();
}

test("J01a: register through the UI → lands on the dashboard", async ({ page, request }) => {
  installDenyList(page, test.info());
  await openSignup(page);

  await page.getByTestId("auth-name-input").fill("Nihanth E2E");
  await page.getByTestId("auth-email-input").fill(`j01-${Date.now()}@e2e.ideaforge.dev`);
  await page.getByTestId("auth-password-input").fill(E2E_PASSWORD);
  await page.getByTestId("auth-submit-btn").click();
  await expect(page).toHaveURL(/dashboard/);
  await expect(page.getByTestId("generate-ideas-btn")).toBeVisible();
});

test("J01b: login through the UI with the registered credentials", async ({ page, request }) => {
  installDenyList(page, test.info());
  const email = `j01b-${Date.now()}@e2e.ideaforge.dev`;
  const reg = await request.post(`${API}${routes.auth.register}`, {
    data: { email, password: E2E_PASSWORD },
  });
  expect(reg.ok()).toBeTruthy();

  await page.goto(WEB);
  await page.getByTestId("nav-login-btn").click();
  await expect(page.getByTestId("auth-modal")).toBeVisible();
  await page.getByTestId("auth-email-input").fill(email);
  await page.getByTestId("auth-password-input").fill(E2E_PASSWORD);
  await page.getByTestId("auth-submit-btn").click();
  await expect(page).toHaveURL(/dashboard/);
});

test("J01c: weak password is rejected with a typed 422", async ({ request }) => {
  const res = await request.post(`${API}${routes.auth.register}`, {
    data: { email: `j01c-${Date.now()}@e2e.ideaforge.dev`, password: "1234567" },
  });
  expect(res.status()).toBe(422);
  const body = await res.json();
  expect(JSON.stringify(body)).toMatch(/password|8/i);
});

test("J01d: duplicate email registration is rejected", async ({ request }) => {
  const email = `j01d-${Date.now()}@e2e.ideaforge.dev`;
  const first = await request.post(`${API}${routes.auth.register}`, {
    data: { email, password: E2E_PASSWORD },
  });
  expect(first.ok()).toBeTruthy();
  const second = await request.post(`${API}${routes.auth.register}`, {
    data: { email, password: E2E_PASSWORD },
  });
  expect(second.status()).toBeGreaterThanOrEqual(400);
  expect(second.status()).toBeLessThan(500);
});
