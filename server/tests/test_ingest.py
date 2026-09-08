"""Collection ingest — auth, validation, idempotency, recovery (P5-T3/T5/T7)."""

from __future__ import annotations

import json

from sqlalchemy import func, select

from app.models.collection import Collection
from helpers import register_headers


def _register(client, name: str = "PC-A") -> tuple[str, str]:
    body = client.post(
        "/api/v1/installations/register",
        headers=register_headers(),
        json={"display_name": name, "runtime_version": "0.1.0"},
    ).json()
    return body["installation_id"], body["token"]


def _payload(installation_id: str, collection_id: str = "col-1", **overrides):
    body = {
        "collection_id": collection_id,
        "installation_id": installation_id,
        "collector": "youtube.channel.basic",
        "collector_version": 2,
        "schema_version": 1,
        "captured_at": "2026-09-07T12:00:00.000Z",
        "status": "COMPLETE",
        "data": {"channel": {"channelName": "first"}},
    }
    body.update(overrides)
    return body


def test_ingest_created_with_valid_token(client):
    installation_id, token = _register(client)
    response = client.post(
        "/api/v1/collections",
        headers={"Authorization": f"Bearer {token}"},
        json=_payload(installation_id),
    )
    assert response.status_code == 201
    assert response.json() == {"already_ingested": False}


def test_ingest_idempotent_does_not_overwrite(client, session_factory):
    installation_id, token = _register(client)
    first = _payload(installation_id, data={"marker": "ORIGINAL"})
    r1 = client.post(
        "/api/v1/collections",
        headers={"Authorization": f"Bearer {token}"},
        json=first,
    )
    assert r1.status_code == 201

    second = _payload(
        installation_id,
        data={"marker": "OVERWRITE_ATTEMPT"},
        status="PARTIAL",
        collector="evil.collector",
    )
    r2 = client.post(
        "/api/v1/collections",
        headers={"Authorization": f"Bearer {token}"},
        json=second,
    )
    assert r2.status_code == 200
    assert r2.json() == {"already_ingested": True}

    with session_factory() as session:
        count = session.scalar(select(func.count()).select_from(Collection))
        assert count == 1
        row = session.get(Collection, "col-1")
        assert row is not None
        stored = json.loads(row.payload_json)
        assert stored["data"] == {"marker": "ORIGINAL"}
        assert stored["status"] == "COMPLETE"
        assert stored["collector"] == "youtube.channel.basic"
        assert row.status == "COMPLETE"


def test_ingest_bad_token_401(client):
    installation_id, _token = _register(client)
    response = client.post(
        "/api/v1/collections",
        headers={"Authorization": "Bearer totally-wrong-token"},
        json=_payload(installation_id),
    )
    assert response.status_code == 401


def test_ingest_disabled_installation_401(client, session_factory):
    installation_id, token = _register(client, name="PC-B")
    with session_factory() as session:
        from app.models.installation import Installation

        row = session.get(Installation, installation_id)
        assert row is not None
        row.enabled = False
        session.commit()

    response = client.post(
        "/api/v1/collections",
        headers={"Authorization": f"Bearer {token}"},
        json=_payload(installation_id, collection_id="col-revoked"),
    )
    assert response.status_code == 401


def test_ingest_validation_errors_422(client):
    installation_id, token = _register(client)
    headers = {"Authorization": f"Bearer {token}"}

    missing = _payload(installation_id)
    del missing["collector"]
    assert client.post("/api/v1/collections", headers=headers, json=missing).status_code == 422

    bad_time = _payload(installation_id, collection_id="col-bad-time", captured_at="not-a-date")
    assert client.post("/api/v1/collections", headers=headers, json=bad_time).status_code == 422

    bad_status = _payload(installation_id, collection_id="col-bad-status", status="DONE")
    assert client.post("/api/v1/collections", headers=headers, json=bad_status).status_code == 422

    bad_version = _payload(
        installation_id,
        collection_id="col-bad-ver",
        collector_version="two",  # type: ignore[arg-type]
    )
    assert (
        client.post("/api/v1/collections", headers=headers, json=bad_version).status_code
        == 422
    )


def test_data_survives_server_reopen(db_path, reopen_client):
    client_a, eng_a = reopen_client()
    try:
        reg = client_a.post(
            "/api/v1/installations/register",
            headers=register_headers(),
            json={"display_name": "PC-C"},
        ).json()
        installation_id, token = reg["installation_id"], reg["token"]
        created = client_a.post(
            "/api/v1/collections",
            headers={"Authorization": f"Bearer {token}"},
            json=_payload(installation_id, collection_id="col-persist"),
        )
        assert created.status_code == 201
    finally:
        client_a.close()
        eng_a.dispose()

    client_b, eng_b = reopen_client()
    try:
        again = client_b.post(
            "/api/v1/collections",
            headers={"Authorization": f"Bearer {token}"},
            json=_payload(
                installation_id,
                collection_id="col-persist",
                data={"marker": "should-not-overwrite"},
            ),
        )
        assert again.status_code == 200
        assert again.json()["already_ingested"] is True
    finally:
        client_b.close()
        eng_b.dispose()
        from app.db import get_session
        from app.main import app

        app.dependency_overrides.clear()


def test_ingest_concurrent_same_collection_id(client, session_factory):
    """Two overlapping inserts for the same collection_id → one 201, one 200, one row."""
    import threading
    from concurrent.futures import ThreadPoolExecutor

    installation_id, token = _register(client)
    headers = {"Authorization": f"Bearer {token}"}
    body = _payload(installation_id, collection_id="col-race")
    barrier = threading.Barrier(2)

    def once() -> tuple[int, dict]:
        barrier.wait(timeout=5)
        response = client.post("/api/v1/collections", headers=headers, json=body)
        return response.status_code, response.json()

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(once), pool.submit(once)]
        outcomes = [f.result(timeout=10) for f in futures]

    statuses = sorted(code for code, _ in outcomes)
    assert statuses == [200, 201]
    assert all("already_ingested" in body for _, body in outcomes)
    assert {body["already_ingested"] for _, body in outcomes} == {True, False}

    with session_factory() as session:
        count = session.scalar(select(func.count()).select_from(Collection))
        assert count == 1
