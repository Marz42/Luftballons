"""Server settings (env-overridable)."""

from __future__ import annotations

import os
from pathlib import Path


def _default_db_path() -> Path:
    return Path(__file__).resolve().parent.parent / "data" / "luftballons.db"


class Settings:
    """MVP config — no remote code, data endpoints only (Phase 5a)."""

    api_version: str = "1"
    database_url: str

    def __init__(self) -> None:
        raw = os.environ.get("LUFTBALLONS_DATABASE_URL")
        if raw:
            self.database_url = raw
        else:
            path = Path(os.environ.get("LUFTBALLONS_DB_PATH", str(_default_db_path())))
            path.parent.mkdir(parents=True, exist_ok=True)
            self.database_url = f"sqlite:///{path.resolve()}"


settings = Settings()
