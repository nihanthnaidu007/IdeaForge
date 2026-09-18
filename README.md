# IdeaForge

Live trend intelligence for LinkedIn. IdeaForge scans real Tech & AI signal, scores post
ideas, and drafts human-sounding posts in six formats — you bring your own AI keys, the
product never sells you credits.

Part of a production rebuild (branch [`release/production-rebuild`](https://github.com/nihanthnaidu007/IdeaForge/tree/release/production-rebuild)):
the scaffold-era wiring is being replaced with a hardened FastAPI + MongoDB backend and a
Vite-built React frontend.

## What it does

- **Trend Radar** — live research (Tavily) scoped to your niche; every trend carries a source URL.
- **Idea Forge** — rated ideas (1–10) with explanations and audience insights.
- **Post drafts** — six formats: Hot Take, Carousel Idea, Story Post, Listicle, How-To, Contrarian Take.
- **Saved ideas** — bookmark and manage what you've forged.

## Stack

| Layer    | Tech                                                        |
| -------- | ----------------------------------------------------------- |
| Backend  | FastAPI, MongoDB, JWT auth                                  |
| Frontend | React 19, Tailwind, shadcn/ui (Vite build) |
| Research | Tavily API                                                  |
| LLMs     | Anthropic Claude + OpenAI GPT on your own API keys          |

## Prerequisites

- Python 3.11+
- Node 20+
- A MongoDB instance (local `mongod` or a MongoDB Atlas URI)

## Backend setup

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # then edit values — see .env.example for every variable
uvicorn app.main:app --reload --port 8001
```

The API serves `http://127.0.0.1:8001/api/` — `GET /api/` returns
`{"message": "IdeaForge API is running"}`.

## Frontend setup

```bash
cd frontend
npm install                   # lockfile is committed
cp .env.example .env.local    # VITE_BACKEND_URL=http://127.0.0.1:8001
npm run dev
```

The app opens at `http://localhost:3000`.

## Environment variables

- Backend: [`backend/.env.example`](backend/.env.example) — MongoDB connection, JWT secret,
  encryption master key, CORS origins, optional server-default provider keys.
- Frontend: [`frontend/.env.example`](frontend/.env.example) — backend URL.

Never commit real `.env` files or API keys. `.gitignore` blocks them and CI fails on
committed secrets (see `scripts/ci/scaffold-gate.sh`).

## Bring-your-own keys (BYOK)

IdeaForge runs on your own Anthropic/OpenAI/Tavily keys, entered in Settings. Keys are
shown only as `****last4` hints; encryption at rest lands with the hardening PR. Server
operators may optionally set fallback keys via environment.

## Deployment

Self-hosting target: a single `docker compose up` — API (gunicorn + uvicorn workers),
web (nginx serving the Vite build), Mongo 7, and optional Redis. Multi-stage, non-root
images; nginx terminates the SPA and proxies `/api` to the API service.

```bash
cp backend/.env.example backend/.env   # fill MONGO_URL, JWT_SECRET, ENCRYPTION_MASTER_KEY
docker compose up -d --build      # add --profile redis for the optional cache
docker compose ps                 # api and web report healthy
open http://localhost:3000        # web publishes 3000:8080
```

Health checks: `/health/live` (process) and `/health/ready` (Mongo + hooks seeded).
Operator runbook: [`docs/operator-guide.md`](docs/operator-guide.md).

## License

[MIT](LICENSE) — © 2026 Kalisetti Nihanth Naidu.


## End-to-end tests (Playwright, mocked providers)

The E2E harness boots the real backend and the production Vite build (preview mode)
against a deterministic provider stub on port 9001 — no real provider key is ever
used, and CI never holds one.

```bash
mongod &                          # or docker run -p 27017:27017 mongo:7
cd frontend && npm ci && npm run build && cd ..
cd e2e && npm install && npx playwright install chromium
npx playwright test               # journeys + failures + critical path
npx playwright test -c playwright.ratelimit.config.ts   # app-level 429 (F03b)
```

Boundaries: the stub is the only provider; tests hard-fail on any request that
resolves a real provider host. Scenario fixtures live in `e2e/fixtures/`.
