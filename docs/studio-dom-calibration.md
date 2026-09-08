# Studio DOM calibration — 2026-09-07

Scope: P2 / FT-007–008 and P3 / FT-009–010. Source: user-provided, logged-in
zh-Hans-CN Studio DOM fragments and read-only console results in this task.
No credentials, full account HTML, real channel names or video identifiers are
stored in the regression fixtures. Existing P0 scope in AGENTS.md describes the
original milestone; this change adapts the already implemented P2/P3 collector.

## Observed and manually rechecked

| Surface | Evidence / selector | Verification |
| --- | --- | --- |
| Shell/navigation | ytcp-app + ytcp-navigation-drawer; menuitem href + aria-current | Dashboard and Analytics sidebar transitions |
| Channel name | ytcp-navigation-drawer #entity-name | One match; exclude tooltip descendants |
| Dashboard ready | h1.page-title[theme="DASHBOARD"] | One match after sidebar transition |
| Dashboard period | ytcd-channel-facts-item .section-title > .section-subtitle-text, parent section title exactly 摘要 | Past 28 days; reject 热门内容 / past 48 hours |
| Dashboard views | #metrics-table #metric-0-value within facts component; row label 观看次数 | One match, zero |
| Dashboard subscribers | .subscribers-trend empty; .metric-value-big is total | Net change absent, never substitute total |
| Analytics period | yta-time-picker #picker-trigger .label-text / .dropdown-trigger-text | One visible match, 2026/8/10 – 2026/9/6 / past 28 days |
| Analytics metrics | #key-metric-blocks, EXTERNAL_VIEWS-tab / SUBSCRIBERS_NET_CHANGE-tab, scoped #metric-total | One visible value each, both em dash |
| Content list | ytcp-video-section-content#video-list | One match, including after refresh; #video-list alone is ambiguous |
| Content row | ytcp-video-row[role="row"] | One row; a#video-title, .tablecell-views, .tablecell-date |
| Date semantics | Direct date text + .cell-description | 发布日期; header also documents upload/scheduled dates |
| Sort | ytcp-table-header .tablecell-date[aria-sort="descending"] | Retained after refresh |
| Pagination | List-scoped ytcp-table-footer#footer | Page size 30, range 1–1 of 1; four buttons disabled |

## Collector version 2 behavior

- Calibrated CSS targets reject multiple active candidates and ignore explicitly
  hidden or unselected retained SPA pages. Fixture data markers remain supported.
- Channel name excludes tooltip text. Dashboard views require the observed Chinese
  label; summary period requires 摘要. Other languages are not certified by this batch.
- The observed empty subscriber trend is supported. Nonempty trend prose remains
  uncalibrated, so net growth is read from the Analytics net-change card instead.
- Zero is a value. Empty strings and em dashes never become zero.
- If Analytics provides numeric metrics and a valid date range, it becomes the sole
  summary source, including period.start/end (date-only strings). Dashboard metrics
  are not combined with Analytics metrics, even when period labels match.
  When both Analytics metrics are missing, preserve the readable Dashboard summary
  and its label without inventing exact dates. Unknown Analytics dates reject its
  numeric metrics and yield PARTIAL.
- Title and views use unique cells within each video row. Only dates explicitly
  labelled 发布日期 populate publishedAt; raw displayed dates are retained.
- Collection captures currently rendered rows only. Unknown/non-descending order,
  unreadable or inconsistent pagination, or another page available causes PARTIAL.
  No automatic page-size changes or unverified multi-page clicking is introduced.
  Completeness refers to the current filtered video list, not Shorts/live/all content.
- Watch time, total subscribers and comments remain outside the existing schema.
  Schema version remains unchanged; collectorVersion is 2.

## Evidence boundaries and live acceptance

The user verified DOM matching, Dashboard/Analytics sidebar transitions, and Content
refresh. This is not a successful userscript collection run. Local regression tests
use sanitized minimal DOM structures; nonzero/negative net growth, duplicate nodes,
different date types and additional pages are synthetic scenarios, not live evidence.

After installing `client/dist/Luftballons.user.js`, the user ran one manually triggered
collection, verified the saved Collection and JSON/CSV export against the UI, then
completed the P3 cancel, Network OFF and ten-run checklist — **all PASS (MARZ, 2026-09-07,
see `docs/manual-acceptance-p3.md` sign-off)**. For the supplied sample, results were
PARTIAL (Dashboard views 0, missing subscriberDelta, one video row), matching the
documented expectations; every run was fail-safe.

Multi-page traversal, empty lists, nonzero growth, other languages/layouts and
multiple profiles remain live-unverified.

### Live residuals — 2026-09-08 re-acceptance

Chinese-locale Studio channel collect (`PARTIAL`, 30 rendered videos):

- **Pagination:** userscript still does not advance Content “next page”; only the
  current rendered page is captured (`VIDEO_SCOPE_PARTIAL`). Multi-page automation
  remains an explicit product gap (see `docs/manual-acceptance-p3.md` Known gaps).
- **Metric abbreviations:** ASCII `K`/`M`/`B` are implemented. CJK forms such as
  `54.8万` / `亿` are **not** parsed → `METRIC_UNPARSED` + omit field (fail-closed).
  Tracked as a parse-layer gap alongside documenting K/M/B coverage limits.

### P4 subtitle surface — 2026-09-08 DOM evidence (zh-Hans-CN)

Sanitized live page `/video/<VIDEO_ID>/translations`:

| Signal | Observed |
| --- | --- |
| URL | `/video/<VIDEO_ID>/translations` |
| Page title | `h1` text `视频字幕` (not English “Subtitles”) |
| Video tab current | `a#menu-item-4[href="/video/<VIDEO_ID>/translations"][aria-current=page]` text `字幕` |
| Details tab | `a#menu-item-0[href="/video/<VIDEO_ID>/edit"]` text `详细信息` |
| Languages table | `#ytgn-video-translations-list-table` `aria-label="翻译"` |
| Add language | Black control `添加语言` below table (not inside table) |
| Picker option | `tp-yt-paper-item[role=option]` text `日语` (label-only, no data-language-code) |
| Label map | `日语` → `ja`; `英语 （视频语言）` strips parentheticals |
| Persistence gap | Selecting a language may show a transient table row that disappears on refresh when no caption file / auto-translate is available — not a publish success |

### Real Studio multilang publish path (2026-09-08 screenshots + operator steps)

Operator-confirmed sequence on the **语言** (`/translations`) surface:

1. On the **语言** page.
2. Click **添加语言** → language dropdown.
3. Pick a language → a card/sheet opens → choose **手动字幕 → 添加**.
4. On the next card, choose **自动翻译** (requires a usable source track on 视频语言).
5. **发布** becomes enabled (highlighted) → publish.

UI notes from screenshots: 视频语言 (e.g. `中文（繁体）`) is the auto-translate source; **自动翻译** stays disabled without source captions; publish is on the **language editor** chrome, not a single list-row control.

**Automation gap:** current `youtube.subtitle.multilang` still assumes list-page add + list-page publish + Human Gate. It does **not** yet drive steps 3–5 (手动字幕 → 自动翻译 → 编辑器 发布). Live COMPLETED with `EXISTS` / `published=false` only proves list-level add/skip, not WRITE_COMMIT of translated tracks.

Code updates from this evidence: `page.subtitles.title`, label maps (`日语`/`法语`), add/picker option hosts. Full translate+publish path remains **待真机 / 待校准**.

Automated validation for this change: client unit tests + Vite build.
