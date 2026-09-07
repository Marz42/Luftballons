# Luftballons

Local-first Tampermonkey userscript runtime for browser back-office workflows.
First adapter target: YouTube Studio.

Design principles: Human-triggered, UI-only, Fail-closed, Server-optional, no remote code execution.

## Docs (authoritative)

- [`SPEC.md`](./SPEC.md) — product & security baseline (MVP SPEC v0.1)
- [`IMPLEMENTATION.md`](./IMPLEMENTATION.md) — interfaces, phases, acceptance (Plan v0.1)
- [`AGENTS.md`](./AGENTS.md) — guidance for coding agents
- [`docs/manual-acceptance-p0.md`](./docs/manual-acceptance-p0.md) — Phase 0 Tampermonkey checklist
- [`docs/studio-dom-calibration.md`](./docs/studio-dom-calibration.md) — 2026-09-07 real DOM evidence, collector v2 behavior and remaining live checks

## Develop

Requires Node ≥ 20. This repo uses **pnpm** (via Corepack).

```bash
corepack enable
corepack prepare pnpm@9.15.9 --activate
pnpm install
pnpm test
pnpm build
```

Userscript output:

```text
client/dist/Luftballons.user.js
```

Install that file in Tampermonkey (Chrome / Chromium). Match hosts are only:

- `https://www.youtube.com/*`
- `https://studio.youtube.com/*`

## Server (Phase 5a — optional)

Local FastAPI + SQLite for Installation register + Collection ingest. Config/Admin/Errors are Phase 5b.

```bash
cd server
python3 -m venv .venv
.venv/bin/pip install -e '.[dev]'
.venv/bin/pytest -q
LUFTBALLONS_DB_PATH=./data/luftballons.db .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Or: `scripts/dev-server.sh` (requires the venv above).
