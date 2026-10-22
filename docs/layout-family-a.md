# 布局家族 A — 完整 DOM 记录（2026-10-21 真机采集）

采集方式：Windows Chrome 155 调试实例（CDP 只读探针），zh-Hans Studio，频道
`UC7Vbu_0GiC7r9Ubek7Ke3fA`，视频样本 `VXqaJePprRg`（Kancolle 2015）、`SEhxFpixAkg`
（Default title）。本文件是 operator「Layout A 证据包」（docs/studio-dom-calibration.md）
的**结构化补全**，供家族 A 适配实现与回归测试对照。所有结构均在 light DOM
（shadow host 数 = 0）。

## 0. 全局壳层与页面身份（最重要的新标定）

### 0.1 保留页机制（影响一切选择器的唯一性/可见性判定）

- `ytcp-app` + `ytcp-navigation-drawer`（`tp-yt-app-drawer` 不存在）。
- Studio 预创建 **107–108 个 `ytcp-animatable.page`** 壳（2026-10-22 实测计数：
  频道分析页 108、视频编辑页 107），任意时刻**仅一个**带 `.selected`。实测名称
  集合（节选）：
  `channel`、`channel.ask_studio`、`channel.content`、`channel.activity`、
  `channel.editing`、`channel.analytics`(+hub_*)、`channel.translations`、
  `video.comments`、`video.edit`、`video.live_settings`、`video.editor`、
  `video.translations`、`video.analytics`(+hub_*)、`video.claims`、`video.clips`、
  `playlist.*`、`owner.*`、`artist.*`、`song.*`…
- **未激活壳的隐藏形态（2026-10-22 实测）**：`class="page "`（无 `.selected`）+
  **行内 `style="display:none;"`**，`hidden` / `aria-hidden` 属性**不存在**；且
  壳内内容可以**已完全加载**（实测 translations 壳在 display:none 状态下已含
  列表表格与全部行）。判别只能靠 `ytcp-animatable.page:not(.selected)` 祖先规则
  （`isActiveElement` / `isLoadedContent` / `isInRetainedPage` 已做），不能依赖
  hidden 属性，也不能用"内容存在"推断页面已激活。
- **推论**：所有候选元素必须过滤 `ytcp-animatable.page:not(.selected)` 祖先
  （`isActiveElement` 已做）；`unique: true` 目标在保留页含同名节点时会歧义，
  过滤是前提。
- **文本/aria-label 唯一性不可假设（2026-10-22 实测）**：页面标题「视频字幕」的
  整文本匹配命中 **6 个元素** —— `ytcp-a11y-announcer` 宿主 +
  `div.only-visible-for-accessibility[aria-live=polite]` 镜像 + 标题链 4 层嵌套
  （`#page-header > div.wrapper > div.primary > h1.page-title`）。`unique` 身份
  解析必须 (a) 折叠嵌套候选链（取最内层）、(b) 排除 live-region 镜像
  （`[aria-live]` / `role=status|log|alert` 内部，或整内容即镜像的宿主）——
  `dom-service` 已实现（review R3 细化，回归测试覆盖）。
- **后台窗口陷阱（2026-10-22 实测）**：`document.hidden === true`（窗口最小化/
  被完全遮挡）时 Studio 的视图激活（rAF 驱动）**完全停滞**：URL 前进、壳保持
  `display:none` 不翻转（"URL advances, view stays"），定时器同步被限流
  （1s sleep 实测变 2s+）。`Page.bringToFront` 后滞留的激活**瞬间完成**。现行
  代码：`navigate()` 在 hidden 时**点击前**快速失败（`WINDOW_HIDDEN` + 前台提示），
  `waitReady` 超时信息同样带该提示。

### 0.2 页面身份：`ytcp-animatable.page.selected` 的 `name` 属性（确定性信号）

