// Shared E2E helpers: stub control, auth, deny-list. Boundaries per E2E
// pack §2: the stub is the ONLY provider; anything that resolves a real
// provider host fails the test; localStorage keys are the shipped
// AuthContext names.
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
