"""Repo-hygiene smoke tests for the production rebuild.

The backend restructure has landed, so this suite guards the full tree: for
every file in the working tree it asserts:

- no scaffold artifact survived the purge (including the deleted backend/server.py);
- no committed provider-key-shaped secrets anywhere;
- no Emergent/scaffold strings outside paths owned by sibling PRs.

Mirrors scripts/ci/scaffold-gate.sh, which enforces the same contract in CI.
"""

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]

# Scaffold artifacts that must stay gone (spec: repo root carries only product files).
GONE_ARTIFACTS = (
    "backend/server.py",
    "backend_test.py",
    ".gitconfig",
    ".emergent",
    "test_result.md",
    "test_reports",
    "memory",
    "design_guidelines.json",
)

# Secret-shaped tokens: Tavily, Emergent, Anthropic, OpenAI (project + legacy),
# AWS, Google, GitHub, Slack, PostHog.
SECRET_RE = re.compile(
    r"tvly-[A-Za-z0-9_-]{16,}"
    r"|sk-emergent-[A-Za-z0-9]+"
    r"|sk-ant-[A-Za-z0-9_-]{16,}"
    r"|sk-proj-[A-Za-z0-9_-]{16,}"
    r"|sk-[A-Za-z0-9]{48}"
    r"|AKIA[0-9A-Z]{16}"
    r"|AIza[0-9A-Za-z_-]{35}"
    r"|ghp_[A-Za-z0-9]{36}"
    r"|github_pat_[A-Za-z0-9_]{22,}"
    r"|xox[baprs]-[A-Za-z0-9-]{10,}"
    r"|phc_[A-Za-z0-9]{20,}"
)

# Emergent/scaffold markers.
SCAFFOLD_RE = re.compile(r"emergent|Universal Key", re.IGNORECASE)

# Paths sibling rebuild PRs own; each PR purges its own references.
SIBLING_OWNED_EXACT = (
    "frontend/package.json",
    "frontend/package-lock.json",
)

# Pattern-defining files — they quote the scaffold strings they match against.
# .github/workflows/ci.yml qualifies too: its dist-hygiene step greps dist/ for
# the same markers this test bans from source.
SELF_REFERENTIAL = (
    "scripts/ci/scaffold-gate.sh",
    "tests/test_smoke.py",
    ".github/workflows/ci.yml",
)
SIBLING_OWNED_PREFIXES = ("frontend/src/",)

SKIP_DIRS = {
    ".git",
    "node_modules",
    "build",
    "dist",
    "__pycache__",
    ".venv",
    "venv",
    ".pytest_cache",
    ".ruff_cache",
    ".idea",
    ".vscode",
}


def _repo_files():
    for path in sorted(REPO_ROOT.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(REPO_ROOT).as_posix()
        if any(part in SKIP_DIRS for part in path.relative_to(REPO_ROOT).parts):
            continue
        yield rel, path


def test_scaffold_artifacts_are_gone():
    leftovers = [name for name in GONE_ARTIFACTS if (REPO_ROOT / name).exists()]
    assert leftovers == [], f"scaffold artifacts still present: {leftovers}"


def test_no_committed_secrets():
    hits = [
        rel
        for rel, path in _repo_files()
        if SECRET_RE.search(path.read_text(encoding="utf-8", errors="ignore"))
    ]
    assert hits == [], (
        "possible committed secrets — rotate the keys, then remove the files "
        f"(never sanitize in place): {hits}"
    )


def test_no_scaffold_strings_outside_sibling_owned_paths():
    hits = [
        rel
        for rel, path in _repo_files()
        if rel not in SIBLING_OWNED_EXACT
        and rel not in SELF_REFERENTIAL
        and not rel.startswith(SIBLING_OWNED_PREFIXES)
        and SCAFFOLD_RE.search(path.read_text(encoding="utf-8", errors="ignore"))
    ]
    assert hits == [], (
        "Emergent/scaffold strings found — purge them, or they belong to a "
        f"sibling PR (add to SIBLING_OWNED): {hits}"
    )
