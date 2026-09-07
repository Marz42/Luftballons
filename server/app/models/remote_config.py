"""remote_config table (IMPLEMENTATION §31) — single active row."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


ACTIVE_KEY = "active"


class RemoteConfigRow(Base):
    __tablename__ = "remote_config"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    payload_json: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utc_now,
    )
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
