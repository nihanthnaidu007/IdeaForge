"""In-memory repository fakes — the fast tier's database seam.

These emulate exactly the surface the routers use against PyMongo Async:
find_one / insert_one / find(cursor with sort+to_list) / delete_one /
update_one / find_one_and_update / command. Unique indexes are simulated by
declaration so registration-race behavior is testable without Mongo; the real
index behavior is proven in the mongo:7 integration tier.
"""

from __future__ import annotations

import copy
from typing import Any

from pymongo import ReturnDocument


class DuplicateKeyError(Exception):
    """Raised by the fake's simulated unique indexes (mirrors pymongo.errors)."""


def _set_path(doc: Any, parts: list[str], value: Any) -> None:
    """Set a dotted Mongo path, creating dicts and extending lists as needed.

    Handles positional segments (``variants.0``) the way real Mongo does —
    the tweak route writes ``$set: {"variants.<index>": ...}``.
    """
    key = parts[0]
    if isinstance(doc, list):
        idx = int(key)
        while len(doc) <= idx:
            doc.append(None)
        if len(parts) == 1:
            doc[idx] = value
            return
        if not isinstance(doc[idx], (dict, list)):
            doc[idx] = {}
        _set_path(doc[idx], parts[1:], value)
        return
    if len(parts) == 1:
        doc[key] = value
        return
    if parts[1].isdigit() and not isinstance(doc.get(key), dict):
        doc.setdefault(key, [])
        _set_path(doc[key], parts[1:], value)
        return
    if not isinstance(doc.get(key), dict):
        doc[key] = {}
    _set_path(doc[key], parts[1:], value)


class FakeCursor:
    def __init__(self, docs: list[dict[str, Any]]) -> None:
        self._docs = list(docs)
        self._sort_key: str | None = None
        self._sort_dir: int = 1

    def sort(self, key: str, direction: int) -> FakeCursor:
        self._sort_key = key
        self._sort_dir = direction
        return self

    async def to_list(self, length: int | None = None) -> list[dict[str, Any]]:
        if self._sort_key is not None:
            self._docs.sort(
                key=lambda d: d.get(self._sort_key, ""), reverse=self._sort_dir < 0
            )
        return list(self._docs[:length]) if length is not None else list(self._docs)


