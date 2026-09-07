#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../server"
exec .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 "$@"
