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

Automated validation for this change: 89 tests, TypeScript noEmit, Vite build.
