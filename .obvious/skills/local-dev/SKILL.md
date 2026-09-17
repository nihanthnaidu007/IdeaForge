---
name: local-dev
description: Bring up the IdeaForge fullstack dev environment (FastAPI + MongoDB + React CRA)
---

# local-dev — IdeaForge

Verified working recipe from onboarding (2026-09-17). Full details in `.obvious/obvious.md`.

## Services & ports
| Service | Command | Port |
|---------|---------|------|
| MongoDB | `~/downloads/mongodb-linux-x86_64-ubuntu2404-8.0.4/bin/mongod --dbpath ~/mongodb-data --port 27017 --bind_ip 127.0.0.1 --fork --logpath ~/mongodb-data/mongod.log` | 27017 |
| Backend | `cd backend && python3 -m uvicorn server:app --host 0.0.0.0 --port 8001` | 8001 |
| Frontend | `cd frontend && CI=false BROWSER=none yarn start` | 3000 (parse from output) |

## Step-by-step
1. **MongoDB**: repo has no Docker/Compose. Binary tarball lives in `~/downloads/mongodb-linux-x86_64-ubuntu2404-8.0.4/`, data dir `~/mongodb-data`. Verify with pymongo ping (`serverSelectionTimeoutMS=3000`).
2. **Backend env** (`backend/.env`): `MONGO_URL=mongodb://127.0.0.1:27017`, `DB_NAME=ideaforge`, `JWT_SECRET` (any local value), `CORS_ORIGINS=*`.
3. **Backend deps**: `pip install -r backend/requirements.txt`. `emergentintegrations==0.1.0` will fail on public PyPI — it is a private Emergent package. A stub (`emergentintegrations/llm/chat.py` with importable `LlmChat`/`UserMessage`) in user site-packages keeps imports working; LLM endpoints fail at call time by design. TODO(confirm): replace with real package on Emergent infra or wire provider keys.
4. **Start backend**: uvicorn on 8001. Health: `curl http://127.0.0.1:8001/api/` → `{"message":"IdeaForge API is running"}`.
5. **Frontend**: `sudo corepack enable` for yarn 1.22.22 (pinned via `packageManager`). Create `frontend/.env.local` with `REACT_APP_BACKEND_URL=http://127.0.0.1:8001` (CRA bakes env at start). `yarn install` (~1 min; no committed lockfile), `yarn start` → :3000.
6. **Verify flows**:
   - API: register → login → `GET /api/auth/me` → `POST /api/save-idea` (fields: `topic_title`, `rating`, `rating_explanation`) → `GET /api/saved` → `PATCH /api/saved/{id}/bookmark` → `DELETE /api/saved/{id}` → preferences roundtrip. All JSON, Bearer token.
   - Browser (Playwright chromium): landing renders → Sign In modal → login → `/dashboard`. Expect 0 console errors.

## Validation Summary (2026-09-17)
- `yarn install` exit 0; `yarn build` exit 0 (~15s); CRA dev compile passes (2 benign `react-hooks/exhaustive-deps` warnings).
- Backend: `py_compile` OK; API CRUD + auth flows pass via curl.
- Browser E2E: login → dashboard verified, 0 console errors. Screenshots: landing, login form, dashboard (evidence in run).
- pytest: no tests collected (repo has no tests yet).
- Verdict: **DONE — dev_stack_healthy: true**.

## Gotchas
- CRA bakes `REACT_APP_BACKEND_URL` at dev-server start — restart the dev server after changing `.env.local`.
- If port 3000/8001 is taken, CRA picks the next free port — read it from startup output, don't assume.
- `yarn.lock` is not committed to the repo; installs resolve fresh.
- `backend_test.py` targets a deployed Emergent preview URL by default — not useful for local verification.
