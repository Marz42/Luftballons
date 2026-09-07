"""Pytest fixtures — isolated SQLite file per test session / recovery tests."""

from __future__ import annotations

import os
from collections.abc import Generator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

# Ensure tests never touch the developer default DB.
_TEST_DB = Path(__file__).resolve().parent / "_tmp_test.db"
os.environ["LUFTBALLONS_DATABASE_URL"] = f"sqlite:///{_TEST_DB}"


from app.db import Base, create_db_engine, init_db  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture()
def db_path(tmp_path: Path) -> Path:
    return tmp_path / "luftballons-test.db"


@pytest.fixture()
def engine(db_path: Path):
    url = f"sqlite:///{db_path}"
    eng = create_db_engine(url)
    init_db(eng)
    yield eng
    eng.dispose()


@pytest.fixture()
def session_factory(engine):
    return sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


@pytest.fixture()
def client(engine, session_factory) -> Generator[TestClient, None, None]:
    def _get_session() -> Generator[Session, None, None]:
        session = session_factory()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    from app.db import get_session

    app.dependency_overrides[get_session] = _get_session
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture()
def reopen_client(db_path: Path):
    """Factory: build a fresh TestClient on the same DB file (recovery semantics)."""

    def _open() -> TestClient:
        url = f"sqlite:///{db_path}"
        eng = create_db_engine(url)
        init_db(eng)
        factory = sessionmaker(bind=eng, autoflush=False, autocommit=False, future=True)

        def _get_session() -> Generator[Session, None, None]:
            session = factory()
            try:
                yield session
                session.commit()
            except Exception:
                session.rollback()
                raise
            finally:
                session.close()

        from app.db import get_session

        app.dependency_overrides[get_session] = _get_session
        return TestClient(app), eng

    return _open
