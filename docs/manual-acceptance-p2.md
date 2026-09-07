# Phase 2 Manual Acceptance (P2-T1 … P2-T4)

Authoritative criteria: `IMPLEMENTATION.md` §38 Phase 2 — YouTube Studio Adapter.

Automated unit tests cover detector fail-closed paths, DomService wait/abort, and SPA fixture navigation. **Live YouTube Studio DOM cannot be verified in CI / this agent environment** — calibrate selectors on a real workstation and report mismatches for the next signature revision.

## Environment

| Item | Requirement |
|------|-------------|
| Browser | Prefer **2 profiles** × **2 machines** (A/B UI coverage) |
| Extension | Tampermonkey (current stable) |
| Account | Logged into YouTube Studio (test channel) |
| Artifact | `client/dist/Luftballons.user.js` (`pnpm build`) |

Install steps: same as `docs/manual-acceptance-p0.md` (userscript import). Confirm `@match` allowlist unchanged (no `*://*/*`, no `@connect *`).

---

## Calibration notes (before / during P2-T1)

Phase 2 signatures are **assumptions** until you calibrate them. On a real Studio page:

1. Open DevTools → Elements on Dashboard / Analytics / Content.
2. Record (sanitized — **no** real channel/video IDs in tickets):
   - Root shell custom elements (e.g. presence/absence of `ytcp-app`, drawer tag names).
   - Sidebar item `aria-label` / `aria-current` / `href` path patterns.
   - Main landmark `aria-label` or stable page marker.
3. Compare against `client/src/sites/youtube-studio/selectors.ts` + layout matchers in the same file.
4. Report **mismatches only** (expected assumption → observed DOM). Do not paste account PII.

Until layout matches uniquely as `2026_V1` or `2026_V2`, modules must show **`UNSUPPORTED_LAYOUT`** (fail-closed). That is expected, not a regression.

---

## P2-T1 — Known layout page recognition

**Steps**

1. Open Studio Dashboard (`/channel/…`).
2. Open Luftballons panel; note availability reason if unavailable.
3. Navigate manually: Dashboard → Analytics → Content.
4. For each page, in DevTools console (or future debug UI), confirm detector would classify:
   - `DASHBOARD` / `ANALYTICS` / `CONTENT`
   - Layout `2026_V1` or `2026_V2` (not `UNKNOWN`)

**Expected**

- In **calibrated** environments: 100% correct page id for the three surfaces.
- If layout still uncalibrated: `UNKNOWN` layout + modules unavailable — **pass the fail-closed check**, then calibrate and re-run.

**Pass / Fail:** ________  
**Observed layout id:** ________  
**Mismatch notes:** ________

---

## P2-T2 — Unknown layout

**Steps**

1. With Luftballons loaded on Studio, artificially break the shell (DevTools): remove/rename the calibrated root marker or drawer so signatures no longer match.
2. Refresh panel availability / re-run detect.

**Expected**

- Layout → **`UNKNOWN`**
- Modules → unavailable with **`UNSUPPORTED_LAYOUT`**
- Must **not** invent a “best guess” page/layout.

**Pass / Fail:** ________

---

## P2-T3 — Navigation + postcondition

**Steps**

1. On a **known** layout build (after calibration), trigger adapter navigation path (Phase 2 service; Phase 3 modules will call it):
   - Dashboard → Analytics → Content
2. After each hop, confirm postcondition: detected page equals target and page-ready landmark is present.
3. Confirm no fixed long `sleep` is required for correctness (state wait).

**Expected**

- Each hop: `postcondition == true`
- Timeout → error / fail-closed (no silent continue)

**Pass / Fail:** ________

---

## P2-T4 — Cancel mid-navigation

**Steps**

1. Start a multi-hop navigation (Dashboard → Analytics → Content).
2. Cancel after the first hop completes (or during waitReady).

**Expected**

- No further nav click / next hop.
- Studio left usable; no hung waits.

**Pass / Fail:** ________

---

## Sign-off

| Test | Result | Tester | Date | Machine / Profile |
|------|--------|--------|------|-------------------|
| P2-T1 | | | | |
| P2-T2 | | | | |
| P2-T3 | | | | |
| P2-T4 | | | | |

Phase 2 success (IMPLEMENTATION §38): **Luftballons can know “I do not know the current page.”** Unknown/conflict → stop.

---

## Assumption checklist (for live DOM audit)

| Area | Assumption | File |
|------|------------|------|
| Layout V1 | `ytcp-app[data-luftballons-layout="2026_V1"]` **or** `ytcp-app` + `ytcp-navigation-drawer` | `selectors.ts` |
| Layout V2 | Explicit `data-luftballons-layout="2026_V2"` only | `selectors.ts` |
| Nav Dashboard / Analytics / Content | `aria-label` + `role="link"` (+ href fallbacks) | `selectors.ts` |
| Page ready | `main[data-page]` / `aria-label` landmarks | `selectors.ts` |
| URL paths | `/analytics`, `/videos`\|`/content`, `/video/…/edit`, `/translations` | `page-detector.ts` |
| DOM page | `aria-current="page"` on drawer links; main `aria-label` | `page-detector.ts` |
| Nav location fallback | `history.pushState` only if SPA click did not settle | `navigation.ts` |
| `back()` | In-app stack first; else `history.back()` | `navigation.ts` |
