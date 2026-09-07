# Luftballons Server (Phase 5a)

Installation registration + Collection ingest over SQLite. No Admin / Config / Errors yet (Phase 5b).

## Setup

```bash
cd server
python3 -m venv .venv
.venv/bin/pip install -e '.[dev]'
```

## Run

```bash
cd server
LUFTBALLONS_DB_PATH=./data/luftballons.db .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## Test

```bash
cd server
.venv/bin/pytest -q
```

Default DB path: `server/data/luftballons.db` (override with `LUFTBALLONS_DB_PATH` or `LUFTBALLONS_DATABASE_URL`).
