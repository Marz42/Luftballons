"""POST /api/v1/collections — ingest with Bearer auth + idempotency."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from sqlalchemy.orm import Session

from app.db import get_session
from app.schemas.collection import CollectionIngestRequest, CollectionIngestResponse
from app.services.auth import AuthError, authenticate_installation, parse_bearer
from app.services.ingest import ingest_collection

router = APIRouter(prefix="/api/v1", tags=["collections"])


@router.post(
    "/collections",
    response_model=CollectionIngestResponse,
    responses={
        201: {"model": CollectionIngestResponse},
        200: {"model": CollectionIngestResponse},
    },
)
def post_collection(
    body: CollectionIngestRequest,
    response: Response,
    session: Session = Depends(get_session),
    authorization: str | None = Header(default=None),
) -> CollectionIngestResponse:
    token = parse_bearer(authorization)
    try:
        authenticate_installation(
            session,
            installation_id=body.installation_id,
            bearer_token=token,
        )
    except AuthError:
        # Do not leak whether id exists / disabled vs bad token (revoke semantics: 401).
        raise HTTPException(status_code=401, detail="unauthorized") from None

    already, _row = ingest_collection(session, body)
    response.status_code = 200 if already else 201
    return CollectionIngestResponse(already_ingested=already)
