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

### Studio layout families (A / B / C)

A/B/C are **YouTube Studio UI layout families** (different shell + content + subtitle
logic across accounts), not merely add-language micro-paths. Collect one sanitized
evidence pack per family before claiming RC coverage.

### Layout A — evidence pack (operator, 2026-09-08 / 09)

#### Content (`/channel/<CHANNEL_ID>/content`)

| Signal | Observed |
| --- | --- |
| URL | `https://studio.youtube.com/channel/<CHANNEL_ID>/content` |
| Shell | `ytcp-animatable[name="channel.content"].page.selected` → `ytcp-browse-page` |
| Header | `h1`「内容」; chips 视频 / 短视频 / 播放列表 |
| Feed | `ytcp-section-list-renderer[data-target-id="browse-feedFEcontent_hub"]` |
| Video card | `yt-lockup-view-model` / `.content-id-<VIDEO_ID>`; link `/video/<VIDEO_ID>/edit` |
| Metrics | Icon + number (views/comments) + date text; **not** classic `ytcp-video-row` table |

**RC note:** Layout A Content is Content Hub / lockup cards. Channel collect must
detect this family and either adapt selectors or fail-closed as unsupported.

#### Subtitles (`/video/<VIDEO_ID>/translations`)

| Signal | Observed |
| --- | --- |
| URL | stays on `/translations` through auto-translate / publish |
| List host | `ytgn-video-translations-list` → table |
| Row | `ytgn-video-translation-row` → `tr#row-container`; language in `.language-text` |
| Captions cell | `ytgn-video-translation-cell-captions` / hover-cell; idle status `–` |
| Captions add (hover) | `ytcp-icon-button#captions-add.hover-button[aria-label="添加"]` |
| Metadata cell | status e.g. `已发布` + date |
| Add language | `button[aria-label="添加语言"]` |
| Picker option | `tp-yt-paper-item[role=option][test-id="<bcp>"]` + Chinese `yt-formatted-string` |
| Already-added | `disabled="" aria-disabled="true"` + `pointer-events: none` (e.g. `test-id="ja"` 日语) |
| Auto-translate | `#choose-auto-translate` in `ytve-captions-editor-options-panel` |
| Publish disabled | `button[aria-label="发布"][aria-disabled="true"][disabled]` class `…--disabled` |
| Publish enabled | `button[aria-label="发布"][aria-disabled="false"]` after 自动翻译 |

#### Layout A subtitle WRITE flow (operator-confirmed)

1. **添加语言** → open picker
2. Choose language (`test-id` preferred; skip `aria-disabled=true`) → **list gains a row**
3. On that row’s **字幕** hover-cell, reveal/click **添加** (hover-only; idle cell shows `–`)
   - Control: `ytcp-icon-button#captions-add.hover-button[aria-label="添加"][role="button"]`
     inside `ytgn-video-translation-hover-cell` (appears on hover; may be absent in idle DOM)
4. Choose **自动翻译** (`#choose-auto-translate`) — URL still `/translations`
5. Wait until **发布** enabled, settle briefly for cues (≤~2.5s; blank-publish
   retries once) → click **发布**
   (live: 发布 may enable before translation finishes → 「无法发布空白字幕」)

Layout A subtitle pack is **complete** for selector design (content hub + list + picker
`test-id` + hover `#captions-add` + auto-translate + publish disabled/enabled).

#### Naming note

Prefer operator **layout family A/B/C**. Do not confuse with older code comments that
labelled Content URL `/videos/upload` as “A” and `/content` as “B” — that mapping is
**inverted** relative to this evidence pack (operator A = Content Hub `/content`;
operator B = classic `/videos/upload` table).

**Automation note (A):** hover `#captions-add` is stamped into DOM on cell
hover (`ps-dom-if`); synthetic pointer/mouseenter + ignoreVisibility click are
required because CSS `:hover` is not applied by dispatched events.

### Layout B — DOM inventory (operator pack, flow TBD)

Sanitized from `类型B.md`. Raw desktop file may contain real channel/video ids —
do not commit it; use placeholders here.

