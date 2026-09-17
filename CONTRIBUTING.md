# Contributing to IdeaForge

Thanks for helping build IdeaForge. This covers how work flows, what CI expects, and
where tests live. Product behavior is specified in [docs/user-guide.md](docs/user-guide.md);
deployment in [docs/operator-guide.md](docs/operator-guide.md).

## Branching and PR flow

- Work happens on feature branches targeting **`release/production-rebuild`** — the
  integration branch for the production rebuild. The release PR then aggregates to
  `main`. Do not open PRs against `main` unless the change is release-level.
- Keep PRs one work stream each. Every squash-merged PR is a restorable checkpoint, so
  a PR should leave the branch in a working state on its own.
- CI must be green before merge. Squash merge only (one commit per PR in the release
  history).

## Conventional commits

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: real variant generation with variation instructions
fix: map provider quota errors to typed 402
docs: operator guide for compose deployment
chore: prune unused radix packages
refactor: extract key resolution into provider layer
test: vault round-trip and foreign-AAD rejection tests
```

Use the imperative mood and a scope when it clarifies (`feat(voice):`).

## Test tiers

| Tier         | What runs where                                            | What it covers                                                        |
| ------------ | ---------------------------------------------------------- | ----------------------------------------------------------------------- |
| Unit         | pytest, in-process; repository-layer fakes and mocked SDKs at the import seam | Routers, services, key resolution, exporters — fast, no containers |
| Integration  | pytest against real MongoDB (`mongo:7` service container)   | Actual persistence behavior: indexes, uniqueness races, status workflows |
| E2E          | Playwright against the compose stack with mocked providers  | The critical path: register → keys → research → ideas → variants → save → board |

Rules that hold across all tiers:

- **No live provider calls in CI, ever.** Provider SDKs are mocked at the import seam;
  research runs against a fake Tavily.
- New backend behavior ships with tests in the same PR; name test files after the
  behavior (`test_provider_resolution.py`, not `test_utils2.py`).
- Frontend tests use Vitest + React Testing Library; every async surface gets a test
  for its loading, empty, error-retry, and quota states.

## Lint and style

- **Python:** `ruff` — clean on everything under `backend/app/` and `tests/`. No `Any`
  smuggling past the typechecker; typed errors over string matching.
- **JS/JSX:** `eslint` on the Vite build; warnings are fix-forward, not suppressed.
- Comments explain *why*, not *what*; if the code can say it, the comment shouldn't.

## CI expectations

GitHub Actions runs two jobs on every PR (see `.github/workflows/ci.yml`):

1. **Backend** — ruff + pytest (unit tier; integration tier uses a mongo service).
2. **Frontend** — npm ci, lint, vitest, build — plus a **secrets & scaffold grep gate**
   that fails the build on committed secrets or leftover scaffold strings anywhere in
   the repo. Don't test around the gate; it exists because this repo had real keys
   committed once.

Local checks before pushing (local is the primary gate; CI is the final gate):

```bash
cd backend && ruff check . && pytest -q
cd ../frontend && npm ci && npm run lint && npx vitest run && npm run build
```

## Security-sensitive changes

Anything touching key storage, provider calls, auth, or CORS: read
[SECURITY.md](SECURITY.md) and [docs/operator-guide.md](docs/operator-guide.md#the-encryption-model-byok-vault)
first. Hard constraints, not preferences:

- No plaintext BYOK keys at rest; no key material in API responses beyond the masked hint.
- No new silent fallbacks — provider failures are typed errors, never synthetic content.
- No LinkedIn auto-posting or scraping, ever; the product's ceiling is reminders,
  export, and manual posting.

Vulnerabilities go through the private channel in SECURITY.md, not public issues.
