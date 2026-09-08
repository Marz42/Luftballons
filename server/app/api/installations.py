"""POST /api/v1/installations/register"""

from __future__ import annotations

import hmac

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_session
from app.schemas.installation import RegisterRequest, RegisterResponse
from app.services.auth import register_installation

router = APIRouter(prefix="/api/v1/installations", tags=["installations"])


def _enrollment_ok(
    body_secret: str | None,
    header_secret: str | None,
) -> bool:
    expected = settings.enrollment_secret
    if not expected:
        return False
    provided = (header_secret or body_secret or "").strip()
    if not provided:
        return False
    return hmac.compare_digest(provided, expected)


@router.post("/register", response_model=RegisterResponse, status_code=201)
def register(
    body: RegisterRequest,
    session: Session = Depends(get_session),
    x_luftballons_enrollment: str | None = Header(default=None),
) -> RegisterResponse:
    if not settings.allow_registration:
        raise HTTPException(
            status_code=403,
            detail="Registration is disabled",
        )
    if not _enrollment_ok(body.enrollment_secret, x_luftballons_enrollment):
        raise HTTPException(
            status_code=401,
            detail="Invalid or missing enrollment secret",
        )

    installation, token = register_installation(
        session,
        display_name=body.display_name,
        runtime_version=body.runtime_version,
    )
    # Token plaintext returned once; never logged here.
    return RegisterResponse(
        installation_id=installation.id,
        token=token,
        api_version=settings.api_version,
    )
