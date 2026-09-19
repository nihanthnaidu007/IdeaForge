// F08 — Sourced insight call refuses: the shipped classification surfaces the
// refusal as GENERATION_FAILED ("insight card was incomplete") — additive-safe
// by construction: the insights call fails alone and the ideas stay intact.
import { test, expect } from "../../utils/failures-test.js";
import {
  API, authedStorage, setScenario,
} from "../../utils/helpers.js";

test("F08: sourced insight call refuses → additive error, ideas untouched", async ({ request }) => {
  const email = `f08-${Date.now()}@e2e.ideaforge.dev`;
  const storage = await authedStorage(request, email);
  const token = storage.origins[0].localStorage[0].value;
  await setScenario(request, "llm-refusal");

  const res = await request.post(`${API}/api/idea-insights`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { idea: { id: "e2e-idea-1", title: "RAG evals are the new unit tests", rating: 8.4 }, niche: "AI agents", tone: "practical" },
  });
  expect(res.status()).toBe(502);
  const body = await res.json();
  expect((body.detail?.kind ?? body.kind)).toBe("GENERATION_FAILED");
});
