"""Collection ingest with collection_id uniqueness (IMPLEMENTATION §29)."""

from __future__ import annotations

import json

from sqlalchemy.orm import Session

from app.models.collection import Collection, utc_now
from app.schemas.collection import CollectionIngestRequest


def ingest_collection(
    session: Session,
    body: CollectionIngestRequest,
) -> tuple[bool, Collection]:
    """
    Insert collection if new.

    Returns (already_ingested, row). On duplicate collection_id: does not overwrite
    the first payload (SELECT then INSERT; skip insert when present).
    """
    existing = session.get(Collection, body.collection_id)
    if existing is not None:
        return True, existing

    # Canonical payload: full request body as normalized JSON (MVP §33).
    payload = body.model_dump(mode="json")
    row = Collection(
        collection_id=body.collection_id,
        installation_id=body.installation_id,
        collector=body.collector,
        collector_version=body.collector_version,
        schema_version=body.schema_version,
        captured_at=body.captured_at,
        status=body.status,
        payload_json=json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        received_at=utc_now(),
    )
    session.add(row)
    session.flush()
    return False, row
