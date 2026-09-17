# IdeaForge — Agent Guide

LinkedIn Idea Generator: scans live Tech & AI trends (Tavily), generates scored post
ideas (Claude via Emergent LLM key), and writes human-sounding LinkedIn posts (GPT via
Emergent LLM key). JWT auth, MongoDB persistence, saved/bookmarked ideas.

## Stack

| Layer | Tech |
|-------|------|
| Backend | Python 3.13, FastAPI 0.110, motor (MongoDB), uvicorn — single file `backend/server.py` |
| Database | MongoDB (no migrations; collections created lazily: `users`, `saved_ideas`, `user_preferences`) |
| Frontend | React 19, Create React App via craco, Tailwind, shadcn/ui, React Router 7, axios |
| Package mgr | yarn 1.22.22 (pinned via `packageManager` in frontend/package.json); pip for backend |

## Local dev setup (sandbox-verified 2026-09-17)

### 1. MongoDB
The repo ships no Dockerfile/Compose. Install MongoDB locally (or point at any reachable instance):
```bash
# one-time: download server binaries (x86_64 ubuntu2404)
curl -sSL -o ~/downloads/mongodb.tgz https://fastdl.mongodb.org/linux/mongodb-linux-x86_64-ubuntu2404-8.0.4.tgz
tar xzf ~/downloads/mongodb.tgz -C ~/downloads
mkdir -p ~/mongodb-data
~/downloads/mongodb-linux-x86_64-ubuntu2404-8.0.4/bin/mongod --dbpath ~/mongodb-data --port 27017 --bind_ip 127.0.0.1 --fork --logpath ~/mongodb-data/mongod.log
```

### 2. Backend (FastAPI, port 8001)
```bash
cat > backend/.env <<'ENVEOF'
MONGO_URL=mongodb://127.0.0.1:27017
DB_NAME=ideaforge
JWT_SECRET=local_dev_secret_not_for_production
CORS_ORIGINS=*
ENVEOF
pip install -r backend/requirements.txt
cd backend && python3 -m uvicorn server:app --host 0.0.0.0 --port 8001
```
- Port 8001 is the canonical local port (not enforced by the repo — pick any; frontend URL must match).
- **`emergentintegrations==0.1.0` is a private Emergent-platform package, not on public PyPI.** A local stub must be importable (`emergentintegrations.llm.chat.LlmChat/UserMessage`). TODO(confirm): on Emergent infrastructure install the real package. Without it, LLM-backed endpoints (`/api/research`, `/generate-ideas`, `/idea-insights`, `/generate-post`, `/regenerate-post`, `/tweak-post`) raise at call time; auth/save/preferences endpoints are unaffected.

### 3. Frontend (React, CRA dev server)
```bash
sudo corepack enable && export COREPACK_ENABLE_DOWNLOAD_PROMPT=0   # provides yarn 1.22.22
cd frontend
printf 'REACT_APP_BACKEND_URL=http://127.0.0.1:8001\nBROWSER=none\n' > .env.local
yarn install
CI=false BROWSER=none yarn start        # dev server, parse actual port from output (3000)
yarn build                              # production build
```

## Environment variables

| Var | Where | Required | Notes |
|-----|-------|----------|-------|
| `MONGO_URL` | backend/.env | yes | e.g. `mongodb://127.0.0.1:27017` |
| `DB_NAME` | backend/.env | yes | `ideaforge` |
| `JWT_SECRET` | backend/.env | no | has code default; set any local value |
| `CORS_ORIGINS` | backend/.env | no | defaults to `*` |
| `EMERGENT_LLM_KEY` | backend/.env | no | Emergent universal LLM key; TODO(confirm) obtain from Emergent platform |
| `TAVILY_API_KEY` | backend/.env | no | fallback Tavily key; users can add per-user keys in Settings |
| `REACT_APP_BACKEND_URL` | frontend/.env.local | yes | e.g. `http://127.0.0.1:8001` |

## Verify it's healthy
```bash
curl http://127.0.0.1:8001/api/          # -> {"message":"IdeaForge API is running"}
curl -s http://127.0.0.1:8001/docs -o /dev/null -w "%{http_code}\n"   # 200
curl -s http://localhost:3000/ -o /dev/null -w "%{http_code}\n"       # 200
```

## Primary user flows (verified end-to-end 2026-09-17)
1. **Auth**: `POST /api/auth/register` → `POST /api/auth/login` → `GET /api/auth/me` (JWT Bearer).
2. **Saved ideas CRUD**: `POST /api/save-idea` (requires `topic_title`, `rating`, `rating_explanation`) → `GET /api/saved` → `PATCH /api/saved/{id}/bookmark` → `DELETE /api/saved/{id}`.
3. **Browser flow**: landing page → "Sign In" modal → login → redirect to `/dashboard`; niche/tone selector + research prompt render. LLM-backed actions require API keys (per-user via Settings, or fallback env vars).
4. **Preferences**: `POST /api/preferences` / `GET /api/preferences`.

## Codebase map
See [codebase-map.md](./codebase-map.md).

## Local verification
- `yarn build` — exit 0 (~15s).
- CRA compile — passes with 2 benign `react-hooks/exhaustive-deps` warnings (`SavedIdeas.js:50`, `Settings.js:58`).
- `python3 -m py_compile backend/server.py` — OK.
- pytest — **no tests exist** (`tests/` has only `__init__.py`; `backend_test.py` is a manual script targeting a deployed URL).
- Playwright browser run — landing renders, login → dashboard, 0 console errors.

## Snapshot
- Snapshot ID: `dronbf7ljhi6ftta4zeq:default` (captured 2026-09-17T19:07:29.997Z, sandbox `ipc7ee4oj5tg7uz0eo2aq`)
- State captured with: mongod (27017), uvicorn (8001), CRA dev server (3000) running; deps installed; working dev stack.

## Gotchas
- `yarn.lock` is not committed; first `yarn install` resolves fresh (~1 min).
- `craco.config.js` calls `require("dotenv")` — resolved transitively from node_modules.
- `@emergentbase/visual-edits` is fetched from `assets.emergent.sh` during install; wraps craco config in dev mode.
- JWT default secret in code is `ideaforge_default_secret`; fine locally, never in production.
