# Operator guide

## Build status

This guide describes the completed production rebuild on the
[`release/production-rebuild`](https://github.com/nihanthnaidu007/IdeaForge/tree/release/production-rebuild)
branch — the target state the build is checked against, not today's tree. What exists on
that branch right now: repository hygiene, a CI scaffold, the Vite frontend, the backend
app package, and documentation. Still landing in upcoming PRs: the provider layer with
the encrypted BYOK vault, Docker/Compose deployment, and the feature lanes.
Track [release PR #2](https://github.com/nihanthnaidu007/IdeaForge/pull/2) for live
progress.

Running IdeaForge for real users. This covers configuration, deployment, the
encryption model for user-provided API keys, and observability. For day-to-day product
behavior, see [user-guide.md](user-guide.md).

## Architecture

One deploy unit — `docker compose up` — brings up:

| Service    | Image / build                              | Role                                                    |
| ---------- | ------------------------------------------ | ------------------------------------------------------- |
| `backend`  | multi-stage build, gunicorn + uvicorn workers, non-root | FastAPI app package under `backend/app/`     |
| `frontend` | multi-stage build, nginx                   | Serves the Vite production build                         |
| `mongo`    | `mongo:7`                                  | Primary datastore                                        |
| `redis`    | optional                                   | Shared rate-limit state across backend workers           |

MongoDB is the only stateful service. The backend creates its indexes at startup
(lifespan), including a unique index on `users.email`, so duplicate registrations fail
at the database instead of racing through find-then-insert.

## Deployment from a fresh clone

```bash
git clone https://github.com/nihanthnaidu007/IdeaForge.git
cd IdeaForge
cp backend/.env.example backend/.env    # fill in every required value (see below)
docker compose up --build
```

Verify health once the stack is up:

- `GET /health/live` — process is up.
- `GET /health/ready` — pings MongoDB; only report ready when the DB answers.

## Configuration

Configuration is loaded via pydantic-settings (`backend/app/config.py`). The backend
**refuses to boot** without the required secrets — a missing `JWT_SECRET` or
`ENCRYPTION_MASTER_KEY` is a startup failure, not a warning with a default. In `prod`,
a wildcard `CORS_ORIGINS` value is rejected.

Every variable (names as in `backend/.env.example`):

| Variable                | Required              | Default             | Notes                                                                                                             |
| ----------------------- | --------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `ENV`                   | No                    | `dev`               | `dev` or `prod`. `prod` rejects wildcard CORS and expects real secrets.                                            |
| `MONGO_URL`             | **Yes**               | —                   | MongoDB connection string (local `mongod` or Atlas SRV URI). Boot fails if unset.                                  |
| `DB_NAME`               | No                    | `ideaforge`         | Database name.                                                                                                     |
| `JWT_SECRET`            | **Yes** (in prod/shared deploys) | scaffold default in dev | Token-signing secret. Generate: `python -c "import secrets; print(secrets.token_urlsafe(48))"`. Never commit a real value. |
| `ENCRYPTION_MASTER_KEY` | **Yes** (with BYOK storage) | —           | 32-byte base64 master key for envelope encryption. Generate: `python -c "import base64, os; print(base64.b64encode(os.urandom(32)).decode())"`. Never stored in MongoDB. |
| `CORS_ORIGINS`          | No                    | empty               | Comma-separated explicit origins (e.g. `https://app.example.com`). `*` is rejected in prod. Never combine `*` with credentials. |
| `OPENAI_API_KEY`        | No                    | unset               | Server-default fallback, used only when a user has no saved OpenAI key.                                            |
| `ANTHROPIC_API_KEY`     | No                    | unset               | Server-default fallback, used only when a user has no saved Anthropic key.                                         |
| `TAVILY_API_KEY`        | No                    | unset               | Server-default fallback, used only when a user has no saved Tavily key.                                            |
| `OPENAI_MODEL`          | No                    | `gpt-5.2`           | Model id; env-configurable so defaults can age without code changes.                                               |
| `ANTHROPIC_MODEL`       | No                    | `claude-sonnet-4-5` | Model id; env-configurable.                                                                                        |
| `REDIS_URL`             | No                    | unset               | `redis://...` — shares rate-limit state across workers. See "Rate limiting".                                       |
| `SMTP_URL`              | No                    | unset               | `smtp://user:pass@host:port` — enables email delivery of draft-queue reminders.                                    |

### Server-default keys and resolution order

Per LLM call, keys resolve in order: **user BYOK (decrypted from the vault) →
server env default → typed `400 MISSING_KEYS` error with setup guidance for that
provider.** There is no other fallback and no fabricated output. Server defaults are a
trial-path convenience; they bill the operator's provider accounts, so treat them as
spend you own. Model defaults are env-configurable — switch models without code changes.

## Rate limiting

Auth endpoints (register/login) are rate-limited and return `429`. Without Redis, the
limit is **per-process** — horizontal scaling silently multiplies it. Set `REDIS_URL`
in any multi-worker/multi-node deployment so the limiter shares state.

## Reminders

The draft queue is driven by an **in-process asyncio dispatcher** — no external
scheduler, no cron. It checks scheduled drafts and raises in-app reminders; with
`SMTP_URL` set it also sends email. Deliberate boundary: nothing in IdeaForge posts to
LinkedIn — not on schedule, not unattended. LinkedIn's API terms prohibit automated
posting, and the compliance ceiling is reminders + export + manual posting.

## The encryption model (BYOK vault)

User provider keys are encrypted at rest with AES-256-GCM envelope encryption:

- **Master key** — `ENCRYPTION_MASTER_KEY`, a 32-byte base64 secret. It exists only in
  the environment. It is never written to MongoDB and never appears in API responses.
- **HKDF subkeys** — a per-provider subkey is derived from the master key with HKDF
  (SHA-256), domain-separated by provider (`ideaforge/byok/v1/<provider>`). HKDF, not
  PBKDF2: the master key is high-entropy, not a password. Compartmentalizes providers
  from each other.
- **AAD binding** — every encryption binds the ciphertext to its owner with
  associated data `user_id:provider`. A ciphertext copied into another user's document
  fails decryption instead of silently working. Fresh 12-byte nonce per encryption.
- **What is stored** — per user and provider: `{nonce, ciphertext, key_version, hint}`.
  The plaintext key exists in memory only for the duration of a provider call.
- **Masked display** — the only key material any API response may show is the hint,
  `****` + last 4 characters. Full keys are never returned after save, not even to the
  user who stored them.
- **Rotation** — re-saving a key overwrites the stored material under a fresh nonce;
  `key_version` tracks the envelope format. Rotating the master key re-encrypts on
  next write; plan a maintenance window for bulk re-encryption.
- **`key_audit` collection** — every vault lifecycle event (create, use, rotate,
  delete, decrypt-fail) appends `{user_id, provider, event, request_id, at}`. Audit
  entries never contain key values.

## MongoDB

- Collections: `users` (unique email index, `token_version` for token revocation),
  `user_preferences` (encrypted keys, defaults), `saved_ideas` (board statuses, tags,
  variants, schedule, manual metrics), `voice_profiles` (versioned), `hooks` (seeded
  + user-saved), `key_audit`, `usage_events`.
- Indexes are created at startup. Back up with any standard MongoDB approach —
  `mongodump`/`mongorestore` or Atlas snapshots. The only secrets in the database are
  the envelope-encrypted BYOK keys; losing the master key means those ciphertexts are
  unrecoverable, so back up `ENCRYPTION_MASTER_KEY` in a secrets manager.

## Health and logs

- `GET /health/live` — liveness for orchestrators; no dependencies checked.
- `GET /health/ready` — readiness; pings MongoDB and fails until it answers.
- Logs are structured JSON with a request id on every line, so a request's full trail
  (including `key_audit` events it triggered) is greppable by that id.

## Upgrades

Each merge to `main` is a restorable checkpoint. To upgrade: pull the new revision,
`docker compose up --build` (indexes are ensured at startup), and watch
`/health/ready`. Data migrations ship with the release that needs them.
