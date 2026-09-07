"""Luftballons Server — Phase 5b (register, ingest, config, errors, admin)."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import admin, collections, config, errors, installations
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

# Userscript runs on Studio origin with grant none → browser CORS applies.
# Authorization header (Bearer) only; no cookies. Internal LAN MVP.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
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
