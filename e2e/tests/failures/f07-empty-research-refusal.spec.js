// F07 — Empty Tavily results: the backend refuses to fabricate (ResearchError
// → typed RESEARCH_FAILED), zero ideas generated.
import { test, expect } from "@playwright/test";
import {
  API, authedStorage, setScenario,
} from "../../utils/helpers.js";

test("F07: empty Tavily results → typed refusal, zero fabricated ideas", async ({ request }) => {
  const email = `f07-${Date.now()}@e2e.ideaforge.dev`;
  const storage = await authedStorage(request, email);
  const token = storage.origins[0].localStorage[0].value;
  await setScenario(request, "forge-no-sources");

  const res = await request.post(`${API}/api/research`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { niche: "AI agents", tone: "practical" },
  });
  expect(res.status()).toBe(502);
  const body = await res.json();
  expect((body.detail?.kind ?? body.kind)).toBe("RESEARCH_FAILED");
});
