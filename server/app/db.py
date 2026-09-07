"""SQLAlchemy engine / session (Phase 5a — create_all, no migrations)."""

from __future__ import annotations

from collections.abc import Generator

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings


class Base(DeclarativeBase):
    pass


def _sqlite_connect_args(url: str) -> dict:
    if url.startswith("sqlite"):
        return {"check_same_thread": False}
    return {}


def create_db_engine(database_url: str | None = None) -> Engine:
    url = database_url or settings.database_url
    engine = create_engine(
        url,
        connect_args=_sqlite_connect_args(url),
        future=True,
    )

    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_connection, connection_record) -> None:  # noqa: ANN001, ARG001
        if url.startswith("sqlite"):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

    return engine


engine = create_db_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def init_db(bind: Engine | None = None) -> None:
    """Create Phase 5 tables (installations, collections, remote_config, error_logs)."""
    # Import models so metadata is populated.
    from app.models import collection as _collection  # noqa: F401
    from app.models import error_log as _error_log  # noqa: F401
    from app.models import installation as _installation  # noqa: F401
    from app.models import remote_config as _remote_config  # noqa: F401

    target = bind or engine
    Base.metadata.create_all(bind=target)


def get_session() -> Generator[Session, None, None]:
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
