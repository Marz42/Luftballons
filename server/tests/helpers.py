"""Shared test helpers (not pytest fixtures)."""

from __future__ import annotations

import os

TEST_ENROLLMENT_SECRET = os.environ.get(
    "LUFTBALLONS_ENROLLMENT_SECRET",
    "test-enrollment-secret",
)


def register_headers(
    secret: str = TEST_ENROLLMENT_SECRET,
) -> dict[str, str]:
    return {"X-Luftballons-Enrollment": secret}
