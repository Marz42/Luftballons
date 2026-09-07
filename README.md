# Luftballons

Local-first Tampermonkey userscript runtime for browser back-office workflows.
First adapter target: YouTube Studio.

Design principles: Human-triggered, UI-only, Fail-closed, Server-optional, no remote code execution.

## Milestone status

| Milestone | Status |
|-----------|--------|
| M0.1-network (Phases 0–5 code) | **Complete** — runtime, Studio collectors, subtitle + Human Gate, optional Server/Admin/remote config |
| Phase 6 Security Hardening (FT-017/018) | **In progress** — automated audit + compromise/token/OFF regressions; see `SECURITY.md` |
| Release Candidate | **Pending** manual live acceptance (Idle 10min, DevTools Network OFF, multi-PC Gate E) |

## Docs (authoritative)

- [`SPEC.md`](./SPEC.md) — product & security baseline (MVP SPEC v0.1)
- [`IMPLEMENTATION.md`](./IMPLEMENTATION.md) — interfaces, phases, acceptance (Plan v0.1)
- [`SECURITY.md`](./SECURITY.md) — threat model, token/CORS notes, audit triage
- [`AGENTS.md`](./AGENTS.md) — guidance for coding agents
- [`docs/release-gate.md`](./docs/release-gate.md) — Gate A–E + Blocker map for v0.1 release
- [`docs/manual-acceptance-p0.md`](./docs/manual-acceptance-p0.md) — Phase 0 Tampermonkey checklist
- [`docs/manual-acceptance-p2.md`](./docs/manual-acceptance-p2.md) … [`p5.md`](./docs/manual-acceptance-p5.md) — phase handbooks
- [`docs/studio-dom-calibration.md`](./docs/studio-dom-calibration.md) — 2026-09-07 real DOM evidence

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

### Security audit

After `pnpm build`, run the repeatable Phase 6 audit (userscript `@match`, forbidden source/dist patterns):

```bash
./scripts/security-audit.sh
```

Exit `0` = clean; any violation exits `1`. Rules and whitelist are documented in the script header.

## Server (optional — Phase 5b+)

Local FastAPI + SQLite for Installation register, Collection ingest, Remote Config,
Error intake, and minimal Admin SSR.

```bash
cd server
python3 -m venv .venv
.venv/bin/pip install -e '.[dev]'
.venv/bin/pytest -q
export ADMIN_PASSWORD='choose-a-strong-password'
LUFTBALLONS_DB_PATH=./data/luftballons.db .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
```

**Admin is internal-only** — do not expose `/admin` on the public internet. Bind
uvicorn to `127.0.0.1` (or an internal interface) and use a reverse proxy when
needed. If `ADMIN_PASSWORD` is unset, `/admin` returns 401 (no default password).

See [`server/README.md`](./server/README.md) for Admin Basic Auth and API surface.

Or: `scripts/dev-server.sh` (requires the venv above).