| URL（pathname） | `.selected` name | 备注 |
| --- | --- | --- |
| `/channel/{cid}` | `channel` | 信息中心（Dashboard） |
| `/channel/{cid}/content` | `channel.content` | 内容 Hub（家族 A） |
| `/channel/{cid}/analytics/tab-overview/…` | `channel.analytics` | 数据分析 |
| `/channel/{cid}/translations` | `channel.translations` | 频道字幕（视频列表） |
| `/video/{vid}/edit` | `video.edit` | 视频详细信息 |
| `/video/{vid}/translations` | `video.translations` | 视频字幕（语言表） |

h1 文本佐证：「频道信息中心」（`h1.page-title[theme="DASHBOARD"]`）、「内容」、
「频道分析」、「频道字幕」、「视频详细信息」（`h1.page-title` theme=DEFAULT）、
「视频字幕」。**注意（2026-10-22）**：「视频字幕」的整文本匹配不唯一（6 命中，
见 §0.1），h1 只能作为嵌套链最内层的折叠结果参与 `unique` 判定；壳
`name` 属性才是确定性身份。

**修复指引**：`pageReadyTarget` / `detectPageFromDom` 优先用
`ytcp-animatable.page.selected[name="…"]`，比 aria-current / 文本更稳；
`page.video_details.title`（现依赖不存在的 aria-label/data-page）应改为
`video.edit` 选中页信号。

### 0.3 侧栏导航（`ytcp-navigation-drawer a`）

href 均为**相对路径**；仅一个 `a[aria-current='page']`（当前页）：

| 文本 | href |
| --- | --- |
| （频道出站链接） | `https://www.youtube.com/channel/{cid}/`（绝对，非导航项） |
| 信息中心 | `/channel/{cid}` |
| 内容 | `/channel/{cid}/content` |
| 数据分析 | `/channel/{cid}/analytics/tab-overview/period-default` |
| 社区 | `/channel/{cid}/comments/inbox` |
| 字幕 | `/channel/{cid}/translations` |
| 内容检测 | `/channel/{cid}/copyright` |
| 创收 | `/channel/{cid}/monetization/overview` |
| 自定义 | `/channel/{cid}/editing/profile` |
| 音频库 | `/channel/{cid}/music` |

注意：`nav.dashboard` 的精确匹配 `a[href="/channel/{cid}"]` 能命中「信息中心」，
但**从视频页无 channelId 时必须从本表锚点推导**
（`ytcp-navigation-drawer a[href^="/channel/"]` 取 pathname 首段），不能用占位符。

**视频上下文抽屉（2026-10-22 实测，`/video/{vid}/edit` 页）**：href 前缀全部为
`/video/{vid}/`，含「字幕」→ **`a[href="/video/{vid}/translations"]`**（与
`subtitlesNavTarget` 精确锚点一致，唯一）。同组还有
`/video/{vid}/edit`、`/video/{vid}/analytics/tab-overview/period-default`、
`/video/{vid}/editor`、`/video/{vid}/comments/inbox`、`/video/{vid}/claims`、
`/video/{vid}/clips`。频道分析页（视频上下文）的抽屉只暴露**频道级**
`/channel/{cid}/translations`；视频页才暴露视频级翻译锚点。

## 1. 内容 Hub（`/channel/{cid}/content`，家族 A 的“视频列表”）

**不存在**经典表格结构：无 `ytcp-video-section-content#video-list`、无 `ytcp-video-row`、
无 `a#video-title`、无 `.tablecell-*`、无 `ytcp-table-footer`、无排序表头、无分页。

结构（2026-10-21 晚修正：shelf header 与 items 是**兄弟节点**）：

