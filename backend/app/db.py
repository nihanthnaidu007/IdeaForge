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
# socketTimeoutMS bounds a wedged socket READ on a healthy topology — without
# it a stalled read (the F04 hang class, art_vqwfyodR) awaits forever. 15s
# keeps the handler's typed 502 ahead of the frontend's 30s client timeout.
_CLIENT_TIMEOUT_MS = 5_000
_SOCKET_TIMEOUT_MS = 15_000

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
    # Variant sets: per-user compare sets, newest first; sets link to their
    # parent via parent_set_id for regeneration round tracking.
    "variant_sets": [
        IndexModel(
            [("user_id", ASCENDING), ("created_at", DESCENDING)],
            name="ix_variant_sets_user_created",
        ),
        IndexModel([("id", ASCENDING)], name="uq_variant_sets_id", unique=True),
    ],
    "voice_profiles": [
        IndexModel([("user_id", ASCENDING)], name="uq_voice_profiles_user", unique=True),
    ],
    "hooks": [
        # Seed documents repeat the pattern id across formats (one doc per
        # pattern×format); user hooks get uuid ids, so (id, format) is unique.
        IndexModel(
            [("id", ASCENDING), ("format", ASCENDING)],
            name="uq_hooks_id_format",
            unique=True,
        ),
    ],
    "usage_events": [
        # Analytics reads a user's events newest-first; every write appends.
        IndexModel(
            [("user_id", ASCENDING), ("at", DESCENDING)],
            name="ix_usage_user_at",
        ),
    ],
    "usage_counters": [
        # Cap enforcement counters (Wave 1): one doc per user×resource×UTC
        # day. Unique so concurrent first-authorizations upsert into one doc;
        # TTL purges each doc 45 days after its allowance reset — bookkeeping,
        # not analytics history.
        IndexModel(
            [("user_id", ASCENDING), ("resource", ASCENDING), ("day", ASCENDING)],
            name="uq_usage_counters_user_resource_day",
            unique=True,
        ),
        IndexModel(
            [("resets_at", ASCENDING)],
            name="ttl_usage_counters_resets_at",
            expireAfterSeconds=45 * 24 * 60 * 60,
        ),
    ],
    # In-app reminders (draft queue) list newest-first per user.
    "notifications": [
        IndexModel(
            [("user_id", ASCENDING), ("fired_at", DESCENDING)],
            name="ix_notifications_user_at",
        ),
    ],
    # Onboarding progress (Wave 1): one doc per user — the checklist mirrors
    # real events, so reads are by user and never hot; unique index keeps the
    # upserts in services/onboarding single-document.
    "onboarding_progress": [
        IndexModel([("user_id", ASCENDING)], name="uq_onboarding_user", unique=True),
    ],
    # Trend cache: per-trend forge looks rows up by server-assigned id; the
    # TTL index purges expired rows (the query also checks expires_at —
    # Mongo's TTL sweeper is asynchronous, the lookup must not rely on it).
    "trend_cache": [
        IndexModel([("id", ASCENDING)], name="uq_trend_cache_id", unique=True),
        IndexModel(
            [("user_id", ASCENDING), ("created_at", DESCENDING)],
            name="ix_trend_cache_user_created",
        ),
        IndexModel(
            [("expires_at", ASCENDING)], name="ttl_trend_cache_expiry", expireAfterSeconds=0
        ),
    ],
}


def create_client(settings: Settings) -> AsyncMongoClient[dict[str, Any]]:
    return AsyncMongoClient(
        settings.mongo_url,
        serverSelectionTimeoutMS=_CLIENT_TIMEOUT_MS,
        socketTimeoutMS=_SOCKET_TIMEOUT_MS,
    )


def get_database(client: AsyncMongoClient[dict[str, Any]], settings: Settings) -> Any:
    return client[settings.db_name]


async def ensure_indexes(db: Any) -> None:
    for collection_name, indexes in _INDEX_SPECS.items():
        await db[collection_name].create_indexes(indexes)
