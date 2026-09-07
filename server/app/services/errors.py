"""Error log persistence."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.error_log import ErrorLog, utc_now
from app.schemas.error import ErrorIngestRequest


def ingest_error(session: Session, body: ErrorIngestRequest) -> ErrorLog:
    row = ErrorLog(
        installation_id=body.installation_id,
        module=body.module,
        module_version=body.module_version,
        runtime_version=body.runtime_version,
        page=body.page,
        task_state=body.task_state,
        error_code=body.error_code,
        message=body.message,
        layout_signature=body.layout_signature,
        received_at=utc_now(),
    )
    session.add(row)
    session.flush()
    return row