```
ytcp-animatable.page.selected[name="channel.content"]
└ ytcp-section-list-renderer[data-target-id="browse-feedFEcontent_hub"]
  └ horizontal-shelf-view-model.ytwHorizontalShelfViewModelHost × 3
    ├ div.ytwHorizontalShelfViewModelHeader
    │  └ yt-section-header-view-model → yt-shelf-header-layout
    │     └ h2.ytShelfHeaderLayoutTitle = 「视频」/「短视频」/「播放列表」（精确标题）
    │       （"查看全部" 在 trailing-actions 按钮里，非标题文本）
    └ div.ytwHorizontalShelfViewModelOuterContainer
      └ div.ytwHorizontalShelfViewModelHorizontalContainer
        └ div.ytwHorizontalShelfViewModelItems
          └ yt-suspense-view-model → yt-lockup-view-model（视频卡片）
```

**解析规则要点**：shelf 归属必须以 `horizontal-shelf-view-model`（或 OuterContainer
+ 其父级 header）为范围；只取标题为「视频」的 shelf；`content-id-PL…` 播放列表卡
排除；短视频 shelf（标题「短视频」）排除。早期实现只在 items 容器内找 header
（兄弟结构下找不到）→ 所有 shelf 放行，短视频卡片被误收（真机回归发现）。

### 1.1 视频卡片（lockup）解剖

```
yt-lockup-view-model
└ div.ytLockupViewModelHost.content-id-<ID>            ← 稳定锚点：视频/播放列表 ID
  │   （视频=11 位 ID；播放列表=PL…；shelf 内另有 ytLockupViewModelCollectionStack2 类）
  ├ a.ytLockupViewModelContentImage[href="/video/<ID>/edit"]   （缩略图；aria-hidden）
  │   └ yt-thumbnail-badge-view-model → .ytBadgeShapeText = 时长 "1:31"
  └ h3.ytLockupMetadataViewModelHeadingReset
    └ a.ytLockupMetadataViewModelTitle[href] → span = 标题文本
  └ div.ytLockupMetadataViewModelMetadata
    └ yt-content-metadata-view-model
      └ div.ytContentMetadataViewModelMetadataRow[role=group] × N
         · 第 1 行：纯文本 = 日期（「2026年9月7日」）
         · 后续行：span.ytIconWrapperHost.ytContentMetadataViewModelLeadingIcon
           （图标行；可能带 aria-label，如「不公开列出」）+ 数字 span
```

实测样本：
- 视频卡：`1:31 | Kancolle 2015 | 2026年9月7日 | 16 | 0`（时长/标题/日期/观看/评论）
  —— 指标行内两个 span「16」「0」**紧邻无分隔**，需按 span 粒度或图标拆分，
  不可按行文本整体解析。
- 短视频卡：`Default title • 2026年4月9日 0 0`（行文本含「•」分隔）。
- 播放列表卡：`1 个视频 TEST 0 • 播放列表`（`content-id-PL…`，非视频，采集须排除）。
- 「查看全部」是 `button-view-model`（**无 href**，SPA 内部跳转）→ 不能用 URL 导航到
  全量列表；家族 A 采集范围 = 当前渲染的 shelf 卡片（与现行
  “current rendered rows” 语义一致）。

### 1.2 采集解析规则（家族 A）

- 行锚点：`yt-lockup-view-model` 限定在 `browse-feedFEcontent_hub` 下；
  ID 从 host class `content-id-<ID>` 或 `a[href^="/video/"]` pathname 提取。
- 排除：`content-id-PL…`（播放列表）及短视频 shelf（若数据集不含 Shorts）。
- videoId 提取必须走 URL 解析（`/video/<ID>/edit` 相对 href）。
- 指标文本可能含 CJK 缩写（万/亿）——本频道量级小未出现，仍需解析层支持。
- 无分页/排序表头 → 不得报 VIDEO_ORDER_UNKNOWN/VIDEO_SCOPE_PARTIAL（无对象）；
  以 shelf 卡片完整性判定（卡片存在 + ID/标题可读）。

## 2. 频道字幕页（`/channel/{cid}/translations`）—— 是**视频列表**，不是语言表

表头：`视频 | 语言数量 | 修改日期`；行结构（经典 tablecell 类）：