#### Content

| Signal | Observed |
| --- | --- |
| URL | `/channel/<CHANNEL_ID>/videos/upload?filter=…&sort={columnType:date,sortOrder:DESCENDING}` |
| List host | `ytcp-video-section-content` → `[role=table][aria-label="视频列表"].video-table-content` |
| Row | `ytcp-video-row[role=row]` → `#row-container` |
| Title | `a#video-title` → `/video/<VIDEO_ID>/edit` |
| Thumbnail | `a#thumbnail-anchor` → same edit href |
| Details control | `ytcp-icon-button#video-details[aria-label="详细信息"]` (also under `#hover-items` / `#anchor-video-details`) |
| Other cells | visibility, date (e.g. 首播结束日期), views, comments link |

Matches the **classic** collector surface (already calibrated for `ytcp-video-row`),
unlike Layout A Content Hub lockups.

#### Languages / translations surface

| Signal | Observed |
| --- | --- |
| URL (as provided) | `/channel/<CHANNEL_ID>/translations` (**channel-scoped**, not `/video/…/translations`) |
| Section | `ytgn-video-languages-section` summary e.g. `1 种翻译版本` |
| List | `ytgn-video-translations-list[ui-mode="aloud_m2"]` inside `[aria-label="可滚动的翻译"]` |
| Columns | 语言 / **音频** / 字幕 (audio column present — differs from Layout A captions+metadata) |
| Row | `ytgn-video-translation-row[show-new-ui]` → `tr#row-container` |
| Language open | `button.language-display-name` > span text e.g. `日语` (clickable name, not plain `.language-text` only) |
| Add language | `button[aria-label="添加语言"]` **tonal** (Layout A was filled) |
| Picker | same family: `tp-yt-paper-item[role=option][test-id="<bcp>"]` + Chinese label |
| Manual captions row | `tr.manual-subtitles-row.language-dialog-row`「手动字幕」 |
| Manual add | `#language-details-text-button-subtitles` → `button[aria-label="添加"]` (tooltip「添加字幕」) |
| Auto-translate | `#choose-auto-translate`「自动翻译」 |
| Publish | `button[aria-label="发布"][aria-disabled="false"]` (enabled sample in pack) |

#### Layout B vs A (DOM deltas)

| Area | Layout A | Layout B |
| --- | --- | --- |
| Content URL | `/channel/…/content` hub | `/channel/…/videos/upload` table |
| Content row | `yt-lockup-view-model` | `ytcp-video-row` |
| Translations URL | `/video/…/translations` | pack shows `/channel/…/translations` |
| List ui-mode | (default / not aloud_m2 in A pack) | `ui-mode="aloud_m2"` + 音频 column |
| Enter captions | hover `#captions-add` | dialog **手动字幕** → `#language-details-text-button-subtitles` |
| Add language style | filled | tonal |

#### Layout B WRITE flow (operator-confirmed)

1. **频道内容** — `/channel/…/videos/upload` classic table  
2. Open target video via **详细信息** (`#video-details` / title → `/video/…/edit`)  
3. Go to **字幕** (video translations surface)  
4. Click **添加语言**  
5. Pick one language from the picker (`test-id` / Chinese label)  
6. **Immediately** a card/dialog opens (not a pending row on the multilang list)  
7. On the card: **手动字幕** → **添加** (`#language-details-text-button-subtitles`)  
8. **自动翻译** (`#choose-auto-translate`)  
9. **发布** (`aria-label="发布"`) when enabled → Human Gate  

**Hard constraint (RC):** After picking a language in the picker, Studio opens the
language card **directly**. There is **no** “add many languages to the list first,
then edit each.” Automation **must** finish one language’s card path
(手动字幕 → 自动翻译 → 发布) before starting the next **添加语言** cycle.
Batch-select / multi-pending-row strategies are invalid on Layout B.

**Contrast with Layout A:** A appends a list row then uses hover `#captions-add`;
B opens `ytgn-language-dialog-row` / 手动字幕 card per selection.

### Layout C

待 operator 证据包。
