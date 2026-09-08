"""Server settings (env-overridable)."""

from __future__ import annotations

import os
from pathlib import Path


def _default_db_path() -> Path:
    return Path(__file__).resolve().parent.parent / "data" / "luftballons.db"


_DEFAULT_ORIGINS = (
    "https://studio.youtube.com",
    "https://www.youtube.com",
)


def _parse_origins(raw: str | None) -> list[str]:
    if raw is None or raw.strip() == "":
        return list(_DEFAULT_ORIGINS)
    parts = [p.strip() for p in raw.split(",") if p.strip()]
    return parts if parts else list(_DEFAULT_ORIGINS)


def _env_truthy(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


class Settings:
    """MVP config — no remote code; data + declarative remote config (Phase 5b)."""

    api_version: str = "1"
    database_url: str
    allow_origins: list[str]
    allow_registration: bool
    enrollment_secret: str

    def __init__(self) -> None:
        self.reload()

    def reload(self) -> None:
        raw = os.environ.get("LUFTBALLONS_DATABASE_URL")
        if raw:
            self.database_url = raw
        else:
            path = Path(os.environ.get("LUFTBALLONS_DB_PATH", str(_default_db_path())))
            path.parent.mkdir(parents=True, exist_ok=True)
            self.database_url = f"sqlite:///{path.resolve()}"

        self.allow_origins = _parse_origins(os.environ.get("LUFTBALLONS_ALLOW_ORIGINS"))
        # Default closed: enable only during install windows.
        self.allow_registration = _env_truthy("LUFTBALLONS_ALLOW_REGISTRATION", False)
        self.enrollment_secret = (
            os.environ.get("LUFTBALLONS_ENROLLMENT_SECRET", "").strip()
        )


settings = Settings()
