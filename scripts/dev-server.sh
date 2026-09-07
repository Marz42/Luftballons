#!/usr/bin/env bash
# Internal / LAN only. Prefer 127.0.0.1 — do not expose Admin on the public internet.
# Set ADMIN_PASSWORD before starting if you need /admin.
set -euo pipefail
cd "$(dirname "$0")/../server"
exec .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 "$@"
