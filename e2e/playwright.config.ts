import { defineConfig } from "@playwright/test";

// E2E harness per the E2E Journey pack §2: real FastAPI backend + real Vite
// production build (preview, not dev server) + provider stub on :9001. The
// only mocked boundary is the three external providers; CI never holds a
// real provider key — every value below is a sentinel.
const API = "http://127.0.0.1:8000";
const STUB = "http://127.0.0.1:9001";
const WEB = "http://127.0.0.1:4173";

export const backendEnv = {
  ENV: "dev",
  MONGO_URL: process.env.MONGO_URL ?? "mongodb://127.0.0.1:27017",
  JWT_SECRET: process.env.JWT_SECRET ?? "e2e-jwt-secret-ci-only-never-production",
  // base64("A".repeat(32)) — test-only vault key, 32 bytes as required.
  ENCRYPTION_MASTER_KEY:
    process.env.ENCRYPTION_MASTER_KEY ?? "QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE=",
  TAVILY_API_KEY: "tvly-e2e-sentinel",
  ANTHROPIC_API_KEY: "sk-ant-e2e-sentinel",
  OPENAI_API_KEY: "sk-e2e-openai-sentinel",
  TAVILY_BASE_URL: STUB,
  ANTHROPIC_BASE_URL: STUB,
  OPENAI_BASE_URL: STUB,
  REMINDER_INTERVAL_SECONDS: "1",
  RATE_LIMIT_AUTH_PER_MINUTE: "1000",
  CORS_ORIGINS: "http://127.0.0.1:4173,http://localhost:4173",
  LOG_LEVEL: "WARNING",
};

export const webServers = [
  {
    command: "python3 -m uvicorn e2e.stub.provider_stub:app --port 9001",
    url: `${STUB}/admin/scenario`,
    cwd: "..",
    reuseExistingServer: !process.env.CI,
  },
  {
    command: "python3 -m uvicorn app.main:app --port 8000",
    url: `${API}/health/live`,
    cwd: "../backend",
    reuseExistingServer: !process.env.CI,
    env: { ...process.env, ...backendEnv },
  },
  {
    command: "npx vite preview --port 4173 --strictPort",
    url: WEB,
    cwd: "../frontend",
    reuseExistingServer: !process.env.CI,
    env: { ...process.env, VITE_PREVIEW_API_TARGET: API },
  },
];

export default defineConfig({
  testDir: "tests",
  timeout: 25_000,
  expect: { timeout: 7_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  projects: [
    // The spec's AC row 6 composite: register → keys → research → ideas →
    // variant → save → board shows entry. Own project so red is visible.
    { name: "critical-path", testMatch: /critical-path\.spec\.js/ },
    { name: "journeys", testMatch: /journeys\/(?!.*ratelimit).*\.spec\.js/ },
    { name: "failures", testMatch: /failures\/(?!.*ratelimit).*\.spec\.js/ },
  ],
  webServer: webServers,
});
