import { defineConfig } from "@playwright/test";
import { webServers } from "./playwright.config";

// F03b project (E2E pack §4): app-level 429 needs RATE_LIMIT_AUTH_PER_MINUTE=3
// on a dedicated backend instance (and the preview proxy pointed at it), so
// this config boots its own stack on shifted ports.
const RL_BACKEND = "http://127.0.0.1:8002";
// Each npx invocation tears down its own webservers — specs under THIS config
// must reach its :8002 backend, never the main project's :8000 (F03b CI red,
// run 35328956125).
process.env.E2E_API_BASE = RL_BACKEND;

const rlWebServers = webServers.map((server) => {
  const env = (server.env ?? {}) as Record<string, string>;
  if (server.url?.includes(":8000")) {
    return {
      ...server,
      command: "python3 -m uvicorn app.main:app --port 8002",
      url: `${RL_BACKEND}/health/live`,
      env: { ...env, RATE_LIMIT_AUTH_PER_MINUTE: "3" },
    };
  }
  if (server.url?.includes(":4173")) {
    return { ...server, env: { ...env, VITE_PREVIEW_API_TARGET: RL_BACKEND } };
  }
  return server;
});

export default defineConfig({
  testDir: "tests",
  timeout: 25_000,
  expect: { timeout: 7_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  projects: [{ name: "ratelimit", testMatch: /ratelimit\.spec\.js/ }],
  webServer: rlWebServers,
});
