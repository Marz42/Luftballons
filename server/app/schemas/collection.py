"""Pydantic schemas — collection ingest (IMPLEMENTATION §28)."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


class CollectionIngestRequest(BaseModel):
    collection_id: str = Field(min_length=1, max_length=64)
    installation_id: str = Field(min_length=1, max_length=64)
    collector: str = Field(min_length=1, max_length=256)
    collector_version: int
    schema_version: int
    captured_at: str
    status: Literal["COMPLETE", "PARTIAL"]
    data: Any = None

    @field_validator("captured_at")
    @classmethod
    def captured_at_must_be_iso(cls, value: str) -> str:
        raw = value.strip()
        if not raw:
            raise ValueError("captured_at must be a non-empty ISO-8601 string")
        # Reject non-string-like Date objects serialized badly; require parseable ISO.
        normalized = raw.replace("Z", "+00:00")
        try:
            datetime.fromisoformat(normalized)
        except ValueError as exc:
            raise ValueError("captured_at must be a valid ISO-8601 timestamp") from exc
        return raw


class CollectionIngestResponse(BaseModel):
    already_ingested: bool
