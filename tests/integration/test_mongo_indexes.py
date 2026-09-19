"""Integration tier: real MongoDB (mongo:7) index + race behavior.

Runs only when MONGO_TEST_URL is provided (CI wires a mongo:7 service
container). The sandbox/local fast tier runs on the in-memory fakes.
"""

from __future__ import annotations

import os

import pytest
from app.db import ensure_indexes

pytestmark = pytest.mark.skipif(
    not os.environ.get("MONGO_TEST_URL"),
    reason="integration tier needs MONGO_TEST_URL (mongo:7 service in CI)",
)


@pytest.fixture
async def real_db():
    from pymongo.asynchronous.mongo_client import AsyncMongoClient

    client = AsyncMongoClient(
        os.environ["MONGO_TEST_URL"], serverSelectionTimeoutMS=5_000
    )
    db = client["ideaforge_test"]
    # Start each test from a clean slate.
    for name in (
        "users",
        "refresh_tokens",
        "saved_ideas",
        "user_preferences",
        "key_audit",
    ):
        await db.drop_collection(name)
    await ensure_indexes(db)
    yield db
    await client.close()


async def test_unique_email_index_blocks_concurrent_duplicates(real_db) -> None:
    from pymongo.errors import DuplicateKeyError

    doc = {"id": "u1", "email": "race@example.com", "password": "x", "name": "R"}
    await real_db["users"].insert_one(dict(doc))
    with pytest.raises(DuplicateKeyError):
        await real_db["users"].insert_one(dict(doc))


async def test_expected_indexes_exist(real_db) -> None:
    user_indexes = await real_db["users"].index_information()
    assert "uq_users_email" in user_indexes
    assert user_indexes["uq_users_email"]["unique"] is True

    idea_indexes = await real_db["saved_ideas"].index_information()
    assert "ix_ideas_user_created" in idea_indexes  # (user_id ASC, created_at DESC)
    assert "uq_ideas_id" in idea_indexes

    refresh_indexes = await real_db["refresh_tokens"].index_information()
    assert "uq_refresh_hash" in refresh_indexes
    assert "ttl_refresh_expiry" in refresh_indexes


async def test_email_query_uses_index(real_db) -> None:
    await real_db["users"].insert_one(
        {"id": "u2", "email": "idx@example.com", "password": "x", "name": "I"}
    )
    explained = await real_db.command(
        "explain", {"find": "users", "filter": {"email": "idx@example.com"}}
    )
    winning_plan = explained["queryPlanner"]["winningPlan"]
    # IXSCAN proves the unique email index serves lookups (no COLLSCAN).
    assert "IXSCAN" in str(winning_plan)
