# IdeaForge Codebase Map

| Path | Type | Purpose |
|------|------|---------|
| `backend/` | Python (FastAPI) | Entire API in `server.py` (~680 lines): JWT auth, trend research, idea generation, post writing, saved ideas, user preferences. Loads `backend/.env`. |
| `backend/server.py` | FastAPI app | Models + 18 routes under `/api` prefix (see flows in obvious.md). Motor async MongoDB client, Tavily search, Emergent LLM chats. |
| `backend/requirements.txt` | pip pins | Fully pinned. Note: `emergentintegrations==0.1.0` is private to Emergent platform (not on public PyPI). |
| `frontend/` | React 19 (CRA + craco) | SPA: landing/auth, dashboard (research → ideas → post), saved ideas, settings. |
| `frontend/src/pages/` | React pages | `LandingPage.js` (hero + auth modal), `Dashboard.js` (main pipeline UI), `SavedIdeas.js`, `Settings.js` (per-user API keys). |
| `frontend/src/components/ui/` | shadcn/ui | Generated Radix-based UI primitives (~40 files). |
| `frontend/src/hooks/`, `frontend/src/lib/` | utils | `use-toast.js`, `utils.js` (cn helper). |
| `frontend/craco.config.js` | build config | Webpack alias `@` → src, eslint react-hooks rules, optional health-check endpoints (`ENABLE_HEALTH_CHECK=true`), Emergent visual-edits wrapper in dev. |
| `frontend/.env.local` | env (untracked) | `REACT_APP_BACKEND_URL` — backend base URL for axios. |
| `memory/PRD.md` | docs | Product requirements: personas, pipeline (Tavily → Claude → GPT), 6 post formats. |
| `tests/` | pytest | Empty (only `__init__.py`) — no tests yet. |
| `backend_test.py` | manual script | Live API smoke tester; defaults to a deployed Emergent preview URL, not local. |
| `test_reports/` | artifacts | Prior pytest/iteration reports (JSON). |
| `.emergent/emergent.yml` | platform | Emergent base image descriptor (fastapi_react_mongo_shadcn). |
