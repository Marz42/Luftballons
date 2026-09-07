# AGENTS.md — Luftballons

## Before writing code

1. Read `SPEC.md` and `IMPLEMENTATION.md` at the repo root. They are the authoritative baseline.
2. Match terminology, interface signatures, and phase boundaries from those docs.
3. Confirm which Phase / FT you are implementing. Do not pull later-phase files “for later.”

## Development discipline

- Local-first, Human-triggered, Fail-closed, UI-only, Server-optional.
- Never `eval` / `new Function`. Never remote JS download or execution.
- Userscript `@match` / `@connect` must stay allowlisted (no `*://*/*`, no `@connect *`).
- Core `runtime/` must not import YouTube selectors, page names, or module implementations.
  Dependency direction: Site Adapter / modules → Runtime. Wiring only in bootstrap / `main`.
- Prefer DOM via `createElement` + `textContent`. Do not inject untrusted HTML via `innerHTML`.
- Idle pages: no polling / high-frequency observers. Event-driven updates only.
- One UI Automation Task at a time (TaskRunner one-task rule).

## Phase 0 scope (FT-001 … FT-004)

In scope: bootstrap, registry, capability manager, task runner + cancel, logger, UI shell, stub modules.

Out of scope: real collection, subtitle automation, server, network, IndexedDB sinks, Studio selectors / navigation.

## Commands

```bash
pnpm install
pnpm test
pnpm build
```

Build artifact: `client/dist/Luftballons.user.js`.
