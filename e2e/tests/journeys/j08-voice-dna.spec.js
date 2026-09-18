// J08 — Voice DNA: paste three samples, extract a validated profile with the
// authored confidence and do/don't lists, re-extract to a second version,
// then prove conditioning: the next generation prompt carries the voice.
import { test, expect } from "@playwright/test";
import {
  WEB, installDenyList, authedStorage, setScenario, stubRequests, clearStubRequests,
} from "../../utils/helpers.js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SAMPLES = JSON.parse(
  readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../fixtures/providers/FIX-VOICE-SAMPLES.json"), "utf8"),
);

test("J08: extract voice → confidence + do/don't render → versioned re-extract → conditioning proof", async ({ page, request }) => {
  installDenyList(page, test.info());
  const email = `j08-${Date.now()}@e2e.ideaforge.dev`;
  const storage = await authedStorage(request, email);
  await setScenario(request, "voice-extract");
  await clearStubRequests(request);

  await page.goto(WEB);
  await page.evaluate((t) => localStorage.setItem("ideaforge_token", t), storage.origins[0].localStorage[0].value);
  await page.goto(`${WEB}/settings`);
  await page.reload();
  await expect(page.getByTestId("voice-dna-editor")).toBeVisible();

  await page.getByTestId("voice-samples-input").fill(SAMPLES.join("\n\n---\n\n"));
  await expect(page.getByTestId("voice-cost-hint")).toBeVisible();
  await page.getByTestId("voice-extract-btn").click();

  await expect(page.getByTestId("voice-dna-profile")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("voice-confidence-chip")).toContainText("0.82");
  await expect(page.getByTestId("voice-confidence-copy")).toBeVisible();
  await expect(page.getByTestId("voice-dna-profile")).toContainText("Open on a number or a contrary one-liner");
  await expect(page.getByTestId("voice-dna-profile")).toContainText("Never use emoji or exclamation marks");
  await expect(page.getByTestId("voice-dna-profile")).toContainText("Nobody asks about");
  await expect(page.getByTestId("voice-dna-profile")).toContainText("That's backwards");
  await expect(page.getByTestId("voice-dna-profile")).toContainText("Ask me about");

  // Re-extract: same scenario, version increments, history visible.
  await expect(page.getByTestId("voice-reextract-cost-hint")).toBeVisible();
  await page.getByTestId("voice-reextract-btn").click();
  await expect(page.getByTestId("voice-history")).toBeVisible();

  // Conditioning proof: the generation prompt carries the extracted voice.
  await page.goto(`${WEB}/dashboard`);
  await page.getByTestId("generate-ideas-btn").click();
  await expect(page.getByTestId("idea-card-0")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("idea-card-0").click();
  await page.getByTestId("format-how_to-btn").click();
  await page.getByTestId("craft-post-btn").click();
  await page.waitForTimeout(1200);
  const records = await stubRequests(request);
  const gen = records.filter((r) => r.provider === "anthropic").map((r) => JSON.stringify(r.body));
  expect(gen.some((body) => body.includes("Never use emoji or exclamation marks"))).toBe(true);
});
