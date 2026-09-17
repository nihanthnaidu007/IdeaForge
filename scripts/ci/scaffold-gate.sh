#!/usr/bin/env bash
# CI scaffold gate: fails on committed secrets or Emergent/scaffold strings
# anywhere in the repo except .git/node_modules/build artifacts.
#
# ALLOWLISTED paths still carry scaffold references on purpose — they are owned
# by sibling rebuild PRs, and each PR deletes its entry as it purges its own
# references:
#   backend/server.py, backend/requirements.txt          -> provider-layer PR
#                                                           (direct SDKs replace emergentintegrations)
#   frontend/craco.config.js, frontend/package.json,
#   frontend/package-lock.json                           -> Vite-migration PR
#                                                           (drops @emergentbase/visual-edits)
#   frontend/src/                                        -> app-cleanup PR
#                                                           (Universal Key copy in Dashboard/Settings)
# scripts/ci/scaffold-gate.sh, tests/test_smoke.py      -> self-referential: these two files
#                                                           define the patterns being matched
set -euo pipefail
cd "$(dirname "$0")/../.."

SECRET_RE='tvly-[A-Za-z0-9_-]{16,}|sk-emergent-[A-Za-z0-9]+|sk-ant-[A-Za-z0-9_-]{16,}|sk-proj-[A-Za-z0-9_-]{16,}|sk-[A-Za-z0-9]{48}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,}|xox[baprs]-[A-Za-z0-9-]{10,}|phc_[A-Za-z0-9]{20,}'
SCAFFOLD_RE='emergent|Universal Key'
ALLOW_RE='^\.?/?(backend/server\.py|backend/requirements\.txt|frontend/craco\.config\.js|frontend/package\.json|frontend/package-lock\.json|frontend/src/|scripts/ci/scaffold-gate\.sh|tests/test_smoke\.py)'

fails=$(grep -rInE \
    --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=build \
    --exclude-dir=dist --exclude-dir=__pycache__ --exclude-dir=.venv \
    --exclude-dir=.pytest_cache --exclude-dir=.ruff_cache \
    -e "$SECRET_RE" -e "$SCAFFOLD_RE" . \
    | sed 's|^\./||' \
    | grep -vE "$ALLOW_RE" || true)

if [ -n "$fails" ]; then
    echo "Scaffold gate FAILED — committed secrets or Emergent/scaffold strings outside the allowlist:"
    echo "$fails"
    echo "Allowed paths: sibling-PR-owned files (see the comment block at the top)"
    exit 1
fi

echo "Scaffold gate OK — no committed secrets or scaffold strings outside the allowlist."
