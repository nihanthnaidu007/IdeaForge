# Security Policy

## Build status

This policy describes the completed production rebuild on the
[`release/production-rebuild`](https://github.com/nihanthnaidu007/IdeaForge/tree/release/production-rebuild)
branch; the key-handling and encryption sections below are the target state the build is
checked against, not today's tree. Right now that branch has repository hygiene, a CI
scaffold, the Vite frontend, and documentation — the backend app package, the provider
layer with the encrypted BYOK vault, and Docker/Compose deployment land in upcoming
PRs. Follow
[release PR #2](https://github.com/nihanthnaidu007/IdeaForge/pull/2) for live progress.

## Supported reporting channel

**Do not open a public issue for a security vulnerability.**

Report vulnerabilities privately through GitHub's
[private vulnerability reporting](https://github.com/nihanthnaidu007/IdeaForge/security/advisories/new)
(**Security → Report a vulnerability** on this repository), or by email to the
maintainer: **nihanthnaidu007@gmail.com**.

Please include: what is vulnerable, how to reproduce, and (if you have one) a suggested
fix. You'll get an acknowledgment, a severity assessment, and a timeline; we'll credit
reporters by default unless you prefer otherwise.

## How IdeaForge handles your API keys (BYOK)

IdeaForge runs on your own provider keys — Tavily for research, Anthropic/OpenAI for
generation. The key-handling contract:

- **What is encrypted where.** Keys are encrypted at rest in MongoDB using AES-256-GCM
  envelope encryption. Each ciphertext is encrypted under a per-provider subkey derived
  from the server's `ENCRYPTION_MASTER_KEY` via HKDF, and bound to its owner
  (`user_id:provider`) as authenticated associated data — a ciphertext moved to another
  user's record fails to decrypt rather than silently working. The master key lives only
  in the operator's environment, never in the database.
- **Plaintext lifetime.** A key is decrypted in memory only for the duration of a
  provider call. It is never logged, never written to disk unencrypted, and never
  included in an audit entry.
- **Masked display policy.** After you save a key, the full value is never returned by
  any API — not even to you. Every response shows only a masked hint (`****` plus the
  last 4 characters). If you lose the key, create a new one with the provider.
- **Audit trail.** Key lifecycle events (create, use, rotate, delete, decrypt-failure)
  are recorded in a `key_audit` collection with user, provider, event, request id, and
  timestamp — never key values.
- **What we never do.** IdeaForge does not proxy your key to any third party beyond the
  provider you configured it for, does not use your keys for anything other than the
  actions you trigger, and has no hidden billing or credit system on top of your
  provider accounts.

Operators: the full deployment-side model (master key handling, rotation, rate
limiting, secrets in configuration) is in
[docs/operator-guide.md](docs/operator-guide.md#the-encryption-model-byok-vault).

## Incident note for historical users of this repository

**This repository's early git history contains committed provider API keys from the
original scaffold build** (a research-provider key and an LLM-gateway key, visible in
old revisions of a tracked test script, plus history on the scaffold branch).

**Treat those historical keys as revoked.** If you ever used this repository before the
production rebuild, or copied a key from its history:

1. **Rotate now** — revoke those keys in the provider dashboard and issue new ones.
   Rotation is the only effective fix; deleting a file does not remove a key from git
   history.
2. Do not rely on history rewrites alone. History scrubbing (e.g. `git filter-repo`) is
   an operator decision and does not remove keys from existing clones or forks.
3. The current branch carries no committed keys, and CI enforces a secrets/scaffold
   grep gate on every pull request to prevent regressions.