class FakeCollection:
    def __init__(
        self,
        *,
        unique_fields: tuple[str, ...] = (),
        id_field: str | tuple[str, ...] = "id",
    ) -> None:
        self.docs: dict[str, dict[str, Any]] = {}
        self._next = 0
        self._unique_fields = unique_fields
        self._id_field = id_field

    def _doc_key(self, doc: dict[str, Any]) -> str:
        # Composite id_field (e.g. hooks' (id, format) catalog rows) keeps
        # same-id/different-format documents from overwriting each other.
        if isinstance(self._id_field, tuple):
            return str(tuple(doc.get(f) for f in self._id_field))
        return str(doc.get(self._id_field, self._next))

    def _match(self, doc: dict[str, Any], query: dict[str, Any]) -> bool:
        for key, cond in query.items():
            value = doc.get(key)
            if isinstance(cond, dict) and cond and all(
                k.startswith("$") for k in cond
            ):
                # Range/set operators (e.g. the analytics window's
                # {"$gte": since}, trend-cache lookups' {"$in": ids}).
                for op, operand in cond.items():
                    try:
                        if op == "$in" and value not in operand:
                            return False
                        if op == "$gte" and not value >= operand:
                            return False
                        if op == "$gt" and not value > operand:
                            return False
                        if op == "$lte" and not value <= operand:
                            return False
                        if op == "$lt" and not value < operand:
                            return False
                        if op not in ("$in", "$gte", "$gt", "$lte", "$lt"):
                            return False  # unsupported operator fails closed
                    except TypeError:
                        return False  # incomparable types never match
            elif value != cond:
                return False
        return True

    def _project(self, doc: dict[str, Any], projection: dict[str, Any] | None) -> dict:
        if not projection:
            return dict(doc)
        out = dict(doc)
        for key, keep in projection.items():
            if not keep and key in out:
                del out[key]
        return out

    def _apply_update(self, doc: dict[str, Any], update: dict[str, Any]) -> None:
        if "$set" in update:
            for key, value in update["$set"].items():
                _set_path(doc, key.split("."), value)
        if "$setOnInsert" in update:
            for key, value in update["$setOnInsert"].items():
                doc.setdefault(key, value)
        if "$unset" in update:
            for key in update["$unset"]:
                if "." in key:
                    parent, leaf = key.rsplit(".", 1)
                    if isinstance(doc.get(parent), dict):
                        doc[parent].pop(leaf, None)
                else:
                    doc.pop(key, None)
        if "$inc" in update:
            for key, value in update["$inc"].items():
                doc[key] = doc.get(key, 0) + value
        if "$push" in update:
            for key, value in update["$push"].items():
                doc.setdefault(key, []).append(value)
        if "$pull" in update:
            for key, matcher in update["$pull"].items():
                entries = doc.get(key)
                if isinstance(entries, list):
                    doc[key] = [
                        entry
                        for entry in entries
                        if not self._match(entry, matcher)
                    ]

    def _apply_pipeline(self, doc: dict[str, Any], pipeline: list[dict]) -> None:
        for stage in pipeline:
            if "$set" not in stage:
                continue
            for key, expr in stage["$set"].items():
                if isinstance(expr, dict) and "$not" in expr:
                    field_ref = expr["$not"]
                    assert isinstance(field_ref, str) and field_ref.startswith("$")
                    doc[key] = not bool(doc.get(field_ref[1:]))
                else:
                    doc[key] = expr

    async def insert_one(self, doc: dict[str, Any]) -> Any:
        for existing in self.docs.values():
            # Unique check only when declared — all(()) is vacuously True and
            # would reject every second insert into audit-style collections.
            if self._unique_fields and all(
                existing.get(f) == doc.get(f) for f in self._unique_fields
            ):
                raise DuplicateKeyError(f"unique index on {list(self._unique_fields)}")
        key = self._doc_key(doc)
        self._next += 1
        self.docs[key] = dict(doc)
        return type("InsertResult", (), {"inserted_id": key})()

    async def find_one(
        self,
        query: dict[str, Any],
        projection: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        for doc in self.docs.values():
            if self._match(doc, query):
                return self._project(doc, projection)
        return None

    def find(
        self, query: dict[str, Any], projection: dict[str, Any] | None = None
    ) -> FakeCursor:
        matches = [
            self._project(doc, projection)
            for doc in self.docs.values()
            if self._match(doc, query)
        ]
        return FakeCursor(matches)

    async def delete_one(self, query: dict[str, Any]) -> Any:
        deleted = 0
        for key, doc in list(self.docs.items()):
            if self._match(doc, query):
                del self.docs[key]
                deleted += 1
        return type("DeleteResult", (), {"deleted_count": deleted})()

    async def update_one(
        self, query: dict[str, Any], update: dict[str, Any]
    ) -> Any:
        matched = 0
        modified = 0
        for key, doc in self.docs.items():
            if self._match(doc, query):
                matched += 1
                # Deep copy: $push/$unset mutate nested lists in place, and a
                # shallow snapshot would alias them into always-equal.
                before = copy.deepcopy(doc)
                self._apply_update(doc, update)
                # Real MongoDB reports modified_count only for documents whose
                # values actually changed (a $pull that matches nothing is a
                # no-op); tests lean on that honesty for 404s.
                if self.docs[key] != before:
                    modified += 1
        return type(
            "UpdateResult", (), {"modified_count": modified, "matched_count": matched}
        )()

    async def update_many(
        self, query: dict[str, Any], update: dict[str, Any]
    ) -> Any:
        # Same multi-doc semantics as update_one (pymongo distinguishes only
        # via matched/modified counts); kept separate for surface honesty.
        return await self.update_one(query, update)

    async def find_one_and_update(
        self,
        query: dict[str, Any],
        update: dict[str, Any] | list[dict[str, Any]],
        *,
        upsert: bool = False,
        return_document: bool | int = ReturnDocument.BEFORE,
        projection: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        for _key, doc in self.docs.items():
            if self._match(doc, query):
                before = self._project(doc, projection)
                if isinstance(update, list):
                    self._apply_pipeline(doc, update)
                else:
                    self._apply_update(doc, update)
                return before if not return_document else self._project(doc, projection)
        if upsert and not isinstance(update, list):
            new_doc: dict[str, Any] = {}
            # MongoDB upsert semantics: the created document is seeded with
            # the filter's equality conditions before the update applies.
            for field, value in query.items():
                if not isinstance(value, dict):
                    new_doc.setdefault(field, value)
            self._apply_update(new_doc, update)
            insert_key = self._doc_key(new_doc)
            self._next += 1
            self.docs[insert_key] = new_doc
            return self._project(new_doc, projection)
        return None

    async def create_indexes(self, indexes: Any) -> list[str]:
        return []


class FakeDatabase:
    """dict-backed Database stand-in; ``command`` succeeds (health-ready path)."""

    def __init__(self, *, mongo_ok: bool = True) -> None:
        self.users = FakeCollection(unique_fields=("email", "id"))
        self.refresh_tokens = FakeCollection(unique_fields=("token_hash",))
        self.saved_ideas = FakeCollection(unique_fields=("id",))
        self.user_preferences = FakeCollection(unique_fields=("user_id",))
        self.key_audit = FakeCollection()
        # Variants lane: explicit attributes for parity with the real schema
        # (the routes access these as attributes, and db.py builds indexes on
        # variant_sets + usage_events at startup).
        self.variant_sets = FakeCollection(unique_fields=("id",))
        self.usage_events = FakeCollection()
        # Cap counters (Wave 1): one doc per user×resource×UTC day — declared
        # explicitly like the other collections so attribute access works.
        self.usage_counters = FakeCollection()
        self.voice_profiles = FakeCollection(unique_fields=("user_id",))
        # Hook Bank catalog rows: one doc per pattern×format — composite key.
        self.hooks = FakeCollection(
            unique_fields=("id", "format"), id_field=("id", "format")
        )
        # Trend cache (Trend Radar): per-trend forge looks rows up by the
        # server-assigned id the research route returned.
        self.trend_cache = FakeCollection(unique_fields=("id",))
        self._mongo_ok = mongo_ok
        self.commands_run: list[Any] = []

    def __getitem__(self, name: str) -> FakeCollection:
        if not hasattr(self, name):
            setattr(self, name, FakeCollection())
        return getattr(self, name)

    async def command(self, command: Any) -> dict[str, Any]:
        self.commands_run.append(command)
        if not self._mongo_ok:
            raise RuntimeError("mongo unreachable")
        return {"ok": 1}

    async def create_indexes_all(self, specs: dict[str, list[Any]]) -> None:
        for name, indexes in specs.items():
            await self[name].create_indexes(indexes)


class RecordingLLM:
    """Stub LLMProvider: records every complete() call, replays responses."""

    model_name = "openai"

    def __init__(self, responses: list[str]) -> None:
        self._responses = list(responses)
        self.calls: list[dict[str, Any]] = []

    async def complete(
        self,
        *,
        system: str,
        prompt: str,
        json_mode: bool = False,
        max_tokens: int = 2_000,
    ) -> str:
        self.calls.append(
            {"system": system, "prompt": prompt, "json_mode": json_mode}
        )
        return self._responses.pop(0)


def stub_get_llm(responses: list[str], *, capture: list[RecordingLLM] | None = None):
    """Replacement for app.deps.get_llm at the import seam (monkeypatched)."""

    async def _get_llm(
        user_id: str, provider: str, *, db: Any, vault: Any, settings: Any
    ) -> RecordingLLM:
        llm = RecordingLLM(responses)
        # Usage-event attribution reads provider_name off the instance the
        # same way it does off the real clients.
        llm.provider_name = provider
        if capture is not None:
            capture.append(llm)
        return llm

    return _get_llm
