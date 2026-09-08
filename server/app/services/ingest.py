"""Collection ingest with collection_id uniqueness (IMPLEMENTATION §29)."""

from __future__ import annotations

import json

from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.models.collection import Collection, utc_now
from app.schemas.collection import CollectionIngestRequest


def ingest_collection(
    session: Session,
    body: CollectionIngestRequest,
) -> tuple[bool, Collection]:
    """
    Insert collection if new (atomic upsert).

    Returns (already_ingested, row). On duplicate collection_id: does not overwrite
    the first payload (INSERT ON CONFLICT DO NOTHING).
    """
    payload = body.model_dump(mode="json")
    payload_json = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    received_at = utc_now()

    stmt = (
        sqlite_insert(Collection)
        .values(
            collection_id=body.collection_id,
            installation_id=body.installation_id,
            collector=body.collector,
            collector_version=body.collector_version,
            schema_version=body.schema_version,
            captured_at=body.captured_at,
            status=body.status,
            payload_json=payload_json,
            received_at=received_at,
        )
        .on_conflict_do_nothing(index_elements=["collection_id"])
    )
    result = session.execute(stmt)
    session.flush()

    row = session.get(Collection, body.collection_id)
    if row is None:
        raise RuntimeError(f"ingest failed to load collection_id={body.collection_id}")

    # rowcount == 1 means inserted; 0 means conflict / already present
    already = result.rowcount == 0
    return already, row
