"""Installation token auth — server stores sha256(token) only (SPEC §59)."""

from __future__ import annotations

import hashlib
import secrets
from uuid import uuid4

from sqlalchemy.orm import Session

from app.models.installation import Installation, utc_now


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def generate_token() -> str:
    return secrets.token_urlsafe(32)


def generate_installation_id() -> str:
    return str(uuid4())


class AuthError(Exception):
    """Bearer token missing, wrong, or installation disabled/revoked."""


def authenticate_installation(
    session: Session,
    *,
    installation_id: str,
    bearer_token: str | None,
) -> Installation:
    if not bearer_token:
        raise AuthError("missing bearer token")

    installation = session.get(Installation, installation_id)
    if installation is None:
        raise AuthError("unknown installation")
    if not installation.enabled:
        raise AuthError("installation disabled")
    if installation.token_hash != hash_token(bearer_token):
        raise AuthError("invalid token")

    installation.last_seen_at = utc_now()
    return installation


def register_installation(
    session: Session,
    *,
    display_name: str | None,
    runtime_version: str | None,
) -> tuple[Installation, str]:
    """Create a new installation. Returns (row, plaintext_token) — token shown once."""
    token = generate_token()
    installation = Installation(
        id=generate_installation_id(),
        display_name=display_name,
        token_hash=hash_token(token),
        enabled=True,
        runtime_version=runtime_version,
        created_at=utc_now(),
        last_seen_at=None,
    )
    session.add(installation)
    session.flush()
    return installation, token


def parse_bearer(authorization: str | None) -> str | None:
    if not authorization:
        return None
    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1].strip():
        return None
    return parts[1].strip()
