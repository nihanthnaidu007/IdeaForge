"""MongoDB access: PyMongo Async client (Motor is deprecated) + startup indexes.

Indexes are created in the app lifespan, not ad hoc. The unique email index is
what replaces the scaffold's find-then-insert registration race — concurrent
duplicate inserts now fail at the index and the router maps that to 409.
"""

from __future__ import annotations

from typing import Any

from pymongo import ASCENDING, DESCENDING, IndexModel
from pymongo.asynchronous.mongo_client import AsyncMongoClient

from app.config import Settings

# serverSelectionTimeoutMS keeps /health/ready and startup failures fast
# instead of hanging for the 30s default when Mongo is unreachable.
_CLIENT_TIMEOUT_MS = 5_000

_INDEX_SPECS: dict[str, list[IndexModel]] = {
    "users": [
        IndexModel([("email", ASCENDING)], name="uq_users_email", unique=True),
        IndexModel([("id", ASCENDING)], name="uq_users_id", unique=True),
    ],
    "user_preferences": [
        IndexModel([("user_id", ASCENDING)], name="uq_prefs_user", unique=True),
    ],
    "saved_ideas": [
        IndexModel(
            [("user_id", ASCENDING), ("created_at", DESCENDING)],
            name="ix_ideas_user_created",
        ),
        IndexModel([("id", ASCENDING)], name="uq_ideas_id", unique=True),
        # Content Board: column grouping reads ideas per user+status; the
        # reminder worker scans by scheduled_for to find due reminders.
        IndexModel(
            [("user_id", ASCENDING), ("status", ASCENDING)],
            name="ix_ideas_user_status",
        ),
        IndexModel(
            [("scheduled_for", ASCENDING)], name="ix_ideas_scheduled_for"
        ),
    ],
    "refresh_tokens": [
        IndexModel([("token_hash", ASCENDING)], name="uq_refresh_hash", unique=True),
        # TTL: expired refresh tokens are purged by Mongo automatically.
        IndexModel(
            [("expires_at", ASCENDING)], name="ttl_refresh_expiry", expireAfterSeconds=0
        ),
    ],
    "key_audit": [
        IndexModel(
            [("user_id", ASCENDING), ("at", DESCENDING)],
            name="ix_key_audit_user_at",
        ),
    ],
    "usage_events": [
        # Analytics reads a user's events newest-first; every write appends.
        IndexModel(
            [("user_id", ASCENDING), ("at", DESCENDING)],
            name="ix_usage_user_at",
        ),
    ],
    # In-app reminders (draft queue) list newest-first per user.
    "notifications": [
        IndexModel(
            [("user_id", ASCENDING), ("fired_at", DESCENDING)],
            name="ix_notifications_user_at",
        ),
    ],
}


def create_client(settings: Settings) -> AsyncMongoClient[dict[str, Any]]:
    return AsyncMongoClient(
        settings.mongo_url, serverSelectionTimeoutMS=_CLIENT_TIMEOUT_MS
    )


def get_database(client: AsyncMongoClient[dict[str, Any]], settings: Settings) -> Any:
    return client[settings.db_name]


async def ensure_indexes(db: Any) -> None:
    for collection_name, indexes in _INDEX_SPECS.items():
        await db[collection_name].create_indexes(indexes)
