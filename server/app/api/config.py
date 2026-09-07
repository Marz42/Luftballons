"""GET /api/v1/config — declarative remote config (IMPLEMENTATION §23/§27)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.db import get_session
from app.services.auth import AuthError, authenticate_by_token, parse_bearer
from app.services.remote_config import get_active_config

router = APIRouter(prefix="/api/v1", tags=["config"])


@router.get("/config")
def get_config(
    session: Session = Depends(get_session),
    authorization: str | None = Header(default=None),
) -> dict:
    """Return whitelist-only RemoteConfig. Bearer = installation token."""
    token = parse_bearer(authorization)
    try:
        authenticate_by_token(session, bearer_token=token)
    except AuthError:
        raise HTTPException(status_code=401, detail="unauthorized") from None

    payload, _revision = get_active_config(session)
    # Always re-sanitize on read so forbidden keys never leave the API.
    return payload
