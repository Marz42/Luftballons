"""Pydantic schemas — installation register (SPEC §59 / IMPLEMENTATION §32)."""

from __future__ import annotations

from pydantic import BaseModel, Field


class RegisterRequest(BaseModel):
    display_name: str | None = Field(default=None, max_length=256)
    runtime_version: str | None = Field(default=None, max_length=64)
    enrollment_secret: str | None = Field(default=None, max_length=256)


class RegisterResponse(BaseModel):
    installation_id: str
    token: str
    api_version: str
