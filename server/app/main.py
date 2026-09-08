"""Luftballons Server — Phase 5b (register, ingest, config, errors, admin)."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import admin, collections, config, errors, installations
from app.config import settings
from app.db import init_db


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


app = FastAPI(
    title="Luftballons Server",
    version="0.1.0",
    lifespan=lifespan,
)

# Userscript fetch runs as Studio page origin. Default allowlist — not "*".
# Extend via LUFTBALLONS_ALLOW_ORIGINS (comma-separated).
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allow_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Luftballons-Enrollment"],
)

app.include_router(installations.router)
app.include_router(collections.router)
app.include_router(config.router)
app.include_router(errors.router)
# Admin is internal-only (IMPLEMENTATION §35). Requires ADMIN_PASSWORD.
# Do not bind this process to a public interface without a reverse proxy.
app.include_router(admin.router)


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}
