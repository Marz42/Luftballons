# SECURITY.md — Luftballons v0.1

Status: Phase 6 hardening (FT-017 close-out + FT-018). Companion to `SPEC.md` §56–§57 and `IMPLEMENTATION.md` §58–§63.

Repeatable automated check:

```bash
./scripts/security-audit.sh   # requires client/dist from pnpm build
```

---

## Threat model (T1–T6) and mitigations

| ID | Threat | Mitigation (where) |
|----|--------|-------------------|
| **T1** Server Compromise | Compromised server pushes remote code / selectors / actions | Client `validateRemoteConfig` rejects forbidden keys wholesale (`client/src/services/config-service.ts` `FORBIDDEN_KEYS` / `validateRemoteConfig`). Server `sanitize_config_payload` drops the same keys on write/read (`server/app/services/remote_config.py`). Capability separation + no push control of DOM actions. Tests: `security-compromise.test.ts`, `test_remote_compromise_admin_write_drops_script_url_selector`. |
| **T2** MITM | Tampered endpoint / insecure transport | Client `assertHttpBaseUrl` requires `http:`/`https:` only (`client/src/sinks/remote-sink.ts`). Paths are fixed allowlist (`ENDPOINT_PATHS`). HTTPS preferred in deploy notes; LAN HTTP acceptable for internal MVP. |
| **T3** Browser Script Bug | Automation continues after bad state | State machine + TaskRunner one-task rule; Human Gate for `WRITE_COMMIT`; cancel path; `killSwitch` via `withRemoteConfigGate` (`client/src/services/config-gate.ts`). |
| **T4** YouTube UI Change | Wrong clicks on unknown UI | Layout/page detection fail-closed (`page-detector.ts`); modules unavailable on `UNKNOWN` / `UNSUPPORTED_LAYOUT`; navigation refuses unknown layout. |
| **T5** Accidental Upload | Data leaves machine without intent | `NETWORK_SEND` separate capability; Network mode `OFF` short-circuits all fetch (`network-service.ts`); default `MANUAL` — sync only on explicit human action; no auto-sync UI for `ENABLED` yet. |
| **T6** Duplicate Collection | Double ingest / cross-install confusion | `collection_id` + `installation_id`; server idempotent ingest; client local retain on sync failure (`network.test.ts` retain case). |

---

## Security boundaries

| Boundary | Guarantee |
|----------|-----------|
| No remote code | No `eval` / `new Function` / remote JS download. Userscript `@grant none`. |
| No arbitrary endpoint | Fixed `ENDPOINT_PATHS` only; baseUrl must be http(s); remote config cannot set URLs/selectors/commands. |
| No credential collection | No Cookie / OAuth / Google credential scraping (`document.cookie` forbidden by audit). |
| Human gate | Subtitle publish requires explicit approval (`human-gate.ts` + workflow). |
| Fail-closed | Unknown layout/page → stop; invalid remote config → keep prior/defaults. |

---

## Token handling

| Layer | Convention |
|-------|------------|
| Client storage | `localStorage` key `luftballons.server.token` (`network-settings.ts` `STORAGE_KEYS.token`) |
| Client logs | Never log token plaintext — callers log `hasToken` / ids only (`network-service.ts` `saveSettings`, register/sync paths). Covered by `security-token.test.ts` + `network.test.ts`. |
| Server | Stores `sha256` hash only (`server/app/services/auth.py`). Plaintext returned **once** on `POST /api/v1/installations/register`. |
| Other API JSON | Must not include `token` field (asserted in `test_api_responses_exclude_token_except_register`). |
| Revoke | Admin rotate-token invalidates old bearer immediately. |

---

## CORS decision record

**Current:** `allow_origins=["*"]`, `allow_credentials=False`, methods `GET/POST/OPTIONS`, headers `Authorization` + `Content-Type` (`server/app/main.py`).

**Why `*` for MVP:** Userscript uses `@grant none`, so `fetch` runs as the Studio page origin (`https://studio.youtube.com`). Browser CORS applies; a fixed LAN origin list would break every Studio host unless every Studio origin is listed. Bearer token (not cookies) + Admin bind to `127.0.0.1` / internal interface is the compensating control.

**P6 conclusion:** Acceptable for **internal LAN MVP**. Before public/RC exposure, add `--allow-origins` (or env) to tighten to explicit origins / reverse-proxy same-origin. Tracked as **P1** (not a Blocker while Admin stays internal-only).

---

## Admin internal-only

- Bind uvicorn to `127.0.0.1` (or private interface). Do **not** publish `/admin` on the public internet.
- `ADMIN_PASSWORD` required; if unset, `/admin` returns 401 (no default password).
- See `server/README.md` and `docs/manual-acceptance-p5.md`.

---

## Browser impact notes (§62)

| Pattern | Status |
|---------|--------|
| `setInterval` | **0** in `client/src` |
| `setTimeout` | Single-shot only: `abortableDelay`, bounded `waitFor` timeout, short yields (20ms) in workflow/navigation — no polling loops |
| `MutationObserver` | **1** in `dom-service.ts` `waitForDomTarget` — created per wait, disconnected on settle/timeout/abort |
| Panel cleanup | `panel.destroy()` unsubscribes TaskRunner + detaches Human Gate + removes host (`panel.test.ts` destroy case) |

---

## Network mode semantics

| Mode | Behavior (current code) |
|------|-------------------------|
| `OFF` | Zero remote fetch from NetworkService / RemoteSink |
| `MANUAL` (default) | Optional single bootstrap config refresh when baseUrl+token set; sync only on explicit UI action |
| `ENABLED` | Type reserved; **not exposed in current UI**. Auto-sync semantics deferred until post-RC if needed |

---

## Known limitations (not live-verified in this batch)

- Idle 10 minutes CPU/memory/network observation on real Studio (§62) — **待真机**
- DevTools Network OFF end-to-end with collect + CSV + subtitle (§60) — handbook exists; re-confirm on RC machine
- Gate E multi-installation on ≥2 real PCs — **待真机**
- CORS tighten via `--allow-origins` — not implemented (P1)
- Logger has no automatic redactor; relies on call-site discipline + tests (P2 hardening candidate)

---

## Audit findings triage (this batch)

| Sev | Item | Status |
|-----|------|--------|
| P0 | Forbidden remote-config keys / eval / wildcard `@match` | Covered by `security-audit.sh` + compromise tests — **PASS on clean tree** |
| P1 | CORS `allow_origins=*` | Documented; tighten before non-LAN RC |
| P1 | Live Idle 10min / DevTools OFF / multi-PC Gate E | Manual RC |
| P2 | Automatic logger token redaction | Optional; call sites + tests currently green |
| P2 | Collections section has no explicit `detach` (dies with panel host) | Acceptable; panel destroy removes host |
