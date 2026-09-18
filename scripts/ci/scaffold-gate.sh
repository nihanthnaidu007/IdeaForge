#!/usr/bin/env bash
# CI scaffold gate: fails on committed secrets or Emergent/scaffold strings
# anywhere in the repo except .git/node_modules/build artifacts.
#
# Secret-shaped tokens are banned EVERYWHERE, e2e/ included: E2E fixtures use
# non-secret-shaped sentinel keys (e2e-...), so nothing legitimate matches —
# a real-shaped key under e2e/ is a leak this gate must catch.
#
# Scaffold-string ALLOWED paths still carry references on purpose:
#   frontend/src/                                        -> app-cleanup PR
#                                                           (Universal Key copy in Dashboard/Settings)
#   e2e/                                                 -> pattern-defining: the F02 spec quotes
#                                                           "Emergent" to assert the UI never leaks it
#   .github/workflows/ci.yml                             -> self-referential: its dist-hygiene
#                                                           step greps for the same patterns
# scripts/ci/scaffold-gate.sh, tests/test_smoke.py      -> self-referential: these two files
#                                                           define the patterns being matched
set -euo pipefail
cd "$(dirname "$0")/../.."

SECRET_RE='tvly-[A-Za-z0-9_-]{16,}|sk-emergent-[A-Za-z0-9]+|sk-ant-[A-Za-z0-9_-]{16,}|sk-proj-[A-Za-z0-9_-]{16,}|sk-[A-Za-z0-9]{48}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,}|xox[baprs]-[A-Za-z0-9-]{10,}|phc_[A-Za-z0-9]{20,}'
SCAFFOLD_RE='emergent|Universal Key'
# Self-referential/sibling-owned: these quote the patterns they define or are
# owned by sibling rebuild PRs. The scaffold scan additionally exempts e2e/;
# the secret scan does not.
SECRET_ALLOW_RE='^\.?/?(frontend/src/|frontend/package|\.github/workflows/ci\.yml|scripts/ci/scaffold-gate\.sh|tests/test_smoke\.py)'
SCAFFOLD_ALLOW_RE="${SECRET_ALLOW_RE}|^\.?/?e2e/"

scan() {
    local re="$1" allow="$2"
    grep -rInE \
        --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=build \
        --exclude-dir=dist --exclude-dir=__pycache__ --exclude-dir=.venv \
        --exclude-dir=.pytest_cache --exclude-dir=.ruff_cache \
        -e "$re" . \
        | sed 's|^\./||' \
        | grep -vE "$allow" || true
}

fails="$(scan "$SECRET_RE" "$SECRET_ALLOW_RE")$(scan "$SCAFFOLD_RE" "$SCAFFOLD_ALLOW_RE")"

if [ -n "$fails" ]; then
    echo "Scaffold gate FAILED — committed secrets or Emergent/scaffold strings outside the allowlist:"
    echo "$fails"
    echo "Allowed paths: pattern-defining/self-referential files and sibling-PR-owned files (see the comment block at the top)"
    exit 1
fi

echo "Scaffold gate OK — no committed secrets or scaffold strings outside the allowlist."
