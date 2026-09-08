"""P5b — Config API, Error intake, Admin UI tests."""

from __future__ import annotations

import os

import pytest
from sqlalchemy import select

from app.models.error_log import ErrorLog
from app.models.remote_config import ACTIVE_KEY, RemoteConfigRow
from app.services.remote_config import (
    get_active_config,
    save_active_config,
    sanitize_config_payload,
)
from helpers import register_headers


def _register(client, name: str = "PC-A") -> tuple[str, str]:
    body = client.post(
        "/api/v1/installations/register",
        headers=register_headers(),
        json={"display_name": name, "runtime_version": "0.1.0"},
    ).json()
    return body["installation_id"], body["token"]


def test_config_requires_auth(client):
    assert client.get("/api/v1/config").status_code == 401


def test_config_returns_whitelist_defaults(client):
    _id, token = _register(client)
    response = client.get(
        "/api/v1/config",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["schemaVersion"] == 1
    assert "modules" in body
    assert "script" not in body
    assert "url" not in body
    assert "selector" not in body


def test_config_malicious_keys_dropped_on_write(client, session_factory):
    _id, token = _register(client)
    with session_factory() as session:
        dirty = {
            "schemaVersion": 1,
            "modules": {
                "youtube.channel.basic": {
                    "enabled": False,
                    "killSwitch": True,
                    "selector": "#evil",
                    "script": "alert(1)",
                }
            },
            "script": "evil()",
            "url": "https://evil.example",
            "selector": ".x",
            "unknownRoot": True,
            "features": {"safeFlag": True, "url": True},
        }
        clean, rev = save_active_config(session, dirty)
        session.commit()
        assert rev >= 1
        assert "script" not in clean
        assert "url" not in clean
        assert "selector" not in clean
        assert "unknownRoot" not in clean
        mod = clean["modules"]["youtube.channel.basic"]
        assert mod["enabled"] is False
        assert mod["killSwitch"] is True
        assert "selector" not in mod
        assert "script" not in mod
        assert clean["features"] == {"safeFlag": True}

    response = client.get(
        "/api/v1/config",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    body = response.json()
    assert "script" not in body
    assert "url" not in body
    assert body["modules"]["youtube.channel.basic"]["killSwitch"] is True


def test_sanitize_rejects_forbidden_even_in_raw_json(session_factory):
    with session_factory() as session:
        session.add(
            RemoteConfigRow(
                key=ACTIVE_KEY,
                payload_json='{"schemaVersion":1,"modules":{},"script":"x","command":"y"}',
                revision=1,
            )
        )
        session.commit()
        payload, _ = get_active_config(session)
        assert "script" not in payload
        assert "command" not in payload


def test_errors_requires_auth(client):
    response = client.post(
        "/api/v1/errors",
        json={
            "installation_id": "nope",
            "message": "boom",
        },
    )
    assert response.status_code == 401


def test_errors_accepts_whitelist_fields(client, session_factory):
    installation_id, token = _register(client)
    response = client.post(
        "/api/v1/errors",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "installation_id": installation_id,
            "module": "youtube.channel.basic",
            "module_version": "0.1.0",
            "runtime_version": "0.1.0",
            "page": "/channel",
            "task_state": "FAILED",
            "error_code": "LAYOUT",
            "message": "layout mismatch",
            "layout_signature": "sig-abc",
        },
    )
    assert response.status_code == 201
    body = response.json()
    assert body["accepted"] is True
    assert isinstance(body["id"], int)

    with session_factory() as session:
        row = session.get(ErrorLog, body["id"])
        assert row is not None
        assert row.message == "layout mismatch"
        assert row.installation_id == installation_id


def test_errors_rejects_unknown_fields(client):
    installation_id, token = _register(client)
    response = client.post(
        "/api/v1/errors",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "installation_id": installation_id,
            "message": "x",
            "html": "<html>full</html>",
            "cookie": "secret",
        },
    )
    assert response.status_code == 422


def test_errors_rejects_html_document_message(client):
    installation_id, token = _register(client)
    response = client.post(
        "/api/v1/errors",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "installation_id": installation_id,
            "message": "<!DOCTYPE html><html><body>x</body></html>",
        },
    )
    assert response.status_code == 422


def test_admin_without_password_is_401(client, monkeypatch):
    monkeypatch.delenv("ADMIN_PASSWORD", raising=False)
    # Clear any cached env from earlier tests by not setting.
    response = client.get("/admin/")
    assert response.status_code == 401


def test_admin_with_password_ok(client, monkeypatch):
    monkeypatch.setenv("ADMIN_PASSWORD", "test-admin-secret")
    response = client.get("/admin/", auth=("admin", "test-admin-secret"))
    assert response.status_code == 200
    assert b"Luftballons Admin" in response.content
    assert b"internal only" in response.content


def test_admin_wrong_password_401(client, monkeypatch):
    monkeypatch.setenv("ADMIN_PASSWORD", "test-admin-secret")
    response = client.get("/admin/", auth=("admin", "wrong"))
    assert response.status_code == 401


