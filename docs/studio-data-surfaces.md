# Studio 数据面侦察 — 数据分析 / 内容 / 社区（2026-10-22 真机 CDP 采集）

采集环境：调试 Chrome（CDP 9222）· 频道 `UC7Vbu_0GiC7r9Ubek7Ke3fA` · 视频
`VXqaJePprRg`（2026-09-07 发布）· 界面 zh-Hans · Chrome 155。

**方法注意事项**：窗口最小化/后台时 Studio 的 SPA 切换会被限流（视图不激活、
数据不刷新，见 `layout-family-a.md` §0.1），但**URL 全页加载 + 同步 DOM 读取
不受影响**——本文所有"URL 直达"配方在后台也可用；点选式 SPA 切换需前台。

---

## 1. 频道数据分析页 `/channel/{cid}/analytics/tab-overview/period-…`

- 页面壳：`ytcp-animatable.page.selected[name="channel.analytics"]`；`h1`「频道分析」。
- **指标卡**（同一骨架，逐卡一个指标）：

  ```
  #key-metric-blocks > tp-yt-paper-item#<METRIC>-tab
      └─ #metric-total          ← 数值（如 "1"、"0.0"、"—"）
      └─ 环比文案               （「比过去 28 天少 98%」等）
      └─ 指标解释 tooltip 文案
  ```

  | 卡 id | 显示名 | 说明 |
  | --- | --- | --- |
  | `EXTERNAL_VIEWS-tab` | 观看次数 | 所选范围总观看次数 |
  | `EXTERNAL_WATCH_TIME-tab` | 观看时长（小时） | 含环比 |
  | `SUBSCRIBERS_NET_CHANGE-tab` | 订阅人数 | 无数据时为「—」 |

  同页另有图形区 `div.metric-value`（折线/柱值）与 `yta-latest-activity-card`
  「实时更新」小卡。

- **周期选择器**：`yta-time-picker #picker-trigger`；`.label-text` = 日期区间
  （`2026/9/23 – 2026/10/20`）、`.dropdown-trigger-text` = 周期名（「过去 28 天」）。
  下拉项为 `tp-yt-paper-item[test-id=…]`（id 形如 `text-item-N`）：

  | 显示 | test-id | | 显示 | test-id |
  | --- | --- | --- | --- | --- |
  | 过去 7 天 | `week` | | 从始至终 | `lifetime` |
  | 过去 28 天 | `4_weeks` | | 2026年 | `current_year` |
  | 过去 90 天 | `quarter` | | 2025年 | `minus_1_year` |
  | 过去 365 天 | `year` | | 十月/九月/八月 | `current_month`/`minus_1_month`/`minus_2_month` |
  | 自定义 | `fixed` | | | |

- **URL 周期令牌直达（推荐采集方式）**：
  `/channel/{cid}/analytics/tab-overview/period-{week|4_weeks|quarter|year|lifetime|…}`
  —— 令牌与 test-id 一致，全页加载即渲染对应周期的全部卡片，无需点选。

- **高级模式（explore）URL 协议**（数据可编程复用的强证据）：

  ```
  /…/analytics/tab-overview/period-…/explore?entity_type=CHANNEL&entity_id={cid}
    &time_period=4_weeks&explore_type=TABLE_AND_CHART|SUBSCRIBERS|LATEST_ACTIVITY
    &metric=EXTERNAL_VIEWS&granularity=DAY&dimension=VIDEO
    &t_metrics=EXTERNAL_VIEWS&t_metrics=EXTERNAL_WATCH_TIME&…
  ```

  指标词汇表（实测出现）：`EXTERNAL_VIEWS`、`EXTERNAL_WATCH_TIME`、
  `SUBSCRIBERS_NET_CHANGE`、`TOTAL_ESTIMATED_EARNINGS`、
  `VIDEO_THUMBNAIL_IMPRESSIONS`、`VIDEO_THUMBNAIL_IMPRESSIONS_VTR`、
  `AVERAGE_WATCH_TIME`、`AVERAGE_WATCH_PERCENTAGE`、`HYPES`。
  页面上的「查看实时计数」「查看视频分析数据」即此类链接
  （后者直接指向 `/video/{vid}/analytics/tab-overview/period-default`）。

## 2. 单视频分析页 `/video/{vid}/analytics/tab-overview/period-…` ⭐

