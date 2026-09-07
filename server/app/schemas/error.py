"""Pydantic schemas for Error intake (SPEC §44)."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, field_validator


MESSAGE_MAX_LEN = 2000
LAYOUT_SIG_MAX_LEN = 512


class ErrorIngestRequest(BaseModel):
    """Whitelist body — reject unknown / HTML-like fields via model_config."""

    model_config = ConfigDict(extra="forbid")

    installation_id: str = Field(min_length=1, max_length=64)
    module: str | None = Field(default=None, max_length=256)
    module_version: str | None = Field(default=None, max_length=64)
    runtime_version: str | None = Field(default=None, max_length=64)
    page: str | None = Field(default=None, max_length=512)
    task_state: str | None = Field(default=None, max_length=64)
    error_code: str | None = Field(default=None, max_length=128)
    message: str = Field(min_length=1, max_length=MESSAGE_MAX_LEN)
    layout_signature: str | None = Field(default=None, max_length=LAYOUT_SIG_MAX_LEN)

    @field_validator("message")
    @classmethod
    def message_not_html_dump(cls, value: str) -> str:
        # Soft guard: reject obvious full-document dumps (SPEC §44).
        lowered = value.lower().strip()
        if lowered.startswith("<!doctype") or lowered.startswith("<html"):
            raise ValueError("message must not contain full HTML documents")
        return value


class ErrorIngestResponse(BaseModel):
    accepted: bool = True
    id: int
