// Shared E2E helpers: stub control, auth, deny-list, fail-loud assertions.
// Boundaries per E2E pack §2: the stub is the ONLY provider; anything that
// resolves a real provider host fails the test; localStorage keys are the
// shipped AuthContext names.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
export const routes = JSON.parse(
  readFileSync(path.join(DIR, "..", "fixtures", "routes.json"), "utf8"),
);
export const API = "http://127.0.0.1:8000";
export const WEB = "http://127.0.0.1:4173";
export const STUB = "http://127.0.0.1:9001";
export const E2E_PASSWORD = "correct-horse-42";

export async function setScenario(request, name) {
  const res = await request.post(`${STUB}/admin/scenario`, { data: { scenario: name } });
  if (!res.ok()) throw new Error(`setScenario(${name}) → ${res.status()}`);
}

export async function stubRequests(request) {
  const res = await request.get(`${STUB}/admin/requests`);
  if (!res.ok()) throw new Error(`stubRequests → ${res.status()}`);
  return res.json();
}

export async function clearStubRequests(request) {
  await request.delete(`${STUB}/admin/requests`);
}

// The deny-list: hard E2E rule — the browser never touches a real provider.
const PROVIDER_HOSTS = /api\.tavily\.com|api\.anthropic\.com|api\.openai\.com/;
export function installDenyList(page, testInfo) {
  page.route(PROVIDER_HOSTS, (route) => {
    throw new Error(`REAL PROVIDER EGRESS in ${testInfo.title}: ${route.request().url()}`);
  });
}

function storageStateFor(origin, token, refresh) {
  return {
    cookies: [],
    origins: [
      {
        origin,
        localStorage: [
          { name: "ideaforge_token", value: token },
          { name: "ideaforge_refresh", value: refresh ?? "" },
        ],
      },
    ],
  };
}

export async function registerViaApi(request, email, password = E2E_PASSWORD) {
  const res = await request.post(`${API}${routes.auth.register}`, {
    data: { email, password, name: "E2E" },
  });
  if (!res.ok()) throw new Error(`register ${email} → ${res.status()} ${await res.text()}`);
  return res.json();
}

export async function loginViaApi(request, email, password = E2E_PASSWORD) {
  const res = await request.post(`${API}${routes.auth.login}`, { data: { email, password } });
  if (!res.ok()) throw new Error(`login ${email} → ${res.status()} ${await res.text()}`);
  return res.json();
}

export async function authedStorage(request, email, origin = WEB) {
  const body = await registerViaApi(request, email);
  return storageStateFor(origin, body.token, body.refresh_token);
}

export async function loginStorage(request, email, origin = WEB) {
  const body = await loginViaApi(request, email);
  return storageStateFor(origin, body.token, body.refresh_token);
}

export async function saveKeysViaApi(request, email, password, keys) {
  const body = await loginViaApi(request, email, password);
  const res = await request.put(`${API}${routes.preferences.put}`, {
    headers: { Authorization: `Bearer ${body.token}` },
    data: keys,
  });
  if (!res.ok()) throw new Error(`save keys → ${res.status()} ${await res.text()}`);
}

// Fenced-failure assertion (§4.0): typed banner + retry affordance + zero
// content of the given selector set, all as visible UI state.
export async function expectTypedFailure(page, { headline, zeroSelectors = [] }) {
  if (headline) await expect(page.getByText(headline).first()).toBeVisible();
  const retry = page.getByTestId("error-retry-btn").first();
  await expect(retry).toBeVisible();
  for (const selector of zeroSelectors) {
    await expect(page.locator(selector)).toHaveCount(0);
  }
}

export const ideaTitles = [
  "RAG evals are the new unit tests",
  "Agent budgets are backwards — measure before you spend",
  "The POC-to-production gap in 2026",
  "We replaced our LLM judge with 40 golden questions",
  "Your copilot is not a teammate yet",
];
