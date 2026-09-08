"""P5-T1 / FT-014 — installation registration."""

from __future__ import annotations

from sqlalchemy import select

from app.models.installation import Installation
from app.services.auth import hash_token
from helpers import register_headers


def test_register_returns_id_and_token_once(client, session_factory):
    response = client.post(
        "/api/v1/installations/register",
        headers=register_headers(),
        json={"display_name": "PC-A", "runtime_version": "0.1.0"},
    )
    assert response.status_code == 201
    body = response.json()
    assert "installation_id" in body
    assert "token" in body
    assert body["api_version"] == "1"
    token = body["token"]
    installation_id = body["installation_id"]
    assert len(token) >= 32

    with session_factory() as session:
        row = session.get(Installation, installation_id)
        assert row is not None
        assert row.display_name == "PC-A"
        assert row.runtime_version == "0.1.0"
        assert row.enabled is True
        assert row.token_hash == hash_token(token)
        assert row.token_hash != token
        # Plaintext token must not appear in DB columns.
        assert token not in (row.token_hash, row.id, row.display_name or "")


def test_register_each_call_is_independent(client, session_factory):
    a = client.post(
        "/api/v1/installations/register",
        headers=register_headers(),
        json={},
    ).json()
    b = client.post(
        "/api/v1/installations/register",
        headers=register_headers(),
        json={},
    ).json()
    assert a["installation_id"] != b["installation_id"]
    assert a["token"] != b["token"]

    with session_factory() as session:
        rows = session.scalars(select(Installation)).all()
        assert len(rows) == 2