- 页面壳：`name="video.analytics"`；`h1`「视频分析」。
- 指标卡与频道页**同构**（`#EXTERNAL_VIEWS-tab` / `#EXTERNAL_WATCH_TIME-tab` /
  `SUBSCRIBERS_NET_CHANGE-tab` → `#metric-total`），默认周期为
  「自发布以来」（`.label-text` = `2026年9月7日 — 现在`）。
- 子页签（页面内 SPA 页签）：**概览 / 覆盖面 / 互动 / 观众**；另有「高级模式」
  explore 链接（`entity_type=VIDEO&entity_id={vid}`）。

### 2.1 实时卡（单条视频实时播放量的唯一出处）

右侧 `yta-section#right-side-bar` 内的 **`yta-latest-activity-card`**：

| 部件 | 选择器 | 实测值 |
| --- | --- | --- |
| 标题 | `h2#title` | 「实时」 |
| 副标题 | `span.card-subtitle` | 「实时更新」 |
| **数值** | **`div.metric-value`** | `"0"`（所选窗口观看次数） |
| 窗口切换 | `span.dropdown-trigger-text` | 「观看次数 · 过去 48 小时」 |
| 图轴 | `tspan` | 「48 小时前」「现在」 |
| 无障碍描述 | `span`（同卡内） | 「最新活动, 观看次数: 过去 48 小时, 0.」 |

窗口切换下拉（点击 `dropdown-trigger-text` 后）：

| 显示 | test-id |
| --- | --- |
| 过去 48 小时 | `48_hours` |
| **过去 60 分钟** | **`60_minutes`** |

官方口径（卡内文案）：「柱形代表每分钟或每小时的观看次数。**观看计数在首次
报告时是一个估算值**，可能会随着数据的日益精确而调整。」

**配方：单条视频实时播放量**

1. 打开 `/video/{vid}/analytics/tab-overview/period-default`（任意周期均可）；
2. 48 小时口径：读 `yta-latest-activity-card .metric-value`（窗口默认即 48 小时，
   用 `span.dropdown-trigger-text` 校验）；
3. 60 分钟口径：点 `dropdown-trigger-text` → 点 `[test-id="60_minutes"]` →
   再读 `.metric-value`（实测切换生效，触发文本变「观看次数 · 过去 60 分钟」）。

### 2.2 近 28 天 / 近 7 天的播放量与播放时长

**配方（URL 直达，后台也可靠）**：

| 数据 | 读取锚点 | 近 28 天 | 近 7 天 |
| --- | --- | --- | --- |
| 播放量 | `#EXTERNAL_VIEWS-tab #metric-total` | `…/period-4_weeks` | `…/period-week` |
| 播放时长（小时） | `#EXTERNAL_WATCH_TIME-tab #metric-total` | 同上 | 同上 |
| 日期区间校验 | `yta-time-picker .label-text` | `2026/9/23 – 2026/10/20` | `2026/10/14 – 2026/10/20` |
| 周期名校验 | `yta-time-picker .dropdown-trigger-text` | 「过去 28 天」 | 「过去 7 天」 |

实测（该测试视频）：`period-4_weeks` → 观看次数 `1`、时长 `0.0`；
`period-week` → 两者均 `—`（该周无数据，占位符语义同 collector 的 ABSENT 规则）。

**注意**：SPA 内点选周期（picker 菜单）在后台限流下只翻新触发文本、
不刷数据；自动化请用 **URL 令牌直达** 或保持窗口前台。

### 2.3 「最近 48 小时–60 分钟的播放」

即 §2.1 的实时卡两个窗口（`48_hours` / `60_minutes`）；卡内柱图给出
48 小时逐小时 / 60 分钟逐分钟的分布（`tspan` 轴标签 + 无障碍数据描述），汇总值
读 `.metric-value`。

## 3. 内容页 `/channel/{cid}/content`

- 页面壳：`name="channel.content"`；本频道实测为 **家族 A Hub**
  （`ytcp-section-list-renderer[data-target-id="browse-feedFEcontent_hub"]`，
  无经典表格）。
- 视频卡片 `yt-lockup-view-model`：标题（`a.ytLockupMetadataViewModelTitle`）+
  日期 + **累计播放量文本**（实测卡片文本 `Kancolle 2015 2026年9月7日 160`）。
  逐卡字段解析见 `layout-family-a.md` §1（views 解析经
  `parseDisplayMetric`，含 K/M/B/万/亿 倍率）。
- 货架：**视频 / 短视频 / 播放列表** + 「查看全部」「上一个」「下一个」；页顶
  搜索框「在你的频道中搜索」。
