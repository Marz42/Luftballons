# AGENTS.md — Luftballons

## Before writing code

1. Read `SPEC.md` and `IMPLEMENTATION.md` at the repo root. They are the authoritative baseline.
2. Match terminology, interface signatures, and phase boundaries from those docs.
3. Confirm which Phase / FT you are implementing. Do not pull later-phase files “for later.”
4. For security / release work, also read `SECURITY.md` and `docs/release-gate.md`.

## Development discipline

- Local-first, Human-triggered, Fail-closed, UI-only, Server-optional.
- Never `eval` / `new Function`. Never remote JS download or execution.
- Userscript `@match` / `@connect` must stay allowlisted (no `*://*/*`, no `@connect *`).
- Core `runtime/` must not import YouTube selectors, page names, or module implementations.
  Dependency direction: Site Adapter / modules → Runtime. Wiring only in bootstrap / `main`.
- Prefer DOM via `createElement` + `textContent`. Do not inject untrusted HTML via `innerHTML`.
- Idle pages: no polling / high-frequency observers. Event-driven updates only.
- One UI Automation Task at a time (TaskRunner one-task rule).

## Current milestone (do not regress)

Code complete through **M0.1-network** (Phases 0–5): bootstrap/runtime, local collections + CSV/JSON,
YouTube Studio channel.basic + subtitle.multilang, Human Gate, optional Server (register/ingest/config/errors/Admin),
Network OFF/MANUAL, remote config whitelist + killSwitch.

**Phase 6 (FT-017/018)** is security hardening + release audit — no new features. Prefer tests,
`scripts/security-audit.sh`, and docs over behavior changes.

**RC** still requires live Studio acceptance (see `docs/release-gate.md`).

Historical Phase 0-only scope (FT-001…004 skeleton) is complete and superseded; do not treat the repo as Phase 0.

## Commands

```bash
pnpm install
pnpm test
pnpm build
./scripts/security-audit.sh   # after build; exit 0 required for clean tree
```

Build artifact: `client/dist/Luftballons.user.js`.

Server (optional): `cd server && .venv/bin/pytest -q`.
