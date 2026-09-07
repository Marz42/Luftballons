# Phase 4 Manual Acceptance (P4-T1 … P4-T5)

Authoritative criteria: `IMPLEMENTATION.md` §46–§50 (Subtitle Multilang) and SPEC §34–§37, §10 (Human Gate).

Automated fixture tests cover existing-language skip, Human Gate hang/reject, UI mismatch fail-closed, and re-run idempotency. **Live YouTube Studio subtitle-page DOM cannot be verified in CI / this agent environment** — every `SUBTITLE_TARGETS` entry is an **assumption** until you return sanitized evidence (see collector below).

## Environment

| Item | Requirement |
|------|-------------|
| Browser | Prefer **2 profiles** × **2 machines** when possible |
| Extension | Tampermonkey (current stable) |
| Account | Logged into YouTube Studio |
| Test videos | Prefer **private / unlisted** test videos only (IMPLEMENTATION §49) |
| Artifact | `client/dist/Luftballons.user.js` (`pnpm build`) |
| Network Mode | Luftballons `networkMode=OFF` (bundled default) |

Install steps: same as `docs/manual-acceptance-p0.md`. Confirm `@match` allowlist unchanged (no `*://*/*`, no `@connect *`).

### Test video preparation

1. Create (or reuse) **≥5** private/unlisted videos on a test channel.
2. On at least one video, pre-add **English** subtitles (for P4-T1 / P4-T5).
3. Keep other videos without the target languages you will request.
4. Never run acceptance on public production content you care about — WRITE_COMMIT is irreversible from Luftballons.

---

## P4-T1 — Existing Language

**Steps**

1. Open a test video that already has **English** in Studio video details (`/video/…/edit`).
2. Open Luftballons; confirm `youtube.subtitle.multilang` is **available** (must be on VIDEO_DETAILS).
3. Select **English + Japanese** (日本語); click **添加多语言字幕**.
4. At Human Gate, read consequences; click **确认**.

**Expected**

- English → **SKIPPED** (no duplicate English).
- Japanese → added then published after confirm.
- Summary lists per-language outcomes.

**Pass / Fail:** ________  
**Notes:** ________

---

## P4-T2 — Human Gate

**Steps**

1. On VIDEO_DETAILS, start multilang with at least one **missing** language.
2. When the modal appears, **do not** confirm yet.

**Expected**

- Task state **WAITING_HUMAN**.
- Publish must **not** proceed without confirm.
- Cancel button on the panel remains usable.

**Pass / Fail:** ________

---

## P4-T3 — Reject

**Steps**

1. Reach Human Gate as in P4-T2.
2. Click **取消** (or panel Cancel while waiting).

**Expected**

- **No final publish/commit**.
- Result documents Human Gate REJECTED (warning `HUMAN_GATE_REJECTED` / languages CANCELLED).
- Studio left usable.

**Pass / Fail:** ________

---

## P4-T4 — UI Mismatch

**Steps**

1. On a calibrated shell, open the subtitle surface and **break** the assumed languages-list / publish anchors in DevTools (remove/rename nodes that match `SUBTITLE_TARGETS`).
2. From VIDEO_DETAILS, start the module again.

**Expected**

- Task **FAILED** with an explanatory reason (e.g. UI mismatch).
- **No speculative clicks** toward publish / add-language once the list is missing.

**Pass / Fail:** ________

---

## P4-T5 — Re-run

**Steps**

1. After a successful add+publish for a language set, return to VIDEO_DETAILS.
2. Run the **same** language selection again.

**Expected**

- Second run mostly **EXISTS / SKIPPED**.
- No duplicate language rows / duplicate publish for already-present languages.

**Pass / Fail:** ________

---

## §50 Success gate (Blocker rules)

Run continuously:

```text
5 test videos × 3 language combinations
```

| Requirement | Result |
|-------------|--------|
| 0 erroneous publishes | ________ |
| 0 erroneous deletes | ________ |
| 0 operations on the wrong video | ________ |

**Any wrong-video write = Blocker.** Stop and report.

---

## Sign-off

| Test | Result | Tester | Date | Machine / Profile |
|------|--------|--------|------|-------------------|
| P4-T1 | | | | |
| P4-T2 | | | | |
| P4-T3 | | | | |
| P4-T4 | | | | |
| P4-T5 | | | | |
| §50 5×3 matrix | | | | |

---