```
tbody tr
└ td.tablecell-video.floating-column   （时长 + 标题 + 原始语言，如「1:31 Kancolle 2015 Default」）
  └ a[href="/video/<vid>/translations"] × 2   （缩略图 + 标题）
└ td.tablecell-languages.cell-body     （语言数，如 5）
└ td.tablecell-modified.cell-body      （修改日期，如 2026年9月9日）
```

页脚分页文案（精确格式）：**`第 1 - 2 条，共 2 条`**（数字与连字符间有空格；
现 collector 正则 `^第\s*([\d,]+)\s*-\s*([\d,]+)\s*条，共\s*([\d,]+)\s*条$` 可匹配，
但**不匹配** en dash/英文「1–1 of 1」格式）。

无 `ytgn-video-translations-list`（那是视频级的）。此页也不含 `#ytgn-video-translations-list-table`。

## 3. 视频字幕页（`/video/<vid>/translations`，语言表）—— 与既有证据包吻合

**完整容器链（2026-10-22 实测）**：
`ytcp-animatable.page.selected[name="video.translations"]` →
`ytgn-video-translations-section` → `div.translations-list` →
`ytgn-video-translations-list[show-header]` →
`table#ytgn-video-translations-list-table[aria-label="翻译"]` →
`tbody` → `ytgn-video-translation-row[unified]`。

- 页头链（勿作 unique 直取）：`ytcp-entity-page-header#page-header` >
  `div.wrapper` > `div.primary` > `h1.page-title`「视频字幕」——4 层嵌套共享同一
  整文本；另有 `ytcp-a11y-announcer` 镜像（见 §0.1），整文本匹配共 6 命中。
- 列表：`ytgn-video-translations-list`（本家族 `ui-mode` 为空）→
  `table#ytgn-video-translations-list-table`（`aria-label="翻译"`，全页唯一）。
- **挂载时序（2026-10-22 实测）**：导航点击后 **~2.1s** 表格与行才一并挂载
  （152ms 采样点尚未出现）——**晚于 page-ready 证据**。任何列表读取必须容忍
  激活后容器迟到（`waitForLanguageListSettled` 已有界等待 MISSING 容器，
  预算 5s；此前立即判 UI mismatch 是真机失败根因之一）。
- 行：`ytgn-video-translation-row` → 内部 `tr#row-container`（5 行样本）。
  **thead 无表头行**（表头「标题和说明」等在表体外的独立 header 区，
  2026-10-22 复测表头区文本为「语言 字幕 标题和说明」）；
  行收集只走 `ytgn-video-translation-row`，不受表头影响。
  行文本实测样本：`中文（简体） 已发布2026年10月21日 –`、
  `日语 – 已发布2026年9月8日`、`英语 （视频语言） 已发布2026年9月8日 已发布`。
- 语言单元：`.language-text` / `.tablecell-language`（同文本）；无
  `button.language-display-name`（那是家族 B）。真实文本含括注：
  **`英语 （视频语言）`**（空格 + 全角括号）→ 状态括注可剥；
  **简体/繁体/地区括注是语言身份**（`中文（简体）`→zh-Hans、
  `葡萄牙语（巴西）`→pt-BR、`英语（美国）`→en-US），**不可剥**（review R2，
  见 `schema.ts` 的 `resolveLanguageCodeFromLabel` / `languageCodeMatches`）。
- captions 单元：`ytgn-video-translation-cell-captions`（**在 tr 内**）→
  内部 `ytgn-video-translation-hover-cell` × 2、`#status-info`（captions 状态）。
- metadata 单元：`ytgn-video-translation-cell-metadata` → 自己的 `#status-info`
  （如「已发布2026年9月8日」/「–」）。captions 与 metadata 各一，勿混读。
- 状态实测：captions `已发布` / `–`；metadata `已发布…` / `–`。
  「已发布」判定现有 `isPublishedStatus` 可正确处理。
