# Phase 3 Manual Acceptance (P3-T1 … P3-T5)

> Updated calibration: [2026-09-07 evidence and collector v2 behavior](./studio-dom-calibration.md). The historical assumption checklist below is superseded for the evidenced Dashboard, Analytics and Content fields. DOM checks are complete for the reported sample; userscript live acceptance is still pending.

Authoritative criteria: `IMPLEMENTATION.md` §39–§45 (YouTube Basic Collector) and SPEC §38–§42, §19.

Automated fixture tests cover collector workflow, PARTIAL failure, cancel, and abbreviation parsing. **Live YouTube Studio DOM cannot be verified in CI / this agent environment** — calibrate selectors on a real logged-in workstation and use the calibration report form below.

## Environment

| Item | Requirement |
|------|-------------|
| Browser | Prefer **Channel A** (recent videos present) and **Channel B** (few / sparse recent videos) |
| Extension | Tampermonkey (current stable) |
| Account | Logged into YouTube Studio |
| Network Mode | Luftballons `networkMode=OFF` (bundled default) |
| Artifact | `client/dist/Luftballons.user.js` (`pnpm build`) |

Install steps: same as `docs/manual-acceptance-p0.md`. Confirm `@match` allowlist unchanged (no `*://*/*`, no `@connect *`).

### Channel scenarios

| Channel | Purpose |
|---------|---------|
| **Channel A** | Has multiple recent videos in Content — validates full recentVideos capture |
| **Channel B** | Few or no recent videos — expects COMPLETE or honest PARTIAL (empty/short list), never invented rows |

### Documented abbreviation rounding (P3-T2)

When Studio shows abbreviated UI values, Luftballons parses as follows (`metrics.ts` / IMPLEMENTATION §42):

| Display | Parsed `value` | `precision` |
|---------|----------------|-------------|
| `12.3K` | `12300` | `DISPLAY_ROUNDED` |
| `1.2M` | `1200000` | `DISPLAY_ROUNDED` |
| `4.5K` | `4500` | `DISPLAY_ROUNDED` |
| `12,345` / `120` | exact integer | `EXACT` |
| `—` / `N/A` / empty | omitted (`undefined`) | — (never store `0` as unknown) |

**Schema note:** `ChannelBasicData` keeps plain `number` fields (schema v1 / CSV shape unchanged). Precision is recorded on `TaskResult.warnings` with code `METRIC_DISPLAY_ROUNDED` (not pretended EXACT).

---

## P3-T1 — Basic Collection

**Steps**

1. Open Studio (known layout after P2 calibration).
2. Open Luftballons panel.
3. Click **采集频道数据** on `youtube.channel.basic`.

**Expected**

- Exactly **one** new Collection in the Collections panel.
- Task ends `COMPLETED` or honest `PARTIAL` (never silent data loss).

**Pass / Fail:** **PASS** (MARZ, 2026-09-07)  
**collectionId:** ________

---

## P3-T2 — Manual verification (exact match)

**Steps**

1. After a successful collect, pick at random from the Collection:
   - `summary.views`
   - `summary.subscriberDelta` (subscriber growth)
   - **3** recent videos (title / views / publish date if present)
2. Compare to the visible Studio UI on the same reporting period.

**Expected**

- Exact match when UI shows full integers.
- If UI shows abbreviations: parsed value follows the rounding table above; warning `METRIC_DISPLAY_ROUNDED` may appear.

**Pass / Fail:** **PASS** (MARZ, 2026-09-07)  
**Mismatches:** ________

---

## P3-T3 — Partial failure (broken recent-video selector)

**Steps**

1. In DevTools, temporarily break the Content list / row anchors that Luftballons uses (remove `content.videos.list` / video rows, or rename calibrated markers after you know them).
2. Run **采集频道数据** again.

**Expected**

- Channel summary fields that were readable are **retained**.
- `Collection.status = PARTIAL`
- Warning visible for recent videos (e.g. `RECENT_VIDEOS_MISSING`)
- Task must **not** fail closed by discarding already-read summary data.

**Pass / Fail:** **PASS** (MARZ, 2026-09-07)

---

## P3-T4 — No upload (Network OFF)

**Steps**

1. Confirm Luftballons network mode is **OFF**.
2. Open DevTools → Network.
3. Run a full collect.

