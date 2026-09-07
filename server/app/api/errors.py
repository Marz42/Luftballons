"""POST /api/v1/errors — optional error intake (IMPLEMENTATION §30 / SPEC §44)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.db import get_session
from app.schemas.error import ErrorIngestRequest, ErrorIngestResponse
from app.services.auth import AuthError, authenticate_installation, parse_bearer
from app.services.errors import ingest_error

router = APIRouter(prefix="/api/v1", tags=["errors"])


@router.post("/errors", response_model=ErrorIngestResponse, status_code=201)
def post_error(
    body: ErrorIngestRequest,
    session: Session = Depends(get_session),
    authorization: str | None = Header(default=None),
) -> ErrorIngestResponse:
    token = parse_bearer(authorization)
    try:
        authenticate_installation(
            session,
            installation_id=body.installation_id,
            bearer_token=token,
        )
    except AuthError:
        raise HTTPException(status_code=401, detail="unauthorized") from None

    row = ingest_error(session, body)
    return ErrorIngestResponse(accepted=True, id=row.id)