- 卡片操作「更多选项」为 **hover 盖章**元素（未悬停/后台时不在 DOM）——菜单项
  待前台实证（预期为 查看分析 / 编辑 / 下载 / 推广 等；「查看分析」即跳
  `/video/{vid}/analytics/…`）。
- 家族 B（经典表格 `ytcp-video-section-content#video-list`）的行/列结构见
  `layout-family-a.md`；`channel.basic` 采集器两条家族均已支持。

## 4. 社区页 `/channel/{cid}/comments/inbox`

- 页面壳：**`name="channel.activity"`**（注意：不是 channel.comments）；
  `h1`「社区」。
- 页签（id 稳定）：`#comments-tab`「评论」/ `#viewer-posts-tab`「观看者帖子」 /
  `#mentions-tab`「提及」。
- **filter JSON URL 协议**（可编程构造筛选）：

  ```
  ?filter=[
    {"isDisabled":false,"isPinned":true,"name":"SORT_BY","value":"SORT_BY_MOST_RELEVANT"},
    {"name":"ENGAGED_STATUS","value":["COMMENT_CATEGORY_NOT_ENGAGED"]},
    {"name":"PARENT_ENTITY_CONTENT_TYPE","value":[
      "PARENT_ENTITY_CONTENT_TYPE_WATCH",
      "PARENT_ENTITY_CONTENT_TYPE_SHORT",
      "PARENT_ENTITY_CONTENT_TYPE_CREATOR_POST"]}
  ]
  ```

  字段语义：`SORT_BY`（排序）、`ENGAGED_STATUS`（是否已互动/待处理）、
  `PARENT_ENTITY_CONTENT_TYPE`（视频/Shorts/社区帖子来源）。
- 搜索框「在你的频道中搜索」；空态/错误态含「移除过滤条件」「重试」。
- 评论行解剖：**本频道无评论，行级锚点待实证**（预期 `ytcp-comment-thread`
  形态：作者 / 正文 / 所属视频链接 / 时间 / 回复·点赞·爱心·置顶·隐藏·举报）。

## 5. 指标获取配方速查

| 需求 | 页面 | 周期入口 | 读取锚点 | 实测值样例 |
| --- | --- | --- | --- | --- |
| 单条视频实时播放量（48h） | 视频分析 | 任意 | `yta-latest-activity-card .metric-value`（窗口校验 `span.dropdown-trigger-text`） | `0 · 过去 48 小时` |
| 单条视频实时播放量（60min） | 视频分析 | 菜单 `[test-id=60_minutes]` | 同上 | `0 · 过去 60 分钟` |
| 视频近 28 天播放量 | 视频分析 | `…/period-4_weeks` | `#EXTERNAL_VIEWS-tab #metric-total` | `1` |
| 视频近 7 天播放量 | 视频分析 | `…/period-week` | `#EXTERNAL_VIEWS-tab #metric-total` | `—` |
| 视频近 28/7 天播放时长 | 视频分析 | 同上 | `#EXTERNAL_WATCH_TIME-tab #metric-total`（小时） | `0.0` / `—` |
| 频道近 28/7 天播放量·时长 | 频道分析 | 同 URL 令牌 | 同构两卡 | `1` / `0.0` |
| 周期/区间校验 | 任一分析页 | — | `yta-time-picker .label-text` + `.dropdown-trigger-text` | `2026/9/23 – 2026/10/20 · 过去 28 天` |

占位符「—」语义：所选区间无数据（合法无值），与 `channel.basic` 采集器的
ABSENT/H5 规则一致，不得当作 0。

## 6. 对现有模块的映射（未来工作，非本轮实现）

- `channel.basic` 已采 Dashboard/Analytics 摘要（views/subscriberDelta +
  周期区间）；若需 7/28 天双窗口，可在同一 STATE_MACHINE 里按 URL 令牌
  依次读 `period-week` / `period-4_weeks`（无需点选）。
- 实时口径为官方估算值，落库时应标注（可复用 `DISPLAY_ROUNDED` 式精度语义或
  新增 `ESTIMATED` 标记）。
- 社区页 filter JSON 可构造确定性 URL（评论采集/巡检的入口）。
- 所有分析页指标卡均为 `#<METRIC>-tab > #metric-total` 单一骨架，新增指标
  （如 `AVERAGE_WATCH_TIME`）只需扩展 id 映射表。