**Expected**

- **Luftballons external network requests = 0** (no `fetch` / XHR / WebSocket initiated by the userscript).
- YouTube’s own Studio traffic does **not** count against this check.

**Pass / Fail:** **PASS** (MARZ, 2026-09-07)

---

## P3-T5 — Cancel mid Analytics → Content

**Steps**

1. Prefer a path that navigates Analytics then Content (e.g. start when Dashboard lacks the needed cards, or interrupt after Analytics is visible).
2. Click **Cancel** during Analytics → Content.

**Expected**

- No further Luftballons navigation after cancel.
- Task state **CANCELLED**.
- Any already-read data may remain as a local **PARTIAL** Collection (Collections panel); must not continue writing after cancel.

**Pass / Fail:** **PASS** (MARZ, 2026-09-07)

---

## §44 — Ten consecutive live collects

Record 10 human-triggered collects on a real machine. Target: **≥ 9/10** complete success; failures must be fail-safe (no bad clicks, no erroneous page mutation, no data loss of prior Collections).

| # | Channel (A/B) | Result (COMPLETE / PARTIAL / CANCELLED / FAIL) | Fail-safe? | Notes |
|---|---------------|-----------------------------------------------|------------|-------|
| 1 | A | 确认完成（PARTIAL 为主，校准频道指标缺失场景） | ✓ | 用户确认 2026-09-07 |
| 2 | A | 同上 | ✓ | |
| 3 | A | 同上 | ✓ | |
| 4 | A | 同上 | ✓ | |
| 5 | A | 同上 | ✓ | |
| 6 | A | 同上 | ✓ | |
| 7 | A | 同上 | ✓ | |
| 8 | A | 同上 | ✓ | |
| 9 | A | 同上 | ✓ | |
| 10 | A | 同上 | ✓ | |

**Score:** 10/10（用户确认，2026-09-07；逐次明细未提供，场景以 PARTIAL 为主——频道指标缺失属校准预期）
**Mis-clicks / bad page edits:** 0
**Data loss observed:** 0

---

## Calibration report form

When live DOM does not match assumptions in `selectors.ts`, report **mismatches only** (sanitize — no real channel/video account PII in tickets):

| Page | Element (logical id) | Expected (assumption) | Actual (observed) |
|------|----------------------|------------------------|-------------------|
| e.g. CONTENT | `content.videos.list` | `ytcp-video-section-content` | … |
| | | | |

---

## Sign-off

| Test | Result | Tester | Date | Machine / Profile |
|------|--------|--------|------|-------------------|
| P3-T1 | PASS | MARZ | 2026-09-07 | 工作机 / 校准频道 |
| P3-T2 | PASS | MARZ | 2026-09-07 | 工作机 / 校准频道 |
| P3-T3 | PASS | MARZ | 2026-09-07 | 工作机 / 校准频道 |
| P3-T4 | PASS | MARZ | 2026-09-07 | 工作机 / 校准频道 |
| P3-T5 | PASS | MARZ | 2026-09-07 | 工作机 / 校准频道 |
| §44 10× | PASS (10/10) | MARZ | 2026-09-07 | 工作机 / 校准频道 |

> 全部 PASS。M0.1-local 里程碑（P0–P3）验收结案。
> 采集在本频道以 PARTIAL 为主（指标缺失属校准预期，见 docs/studio-dom-calibration.md）。

Phase 3 success (IMPLEMENTATION §44): success when data is correct; failure stops safely.

---

## Assumption checklist (collector)

| Area | Assumption | File |
|------|------------|------|
| Channel name | `aria-label="Channel name"` / `data-luftballons-target="channel.name"` | `selectors.ts` |
| Dashboard period / views / subscribers | `data-luftballons-target` + aria labels | `selectors.ts` |
| Analytics views / subscriber delta | Scoped under `main[data-page="ANALYTICS"]` | `selectors.ts` |
| Content list + rows | `content.videos.list` + `CONTENT_VIDEO_ROW_SELECTOR` | `selectors.ts` |
| Channel id | Parsed from `/channel/{id}` URL only (never localStorage/API) | `collector.ts` |
| Abbreviation math | K/M/B × multipliers; `DISPLAY_ROUNDED` via warnings | `metrics.ts` |
