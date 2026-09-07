"""Admin SSR routes (IMPLEMENTATION §34–§35) — Jinja2, internal only."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.db import get_session
from app.models.collection import Collection
from app.models.error_log import ErrorLog
from app.models.installation import Installation
from app.services.admin_auth import require_admin
from app.services.auth import (
    AuthError,
    rotate_installation_token,
    set_installation_enabled,
)
from app.services.remote_config import (
    get_active_config,
    merge_module_flags,
    modules_for_admin,
)

# internal only — see README. Do not expose /admin on the public internet.
router = APIRouter(prefix="/admin", tags=["admin"], include_in_schema=False)

_TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates"
templates = Jinja2Templates(directory=str(_TEMPLATES_DIR))

RECENT_THRESHOLD_SECONDS = 15 * 60


def _seen_label(last_seen: datetime | None) -> str:
    if last_seen is None:
        return "never"
    now = datetime.now(timezone.utc)
    ts = last_seen if last_seen.tzinfo else last_seen.replace(tzinfo=timezone.utc)
    delta = (now - ts).total_seconds()
    if delta < RECENT_THRESHOLD_SECONDS:
        return "recent"
    return "stale"


@router.get("", response_class=HTMLResponse)
@router.get("/", response_class=HTMLResponse)
def admin_overview(
    request: Request,
    _admin: str = Depends(require_admin),
    session: Session = Depends(get_session),
) -> HTMLResponse:
    installations = session.scalars(select(Installation)).all()
    collections = session.scalars(select(Collection)).all()
    errors = session.scalars(select(ErrorLog)).all()
    _payload, revision = get_active_config(session)
    return templates.TemplateResponse(
        request,
        "overview.html",
        {
            "installation_count": len(installations),
            "collection_count": len(collections),
            "error_count": len(errors),
            "config_revision": revision,
            "nav": "overview",
        },
    )


def _installations_page(
    request: Request,
    session: Session,
    *,
    rotated_token: str | None = None,
    rotated_id: str | None = None,
) -> HTMLResponse:
    rows = session.scalars(
        select(Installation).order_by(desc(Installation.created_at))
    ).all()
    items = [
        {
            "id": r.id,
            "display_name": r.display_name or "(unnamed)",
            "enabled": r.enabled,
            "runtime_version": r.runtime_version or "—",
            "created_at": r.created_at,
            "last_seen_at": r.last_seen_at,
            "seen": _seen_label(r.last_seen_at),
        }
        for r in rows
    ]
    return templates.TemplateResponse(
        request,
        "installations.html",
        {
            "items": items,
            "nav": "installations",
            "rotated_token": rotated_token,
            "rotated_id": rotated_id,
        },
    )


@router.get("/installations", response_class=HTMLResponse)
def admin_installations(
    request: Request,
    _admin: str = Depends(require_admin),
    session: Session = Depends(get_session),
) -> HTMLResponse:
    return _installations_page(request, session)


@router.post(
    "/installations/{installation_id}/rotate-token",
    response_class=HTMLResponse,
)
def admin_rotate_token(
    request: Request,
    installation_id: str,
    _admin: str = Depends(require_admin),
    session: Session = Depends(get_session),
) -> HTMLResponse:
    try:
        _row, token = rotate_installation_token(session, installation_id)
    except AuthError:
        raise HTTPException(status_code=404, detail="installation not found") from None
    # Plaintext token shown once in HTML response body only — never logged.
    return _installations_page(
        request,
        session,
        rotated_token=token,
        rotated_id=installation_id,
    )


@router.post("/installations/{installation_id}/toggle")
def admin_toggle_installation(
    installation_id: str,
    enabled: str = Form(...),
    _admin: str = Depends(require_admin),
    session: Session = Depends(get_session),
) -> RedirectResponse:
    want = enabled.lower() in ("1", "true", "on", "yes")
    try:
        set_installation_enabled(session, installation_id, enabled=want)
    except AuthError:
        raise HTTPException(status_code=404, detail="installation not found") from None
    return RedirectResponse(url="/admin/installations", status_code=303)


@router.get("/collections", response_class=HTMLResponse)
def admin_collections(
    request: Request,
    _admin: str = Depends(require_admin),
    session: Session = Depends(get_session),
) -> HTMLResponse:
    rows = session.scalars(
        select(Collection).order_by(desc(Collection.received_at)).limit(200)
    ).all()
    items = [
        {
            "collection_id": r.collection_id,
            "installation_id": r.installation_id,
            "collector": r.collector,
            "captured_at": r.captured_at,
            "status": r.status,
            "received_at": r.received_at,
            "schema_version": r.schema_version,
        }
        for r in rows
    ]
    return templates.TemplateResponse(
        request,
        "collections.html",
        {"items": items, "nav": "collections"},
    )


@router.get("/modules", response_class=HTMLResponse)
def admin_modules(
    request: Request,
    _admin: str = Depends(require_admin),
    session: Session = Depends(get_session),
) -> HTMLResponse:
    items = modules_for_admin(session)
    _payload, revision = get_active_config(session)
    return templates.TemplateResponse(
        request,
        "modules.html",
        {"items": items, "revision": revision, "nav": "modules"},
    )


@router.post("/modules/{module_id}")
def admin_update_module(
    module_id: str,
    enabled: str | None = Form(None),
    kill_switch: str | None = Form(None),
    _admin: str = Depends(require_admin),
    session: Session = Depends(get_session),
) -> RedirectResponse:
    # Checkbox: present → true; absent → false.
    is_enabled = enabled is not None and enabled.lower() in (
        "1",
        "true",
        "on",
        "yes",
    )
    is_kill = kill_switch is not None and kill_switch.lower() in (
        "1",
        "true",
        "on",
        "yes",
    )
    if is_kill:
        is_enabled = False
    merge_module_flags(
        session,
        module_id,
        enabled=is_enabled,
        kill_switch=is_kill,
    )
    return RedirectResponse(url="/admin/modules", status_code=303)


@router.get("/errors", response_class=HTMLResponse)
def admin_errors(
    request: Request,
    _admin: str = Depends(require_admin),
    session: Session = Depends(get_session),
) -> HTMLResponse:
    rows = session.scalars(
        select(ErrorLog).order_by(desc(ErrorLog.received_at)).limit(200)
    ).all()
    items = [
        {
            "id": r.id,
            "installation_id": r.installation_id,
            "module": r.module or "—",
            "error_code": r.error_code or "—",
            "message": r.message,
            "page": r.page or "—",
            "received_at": r.received_at,
        }
        for r in rows
    ]
    return templates.TemplateResponse(
        request,
        "errors.html",
        {"items": items, "nav": "errors"},
    )