- 添加语言：`button[aria-label="添加语言"]`（class `ytcpButtonShapeImplHost…`）。
- 手动字幕行（`tr.manual-subtitles-row`/`#language-details-text-button-subtitles`）
  本家族**不存在**（家族 B 专属）。
- `ytgn-video-languages-section` 本家族不存在。

### 3.1 hover 盖章（实测有效）

对 hover-cell 派发合成 pointer/mouse 事件 + 置 `hovered` 属性/类/属性值后：

- 已发布行戳出：`ytcp-icon-button#captions-edit`（**aria-label「修改」**，非「编辑」）、
  `#captions-delete`（「删除」）、`#captions-more-options`（「选项」）。
- Polymer 另置 `is-hovered` 属性（现有清理逻辑未移除，需补）。
- `#captions-add`（aria-label「添加」）只在无字幕行出现（本次样本无此类行，
  沿用 2026-09-08 证据包：`ytcp-icon-button#captions-add.hover-button`）。
- **修复指引**：`CAPTIONS_EDIT_SELECTOR` 的 `[aria-label*="编辑"]` 分支永不命中，
  实际靠 `ytcp-icon-button[id*="edit"]` 命中；应显式支持「修改」文案与
  `#captions-edit` id。

## 4. 语言选择器（picker，添加语言点击后）

- 容器：`tp-yt-paper-dialog` → `ytcp-text-menu` → `tp-yt-paper-listbox`。
- 选项：`tp-yt-paper-item[role="option"]` × **238**，**全量在 DOM（未虚拟化）**。
- 身份标记：**`test-id` 属性 = BCP-47 码**（`ab`、`sq`、`ar`、`fa-AF`、`zh`、
  `zh-Hans`、`zh-Hant`、`zh-CN`、`zh-TW`、`zh-HK`、`zh-SG`…）；无
  `data-language-code`。文本为中文名（「阿布哈西亚语」…「日语」「德语」）。
- 已添加语言：`aria-disabled="true"` + `disabled` 属性 + `pointer-events:none`。
- **无搜索输入框**（`filterPickerForLanguage` 无对象）；因全量渲染，
  `test-id` 精确匹配可即时命中，无需滚动。
- 中文歧义点：`zh` 系列有 7 个选项（中文/中文（简体）/中文（繁体）/…），匹配必须用
  `test-id` 精确或全名精确，禁止前缀匹配「中文」。

## 5. Dashboard（`/channel/{cid}`）采集面

- `h1.page-title[theme="DASHBOARD"]`（「频道信息中心」）✅。
- `ytcd-channel-facts-item`：`.section-title-text`「摘要」+ `.section-subtitle-text`
  「过去 28 天」；「热门内容 / 过去 48 小时」为另一区块（period 选择须按「摘要」限定）。
- 指标：`#metrics-table` → `.metric-row` → `.metric-title`（「观看次数」/「观看时长（小时）」）
  + `#metric-0-value`/`#metric-1-value`；趋势 `#metric-0-trend` 文本为
  **「— 无法比较」**，`.subscribers-trend` 存在但为空。
- **频道名：`ytcp-navigation-drawer #entity-name` 是空节点**（仅含 display:none 的
  `ytcp-tooltip`）——`channel.name` 在家族 A 上无法从此节点读取；
  `#entity-type` = 「我的频道」。需另找频道名来源（如文档标题/账号卡）或标定
  tooltip 结构后再读，读不到时保持 fail-closed（CHANNEL_NAME_MISSING）。

## 6. Analytics（`/channel/{cid}/analytics/tab-overview/period-default`）

- `yta-time-picker #picker-trigger`：`.label-text` = **`2026/9/23 – 2026/10/20`**
  （en dash，注意日期解析）；`.dropdown-trigger-text` = 「过去 28 天」✅。
- `#key-metric-blocks`：
  `#EXTERNAL_VIEWS-tab #metric-total`（「1」）、
  `#EXTERNAL_WATCH_TIME-tab #metric-total`（「0.0」）、
  `#SUBSCRIBERS_NET_CHANGE-tab #metric-total`（**「—」** em dash 占位符）。
  → 占位符语义修复的直接依据：`—` = “该维度无值”，不是解析失败。