## Subtitle-page DOM evidence collector (read-only)

Paste into Tampermonkey / DevTools **Console** on a Studio **subtitle / translations** page for a test video. Output is sanitized (ids redacted). Return the JSON in the calibration form below — **do not** paste real channel/video ids.

```js
(() => {
  const redact = (s) =>
    String(s ?? "")
      .replace(/\/channel\/[^/?#]+/gi, "/channel/<REDACTED>")
      .replace(/\/video\/[^/?#]+/gi, "/video/<REDACTED>")
      .replace(/UC[\w-]{10,}/g, "<CHANNEL>")
      .slice(0, 240);

  const describe = (el) => {
    if (!el) return null;
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      role: el.getAttribute("role"),
      ariaLabel: el.getAttribute("aria-label"),
      ariaCurrent: el.getAttribute("aria-current"),
      href: el.getAttribute("href") ? redact(el.getAttribute("href")) : null,
      text: redact((el.textContent || "").replace(/\s+/g, " ").trim()).slice(0, 80),
      dataAttrs: [...el.attributes]
        .map((a) => a.name)
        .filter((n) => n.startsWith("data-"))
        .slice(0, 12),
    };
  };

  const q = (sel) => document.querySelector(sel);
  const qa = (sel) => [...document.querySelectorAll(sel)].slice(0, 8);

  const guessLangItems = qa(
    "[data-language-code], [data-lang], ytcp-language-item, [class*='language' i]",
  );

  const report = {
    note: "assumption evidence — not a claim of calibrated selectors",
    hrefPath: redact(location.pathname + location.search),
    shell: {
      ytcpApp: !!q("ytcp-app"),
      drawer: !!q("ytcp-navigation-drawer"),
      main: describe(q("main#main, main")),
    },
    navTranslations: describe(
      q('ytcp-navigation-drawer a[href*="translation"], ytcp-navigation-drawer a[href*="subtitle"]'),
    ),
    candidates: {
      addLanguage: qa(
        'button[aria-label*="Add" i], button[aria-label*="添加"], #add-language-button, [class*="add-language" i]',
      ).map(describe),
      publish: qa(
        'button[aria-label*="Publish" i], button[aria-label*="发布"], #publish-button, [class*="publish" i]',
      ).map(describe),
      languageListHosts: qa(
        '#language-list, #translations-list, [aria-label*="language" i], [class*="language-list" i]',
      ).map(describe),
      languageItems: guessLangItems.map(describe),
    },
  };

  console.log("LUFTBALLONS_P4_SUBTITLE_DOM");
  console.log(JSON.stringify(report, null, 2));
  return report;
})();
```

---

## Calibration report form (same shape as P2)

```text
### P4 subtitle DOM calibration report

Date:
Machine / Browser / Profile:
Studio language (UI):
Video visibility (private/unlisted/public):

| Assumption target (selectors.ts SUBTITLE_TARGETS) | Present? | Observed tag / aria / href pattern (sanitized) | Match / mismatch |
|---------------------------------------------------|----------|------------------------------------------------|------------------|
| subtitle.languages.list | | | |
| subtitle.language.item | | | |
| subtitle.add_language | | | |
| subtitle.language.picker | | | |
| subtitle.language.option | | | |
| subtitle.publish | | | |
| page.subtitles.title (waitReady) | | | |

Paste sanitized collector JSON (optional):
<...>

Blockers / wrong-video incidents:
None / …
```

Until this report lands, keep all `assumption, calibrate on real device` comments. Do not claim live verification.


## 2026-09-08 review follow-up

- An empty container is not evidence of an empty language list. Wait up to two seconds for rows or an explicit empty-state signal; otherwise stop before adding. The current data-subtitle-list-state=EMPTY marker is a fixture assumption requiring real DOM calibration. Do not inject the marker into Studio to bypass this gate.
- An unrecoverable language-add timeout/UI error terminates the whole workflow before Human Gate, even if earlier languages remain pending. No automatic rollback or publication occurs.
- Recheck site, video and known layout before writes, including after picker waits; detached/inactive editor and option nodes are rejected.
- Confirm added rows only within the editor's language list and require pending/published state. Picker options cannot prove an add succeeded.
- Regression cases include rows arriving after 800 ms, unknown empty container, first-language success followed by failure, layout loss during approval, video switch during picker wait, and no-op option selection. These are synthetic tests, not live subtitle DOM evidence.
