# Phase 0 Manual Acceptance (P0-T1 … P0-T4)

Authoritative criteria: `IMPLEMENTATION.md` §36 Phase 0.

Automated unit tests cover registry, capability, task-runner state machine, one-task rule, cancel/`AbortSignal`, and unavailable semantics. **Tampermonkey + live YouTube Studio cannot be executed in CI / this agent environment** — run the steps below on a real workstation.

## Environment

| Item | Requirement |
|------|-------------|
| Browser | Chrome or Chromium |
| Extension | Tampermonkey (current stable) |
| Account | Logged into YouTube Studio for a test channel |
| Artifact | `client/dist/Luftballons.user.js` (from `pnpm build`) |

### Install the userscript

1. From repo root: `pnpm install && pnpm build`
2. Confirm file exists: `client/dist/Luftballons.user.js`
3. Open Tampermonkey → Dashboard → Utilities → **Import from file** (or open the file and use Tampermonkey’s install prompt)
4. Confirm metadata shows:
   - `@name Luftballons`
   - `@version 0.1.0`
   - `@match https://www.youtube.com/*`
   - `@match https://studio.youtube.com/*`
   - No `@match *://*/*`
   - No `@connect *`

---

## P0-T1 — Studio load + UI shell

**Steps**

1. Open `https://studio.youtube.com/` while logged in.
2. Wait for Studio to finish loading.
3. Locate the floating **Luftballons** button (bottom-right, low visual weight).
4. Click to open the panel; click again to close.
5. Use Studio normally (navigate Dashboard / Content) for ~1 minute with the panel closed.

**Expected**

- Luftballons button appears.
- Panel opens/closes without breaking Studio layout.
- Studio remains usable; no obvious jank or continuous console spam while idle.

**Pass / Fail:** ________

---

## P0-T2 — Ordinary YouTube: modules unavailable

**Steps**

1. Open `https://www.youtube.com/` (not Studio).
2. Open the Luftballons panel.

**Expected**

- Script still loads (allowed by `@match`).
- Studio modules (e.g. `youtube.channel.basic`, `youtube.subtitle.multilang`) show **unavailable** with reason **`WRONG_SITE`**.
- Start buttons are disabled / non-runnable for those modules.

**Pass / Fail:** ________

---

## P0-T3 — Simulated task RUNNING → COMPLETED

**Steps**

1. Open `https://studio.youtube.com/`.
2. Open Luftballons panel.
3. Confirm modules show **available**.
4. Click **Start (simulated)** on `youtube.channel.basic` (or the subtitle stub).
5. Watch the Task section.

**Expected**

- State progresses **RUNNING → COMPLETED** (simulated steps only; no real Studio navigation or data writes).
- Progress / summary text updates.
- After completion, another Start is allowed (one-task rule released).

**Pass / Fail:** ________

---

## P0-T4 — Cancel mid-task

**Steps**

1. On Studio, start a simulated task.
2. While state is **RUNNING**, click **Cancel**.

**Expected**

- Task ends as **CANCELLED**.
- No further simulated steps after cancel (AbortSignal path).
- Studio UI is not left in a broken state.

**Pass / Fail:** ________

---

## Sign-off

| Test | Result | Tester | Date |
|------|--------|--------|------|
| P0-T1 | PASS | MARZ | 2026-09-07 |
| P0-T2 | PASS | MARZ | 2026-09-07 |
| P0-T3 | PASS | MARZ | 2026-09-07 |
| P0-T4 | PASS | MARZ | 2026-09-07 |

> 全部 PASS。P0-T3/T4 首次实测为 PARTIAL（demo 步骤瞬时完成、无法观察/取消），
> 已修复（默认步进 600ms + 可中断等待，commit 672530f）后复测通过。

Phase 0 success (IMPLEMENTATION §36): Runtime loads reliably; one-task rule works; cancel works; modules can register; no obvious Studio regression.