## 7. 视频详细信息（`/video/<vid>/edit`）

- `.selected` name = `video.edit`；h1「视频详细信息」；
  **无** `main[data-page]`、无 `aria-label="Video details"` —— 现
  `page.video_details.title` 目标在真机永不匹配（waitReady 必超时），须按
  §0.2 的 selected-name 信号重写。

## 8. 对现有代码的直接映射（修复清单引用）

| 现有目标/逻辑 | 家族 A 现实 | 处置 |
| --- | --- | --- |
| `content.videos.list` = `ytcp-video-section-content#video-list` | 不存在 | 新增家族 A 列表锚点（hub feed）+ 家族识别 |
| `CONTENT_VIDEO_ROW_SELECTOR`（ytcp-video-row） | 不存在 | 新增 lockup 卡片解析器 |
| `CONTENT_FIELDS.*`（.tablecell-*） | Hub 无表格 | 家族 A 走卡片字段；频道字幕页另有 tablecell |
| `channel.name` = `#entity-name` 文本 | 空节点 | 另寻来源 / 保持 fail-closed |
| `dashboard.*`/`analytics.*` 目标 | 基本吻合 | 保留；占位符语义另修 |
| `page.video_details.title` | 永不匹配 | 改 selected-name 信号 |
| `detectPageFromDom`（aria-current） | 可用但脆弱 | 增加 selected-name 优先 |
| 分页正则 `第 X-Y 条，共 Z 条` | 「第 1 - 2 条，共 2 条」（有空格） | 兼容空格/en dash/英文格式 |
| picker `test-id` | 与 lang.code 精确一致 | 保留；禁前缀匹配 |
| hover `#captions-add`/edit 控件 | 「修改」文案、`#captions-edit` | 补 id/文案匹配 |
| shadow DOM deep 查询 | Studio 无 shadow | 降级为预防项 |


## 9. 编辑器对话框（写入路径，2026-10-21 真机标定）

选中语言行进入编辑器后，整体宿主是 **`tp-yt-paper-dialog#dialog`**：

```
tp-yt-paper-dialog#dialog
├ ytve-captions-editor-options-panel     ← 「修改时间/字幕/以文本形式修改」+ 自动翻译入口
│  └ div.scrollable-options#editing-container
│    └ tp-yt-iron-list#items             ← 虚拟列表：离屏 cue 项被隐藏（visibility/display）
│      └ div → div.ytve-captions-editor-caption-segment-line
│        ├ div.original-text             ← 原文参考
│        ├ div.segment-text              ← 标签「副标题」+ 正文 + 提示「按 Enter」
│        └ ytve-lightweight-textarea
│          └ pre                         ← **纯字幕正文（READY 的正确证据）**
└ section#secondary-header
  └ div#save-container
    └ ytcp-button#publish-button > button[aria-label="发布"]   ← **发布控件在面板之外**
```

要点：
- **READY 证据** = `ytve-lightweight-textarea pre` 的正文（内容存在即就绪）；虚拟列表的
  隐藏不代表未就绪（用 `isLoadedContent`，不要用 `isActiveElement`）。
- **发布按钮不在 options panel 内**——操作范围必须取含 `#publish-button` 的宿主
  （否则 waitFor(publish) 永远超时）。
- 编辑器无 `data-language-code`、chrome 文本不含语言名 → 语言绑定为 unknown；
  单一活动编辑器可用，mismatch 仍拒绝。
- 自动翻译完成前「发布」可能已启用（空白字幕竞态）——必须等 cue 正文出现。
- `#choose-auto-translate`（「自动翻译」）在翻译完成后消失。
- 语言行未保存草稿在刷新后消失；发布后变为「已发布 <日期>」（metadata 列可为「–」）。
