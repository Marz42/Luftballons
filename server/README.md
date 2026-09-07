# Luftballons Server (Phase 5b)

Installation registration, Collection ingest, Remote Config, Error intake, and
minimal Admin SSR over SQLite.

## Setup

```bash
cd server
python3 -m venv .venv
.venv/bin/pip install -e '.[dev]'
```

## Run (internal / LAN)

**Admin is internal-only (IMPLEMENTATION §35).** Do not expose `/admin` on the
public internet. Prefer binding to loopback or an internal interface, and put a
reverse proxy in front if needed.

```bash
cd server
export ADMIN_PASSWORD='choose-a-strong-password'
export LUFTBALLONS_DB_PATH=./data/luftballons.db

# Recommended for local / single-operator use:
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000

# LAN-only example (still not public internet):
# .venv/bin/uvicorn app.main:app --host 192.168.2.10 --port 8000
```

If `ADMIN_PASSWORD` is unset, every `/admin*` request returns **401** (no weak
default password). API data endpoints (`/api/v1/*`) do not require admin password;
they use Installation Bearer tokens.

Admin Basic Auth username: `admin`  
Browser: open `http://127.0.0.1:8000/admin/`

## API surface

| Method | Path | Auth |
|--------|------|------|
| POST | `/api/v1/installations/register` | none (returns token once) |
| POST | `/api/v1/collections` | Bearer |
| GET | `/api/v1/config` | Bearer |
| POST | `/api/v1/errors` | Bearer |
| GET | `/admin/*` | Basic (`admin` + `ADMIN_PASSWORD`) |

Remote Config is whitelist-only (`schemaVersion`, `modules`, `minRuntimeVersion`,
`features`). Forbidden keys (`script`, `selector`, `url`, …) are dropped on write
and never returned.

## Test

```bash
cd server
.venv/bin/pytest -q
```

Default DB path: `server/data/luftballons.db` (override with `LUFTBALLONS_DB_PATH`
or `LUFTBALLONS_DATABASE_URL`).
