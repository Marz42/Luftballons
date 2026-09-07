"""POST /api/v1/installations/register"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_session
from app.schemas.installation import RegisterRequest, RegisterResponse
from app.services.auth import register_installation

router = APIRouter(prefix="/api/v1/installations", tags=["installations"])


@router.post("/register", response_model=RegisterResponse, status_code=201)
def register(
    body: RegisterRequest,
    session: Session = Depends(get_session),
) -> RegisterResponse:
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
