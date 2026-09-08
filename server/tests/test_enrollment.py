"""Registration enrollment gate + CORS defaults."""

from __future__ import annotations

from app.config import settings
from helpers import TEST_ENROLLMENT_SECRET, register_headers


def test_register_disabled_returns_403(client, monkeypatch):
    monkeypatch.setenv("LUFTBALLONS_ALLOW_REGISTRATION", "false")
    settings.reload()
    try:
        response = client.post(
            "/api/v1/installations/register",
            headers=register_headers(),
            json={"display_name": "blocked"},
        )
        assert response.status_code == 403
    finally:
        monkeypatch.setenv("LUFTBALLONS_ALLOW_REGISTRATION", "true")
        settings.reload()


def test_register_wrong_secret_returns_401(client):
    response = client.post(
        "/api/v1/installations/register",
        headers=register_headers("wrong-secret"),
        json={"display_name": "nope"},
    )
    assert response.status_code == 401


def test_register_missing_secret_returns_401(client):
    response = client.post(
        "/api/v1/installations/register",
        json={"display_name": "nope"},
    )
    assert response.status_code == 401


def test_register_body_secret_accepted(client):
    response = client.post(
        "/api/v1/installations/register",
        json={
            "display_name": "body-secret",
            "enrollment_secret": TEST_ENROLLMENT_SECRET,
        },
    )
    assert response.status_code == 201
    assert "token" in response.json()


def test_registered_bearer_api_unaffected(client):
    reg = client.post(
        "/api/v1/installations/register",
        headers=register_headers(),
        json={"display_name": "ok"},
    )
    assert reg.status_code == 201
    token = reg.json()["token"]
    cfg = client.get(
        "/api/v1/config",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert cfg.status_code == 200


def test_cors_defaults_exclude_star():
    assert "*" not in settings.allow_origins
    assert "https://studio.youtube.com" in settings.allow_origins
    assert "https://www.youtube.com" in settings.allow_origins


def test_cors_env_extension(monkeypatch):
    monkeypatch.setenv(
        "LUFTBALLONS_ALLOW_ORIGINS",
        "https://studio.youtube.com,https://example.test",
    )
    settings.reload()
    try:
        assert settings.allow_origins == [
            "https://studio.youtube.com",
            "https://example.test",
        ]
    finally:
        monkeypatch.delenv("LUFTBALLONS_ALLOW_ORIGINS", raising=False)
        settings.reload()
