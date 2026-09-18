// F08 — Refusal WITH sources present: the forge refuses to stretch beyond
// the evidence; the failure is additive (ideas stay), the reason is shown.
import { test, expect } from "@playwright/test";
import {
  WEB, API, installDenyList, authedStorage, setScenario, clearStubRequests, routes,
} from "../../utils/helpers.js";

test("F08: sourced insight call refuses → additive error, ideas untouched", async ({ page, request }) => {
  installDenyList(page, test.info());
  const email = `f08-${Date.now()}@e2e.ideaforge.dev`;
  const storage = await authedStorage(request, email);
  const token = storage.origins[0].localStorage[0].value;
  await setScenario(request, "llm-refusal");
  await clearStubRequests(request);

  const res = await request.post(`${API}${routes.ideas.insights}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { idea: { title: "RAG evals are the new unit tests", rating: 8.4 } },
  });
  expect([502, 422]).toContain(res.status());
  const body = await res.json();
  expect(body.detail.kind ?? body.kind).toBe("GENERATION_REFUSED");

  await page.goto(WEB);
  await page.evaluate((t) => localStorage.setItem("ideaforge_token", t), token);
  await page.goto(`${WEB}/dashboard`);
  await page.reload();
  await page.getByTestId("generate-ideas-btn").click();
  await expect(page.getByTestId("idea-card-0")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("idea-card-0").click();
  await page.getByTestId("generate-insights-0-btn").click();
  await expect(page.getByTestId("insights-error-0")).toBeVisible();
  const errText = await page.getByTestId("insights-error-0").innerText();
  expect(errText).toMatch(/refus|sources|unsupported|failed/i);
  await expect(page.getByTestId("idea-card-0")).toBeVisible();
});
