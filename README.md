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
| Frontend | React 19, Tailwind, shadcn/ui (CRA build; Vite migration in progress) |
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
npm ci                        # lockfile is committed; .npmrc sets legacy-peer-deps for the CRA tree
cp .env.example .env.local    # REACT_APP_BACKEND_URL=http://127.0.0.1:8001
npm start
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

> **Landing section** — filled in by the deploy PR: the target is a single
> `docker compose up` (API + web + Mongo + optional Redis) with multi-stage, non-root
> images.

## License

[MIT](LICENSE) — © 2026 Kalisetti Nihanth Naidu.