def test_admin_modules_toggle_reflected_in_config(client, monkeypatch):
    monkeypatch.setenv("ADMIN_PASSWORD", "test-admin-secret")
    _id, token = _register(client)

    response = client.post(
        "/admin/modules/youtube.channel.basic",
        auth=("admin", "test-admin-secret"),
        data={"kill_switch": "on"},
        follow_redirects=False,
    )
    assert response.status_code == 303

    cfg = client.get(
        "/api/v1/config",
        headers={"Authorization": f"Bearer {token}"},
    ).json()
    mod = cfg["modules"]["youtube.channel.basic"]
    assert mod["killSwitch"] is True
    assert mod["enabled"] is False


def test_admin_rotate_invalidates_old_token(client, monkeypatch):
    monkeypatch.setenv("ADMIN_PASSWORD", "test-admin-secret")
    installation_id, old_token = _register(client, "PC-B")

    # Old token works for config.
    assert (
        client.get(
            "/api/v1/config",
            headers={"Authorization": f"Bearer {old_token}"},
        ).status_code
        == 200
    )

    rotate = client.post(
        f"/admin/installations/{installation_id}/rotate-token",
        auth=("admin", "test-admin-secret"),
    )
    assert rotate.status_code == 200
    assert b"New token" in rotate.content
    # Extract token from HTML: between last <code> after "shown once"
    text = rotate.text
    assert old_token not in text or text.count(old_token) == 0

    # Parse new token from banner <code> blocks — second code is token.
    import re

    codes = re.findall(r"<code>([^<]+)</code>", text)
    assert len(codes) >= 2
    new_token = codes[1]
    assert new_token != old_token
    assert len(new_token) >= 32

    assert (
        client.get(
            "/api/v1/config",
            headers={"Authorization": f"Bearer {old_token}"},
        ).status_code
        == 401
    )
    assert (
        client.get(
            "/api/v1/config",
            headers={"Authorization": f"Bearer {new_token}"},
        ).status_code
        == 200
    )


def test_admin_disable_installation_blocks_config(client, monkeypatch):
    monkeypatch.setenv("ADMIN_PASSWORD", "test-admin-secret")
    installation_id, token = _register(client)

    response = client.post(
        f"/admin/installations/{installation_id}/toggle",
        auth=("admin", "test-admin-secret"),
        data={"enabled": "false"},
        follow_redirects=False,
    )
    assert response.status_code == 303
    assert (
        client.get(
            "/api/v1/config",
            headers={"Authorization": f"Bearer {token}"},
        ).status_code
        == 401
    )


def test_sanitize_unit_drops_forbidden():
    clean = sanitize_config_payload(
        {
            "schemaVersion": 1,
            "modules": {"m": {"enabled": True, "action": "click"}},
            "xpath": "//a",
        }
    )
    assert "xpath" not in clean
    assert "action" not in clean["modules"]["m"]


def test_remote_compromise_admin_write_drops_script_url_selector(client, session_factory):
    """§61 — admin/write path must drop execution-driving keys; GET must not echo them."""
    _id, token = _register(client)
    malicious = {
        "schemaVersion": 1,
        "modules": {
            "youtube.channel.basic": {
                "enabled": True,
                "script": "alert(1)",
                "selector": "#publish",
                "url": "https://evil.example",
            }
        },
        "script": "...",
        "endpoint": "https://evil.example",
        "selector": "#publish",
        "command": "click",
        "url": "https://evil.example",
        "javascript": "alert(1)",
    }
    with session_factory() as session:
        clean, _rev = save_active_config(session, malicious)
        session.commit()
        for bad in ("script", "endpoint", "selector", "command", "url", "javascript"):
            assert bad not in clean
        mod = clean["modules"]["youtube.channel.basic"]
        assert mod["enabled"] is True
        for bad in ("script", "selector", "url"):
            assert bad not in mod

    response = client.get(
        "/api/v1/config",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    body = response.json()
    for bad in ("script", "endpoint", "selector", "command", "url", "javascript"):
        assert bad not in body
    assert "token" not in body


def test_api_responses_exclude_token_except_register(client):
    """§59 — token plaintext only on register; other JSON APIs must not include token."""
    installation_id, token = _register(client)
    headers = {"Authorization": f"Bearer {token}"}

    cfg = client.get("/api/v1/config", headers=headers)
    assert cfg.status_code == 200
    assert "token" not in cfg.json()

    ingest = client.post(
        "/api/v1/collections",
        headers=headers,
        json={
            "collection_id": "col-p6-token",
            "installation_id": installation_id,
            "collector": "youtube.channel.basic",
            "collector_version": 1,
            "schema_version": 1,
            "captured_at": "2026-09-08T00:00:00.000Z",
            "status": "COMPLETE",
            "data": {},
        },
    )
    assert ingest.status_code in (200, 201)
    assert "token" not in ingest.json()

    err = client.post(
        "/api/v1/errors",
        headers=headers,
        json={
            "installation_id": installation_id,
            "message": "p6 token audit",
        },
    )
    assert err.status_code == 201
    assert "token" not in err.json()
