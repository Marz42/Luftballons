"""Admin Basic Auth (IMPLEMENTATION §35) — internal only.

Requires env ADMIN_PASSWORD. If unset, every /admin* request returns 401
(no default weak password). Must not be exposed on the public internet —
bind uvicorn to 127.0.0.1 or an internal interface + reverse proxy.
"""

from __future__ import annotations

import logging
import os
import secrets
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBasic, HTTPBasicCredentials

logger = logging.getLogger("luftballons.admin")

security = HTTPBasic(auto_error=False)

# Documented username for single-admin Basic Auth.
ADMIN_USERNAME = "admin"


def get_admin_password() -> str | None:
    raw = os.environ.get("ADMIN_PASSWORD")
    if raw is None:
        return None
    value = raw.strip()
    return value if value else None


def require_admin(
    credentials: Annotated[HTTPBasicCredentials | None, Depends(security)],
) -> str:
    """
    Fail closed: missing ADMIN_PASSWORD → 401 + warning log.
    Correct password → returns username.
    """
    expected = get_admin_password()
    if not expected:
        logger.warning(
            "Admin access denied: ADMIN_PASSWORD is not set "
            "(admin is disabled until a password is configured; internal only)"
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="admin disabled: ADMIN_PASSWORD not set",
            headers={"WWW-Authenticate": "Basic"},
        )

    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="unauthorized",
            headers={"WWW-Authenticate": "Basic"},
        )

    user_ok = secrets.compare_digest(credentials.username, ADMIN_USERNAME)
    pass_ok = secrets.compare_digest(credentials.password, expected)
    if not (user_ok and pass_ok):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="unauthorized",
            headers={"WWW-Authenticate": "Basic"},
        )
    return credentials.username
