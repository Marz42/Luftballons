# Luftballons v0.1 Implementation Plan

版本：v0.1  
状态：Implementation Baseline  
对应规范：Luftballons MVP SPEC v0.1

---

# 1. 实施目标

本实施方案用于指导 Luftballons v0.1 的实际开发、测试和验收。

v0.1 最终必须交付两个可用模块：

```text
youtube.channel.basic
youtube.subtitle.multilang
```

以及支撑它们运行的：

```text
Client Runtime
Local Collection
CSV / JSON Export
Optional Remote Sync
Minimal Admin
Security Boundaries
```

整个系统必须保持：

```text
Local-first
Human-triggered
UI-only
Fail-closed
Server-optional
No Remote Code Execution
```

---

# 2. 推荐仓库结构

建议单仓库管理 Client / Server / Docs。

```text
Luftballons/
│
├── README.md
├── SPEC.md
├── IMPLEMENTATION.md
├── SECURITY.md
├── AGENTS.md
│
├── package.json
├── pnpm-workspace.yaml
│
├── client/
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   │
│   ├── src/
│   │   ├── bootstrap/
│   │   │   └── bootstrap.ts
│   │   │
│   │   ├── runtime/
│   │   │   ├── runtime.ts
│   │   │   ├── module-registry.ts
│   │   │   ├── task-runner.ts
│   │   │   ├── capability-manager.ts
│   │   │   └── errors.ts
│   │   │
│   │   ├── services/
│   │   │   ├── dom-service.ts
│   │   │   ├── navigation-service.ts
│   │   │   ├── collection-service.ts
│   │   │   ├── config-service.ts
│   │   │   ├── storage-service.ts
│   │   │   ├── network-service.ts
│   │   │   ├── logger.ts
│   │   │   └── export-service.ts
│   │   │
│   │   ├── sinks/
│   │   │   ├── sink.ts
│   │   │   ├── csv-sink.ts
│   │   │   ├── json-sink.ts
│   │   │   └── remote-sink.ts
│   │   │
│   │   ├── ui/
│   │   │   ├── app.ts
│   │   │   ├── panel.ts
│   │   │   ├── task-progress.ts
│   │   │   ├── human-gate.ts
│   │   │   └── styles.ts
│   │   │
│   │   ├── sites/
│   │   │   └── youtube-studio/
│   │   │       ├── adapter.ts
│   │   │       ├── page-detector.ts
│   │   │       ├── selectors.ts
│   │   │       ├── parsers.ts
│   │   │       ├── navigation.ts
│   │   │       │
│   │   │       └── modules/
│   │   │           ├── channel-basic/
│   │   │           │   ├── module.ts
│   │   │           │   ├── collector.ts
│   │   │           │   └── schema.ts
│   │   │           │
│   │   │           └── subtitle-multilang/
│   │   │               ├── module.ts
│   │   │               ├── workflow.ts
│   │   │               └── schema.ts
│   │   │
│   │   ├── schemas/
│   │   │   ├── config.ts
│   │   │   ├── collection.ts
│   │   │   ├── installation.ts
│   │   │   └── error-record.ts
│   │   │
│   │   └── main.ts
│   │
│   ├── tests/
│   │   ├── unit/
│   │   ├── fixtures/
│   │   └── integration/
│   │
│   └── dist/
│       └── Luftballons.user.js
│
├── server/
│   ├── pyproject.toml
│   │
│   ├── app/
│   │   ├── main.py
│   │   ├── config.py
│   │   ├── db.py
│   │   │
│   │   ├── models/
│   │   │   ├── installation.py
│   │   │   ├── collection.py
│   │   │   ├── error_log.py
│   │   │   └── remote_config.py
│   │   │
│   │   ├── schemas/
│   │   │   ├── installation.py
│   │   │   ├── collection.py
│   │   │   ├── error_log.py
│   │   │   └── config.py
│   │   │
│   │   ├── api/
│   │   │   ├── config.py
│   │   │   ├── collections.py
│   │   │   ├── errors.py
│   │   │   └── installations.py
│   │   │
│   │   ├── admin/
│   │   │   ├── routes.py
│   │   │   └── templates/
│   │   │
│   │   └── services/
│   │       ├── auth.py
│   │       ├── ingest.py
│   │       └── config_service.py
│   │
│   └── tests/
│
├── docs/
│   ├── architecture.md
│   ├── collector-schema.md
│   ├── capability-model.md
│   ├── youtube-layout-notes.md
│   └── test-plan.md
│
└── scripts/
    ├── build-client.sh
    └── dev-server.sh
```

---

# 3. Client 核心接口

## 3.1 Capability

```ts
export type Capability =
  | "READ"
  | "NAVIGATE"
  | "WRITE_REVERSIBLE"
  | "WRITE_COMMIT"
  | "NETWORK_SEND"
  | "LOCAL_EXPORT";
```

原则：

模块只能声明所需能力。

Runtime 不允许模块在运行时临时增加权限。

---

# 4. Module Interface

```ts
export interface LuftballonsModule {
  id: string;
  name: string;
  version: string;

  site: "youtube-studio";

  capabilities: Capability[];

  detect(ctx: DetectContext): Promise<ModuleAvailability>;

  run(ctx: TaskContext): Promise<TaskResult>;

  cleanup?(): Promise<void>;
}
```

`detect()` 只允许：

```text
READ
```

不得产生页面副作用。

---

# 5. ModuleAvailability

```ts
export interface ModuleAvailability {
  available: boolean;

  reason?:
    | "WRONG_SITE"
    | "UNSUPPORTED_LAYOUT"
    | "WRONG_PAGE"
    | "DISABLED"
    | "MISSING_REQUIREMENT";

  metadata?: Record<string, unknown>;
}
```

---

# 6. TaskContext

```ts
export interface TaskContext {
  taskId: string;

  capabilities: CapabilityContext;

  dom: DomService;
  navigation: NavigationService;
  collections: CollectionService;
  logger: Logger;
  config: ConfigService;

  signal: AbortSignal;

  humanGate: HumanGateService;
}
```

任何模块不得直接访问：

```text
fetch
GM_xmlhttpRequest
IndexedDB
window.location mutation
```

必须通过 Runtime Service。

目的：

> 把安全边界集中在 Core，而不是依赖每个 Module 自律。

---

# 7. TaskResult

```ts
export interface TaskResult {
  status:
    | "COMPLETED"
    | "PARTIAL"
    | "FAILED"
    | "CANCELLED";

  summary: string;

  collectionIds?: string[];

  warnings?: TaskWarning[];
}
```

---

# 8. Task Runner

状态：

```ts
export type TaskState =
  | "IDLE"
  | "RUNNING"
  | "WAITING"
  | "WAITING_HUMAN"
  | "COMPLETED"
  | "PARTIAL"
  | "FAILED"
  | "CANCELLED";
```

核心接口：

```ts
interface TaskRunner {
  start(moduleId: string): Promise<string>;

  cancel(taskId: string): Promise<void>;

  getState(taskId: string): TaskState;
}
```

必须保证：

```text
一个 Browser 同一时间最多一个 UI Automation Task。
```

MVP 不支持并行自动点击。

---

# 9. DOM Service

模块禁止裸 `document.querySelector()` 大量散落。

统一：

```ts
interface DomService {
  find(target: DomTarget): Promise<Element | null>;

  waitFor(
    target: DomTarget,
    timeoutMs?: number
  ): Promise<Element>;

  click(target: DomTarget): Promise<void>;

  readText(target: DomTarget): Promise<string | null>;

  exists(target: DomTarget): Promise<boolean>;
}
```

目标描述：

```ts
interface DomTarget {
  id: string;

  ariaLabel?: string;
  role?: string;
  text?: string;

  selectorFallback?: string;
}
```

原则：

```text
semantic selector
>
stable attribute
>
CSS fallback
```

---

# 10. Navigation Service

```ts
interface NavigationService {
  currentPage(): StudioPage;

  navigate(target: StudioTarget): Promise<void>;

  waitReady(
    page: StudioPage,
    timeoutMs?: number
  ): Promise<void>;

  back(): Promise<void>;
}
```

模块不得随意：

```ts
window.location.href = ...
```

---

# 11. Page Detector

```ts
type StudioPage =
  | "DASHBOARD"
  | "ANALYTICS"
  | "CONTENT"
  | "VIDEO_DETAILS"
  | "SUBTITLES"
  | "UNKNOWN";
```

Layout：

```ts
type StudioLayout =
  | "2026_V1"
  | "2026_V2"
  | "UNKNOWN";
```

如果：

```text
StudioLayout = UNKNOWN
```

所有存在 UI 副作用的 Module 必须拒绝执行。

---

# 12. Human Gate Interface

```ts
interface HumanGateService {
  request(
    action: HumanGateAction
  ): Promise<"APPROVED" | "REJECTED">;
}
```

```ts
interface HumanGateAction {
  capability: "WRITE_COMMIT";

  title: string;
  description: string;

  consequences: string[];

  reversible: false;
}
```

不得：

```text
默认同意
超时自动确认
```

---

# 13. Collection Schema

基础结构：

```ts
export interface Collection<T> {
  collectionId: string;

  installationId: string;

  collector: string;
  collectorVersion: number;
  schemaVersion: number;

  capturedAt: string;

  status:
    | "COMPLETE"
    | "PARTIAL";

  data: T;
}
```

---

# 14. Channel Basic Schema

```ts
export interface ChannelBasicData {
  channel: {
    channelId?: string;
    channelName: string;
  };

  period: {
    start?: string;
    end?: string;
    label?: string;
  };

  summary: {
    views?: number;
    subscriberDelta?: number;
  };

  recentVideos: RecentVideoSnapshot[];
}
```

```ts
export interface RecentVideoSnapshot {
  videoId?: string;
  title: string;

  publishedAt?: string;

  views: number;

  capturedAt: string;
}
```

---

# 15. Schema 原则

字段不可确认时：

```text
null / undefined
```

禁止：

```text
猜值
0 作为未知
空字符串冒充真实值
```

---

# 16. Collection Service

```ts
interface CollectionService {
  save<T>(collection: Collection<T>): Promise<void>;

  get(id: string): Promise<Collection<unknown> | null>;

  list(filter?: CollectionFilter): Promise<CollectionSummary[]>;

  delete(id: string): Promise<void>;
}
```

MVP 后端：

```text
IndexedDB
```

---

# 17. Sink Interface

```ts
export interface Sink {
  id: string;

  capability: Capability;

  available(): Promise<boolean>;

  write(
    collection: Collection<unknown>
  ): Promise<SinkResult>;
}
```

---

# 18. CSV Sink

```ts
class CsvSink implements Sink {
  id = "csv";
  capability = "LOCAL_EXPORT";
}
```

必须支持：

```text
Channel Summary
Recent Videos
```

推荐两个文件：

```text
Luftballons_channel_summary_YYYYMMDD.csv
Luftballons_recent_videos_YYYYMMDD.csv
```

---

# 19. JSON Sink

必须保留完整 Collection Envelope。

用途：

```text
debug
migration
re-import
forensics
```

---

# 20. Remote Sink

```ts
class RemoteSink implements Sink {
  id = "remote";
  capability = "NETWORK_SEND";
}
```

RemoteSink 不得直接接受任意 URL。

只能使用：

```text
Config-defined endpoint alias
→ locally bundled endpoint map
```

例如：

```ts
const ENDPOINTS = {
  ingestV1: "https://example.internal/api/v1/collections"
};
```

远端配置只能下发：

```text
ingestV1
```

不能下发：

```text
https://evil.example
```

---

# 21. Network Service

所有外部网络访问统一经过：

```ts
interface NetworkService {
  getConfig(): Promise<RemoteConfig | null>;

  sendCollection(
    collection: Collection<unknown>
  ): Promise<RemoteResult>;

  sendError?(
    error: ErrorRecord
  ): Promise<RemoteResult>;
}
```

禁止 Module 直接访问网络。

---

# 22. Network Mode

```ts
type NetworkMode =
  | "OFF"
  | "MANUAL"
  | "ENABLED";
```

MVP 推荐默认：

```text
MANUAL
```

即：

- 配置可尝试刷新；
- Collection 不自动上传；
- 用户点击“同步服务器”才发送数据。

---

# 23. Remote Config Schema

允许字段：

```ts
interface RemoteConfig {
  schemaVersion: 1;

  modules: Record<
    string,
    {
      enabled: boolean;
      killSwitch?: boolean;
    }
  >;

  minRuntimeVersion?: string;

  features?: Record<string, boolean>;
}
```

明确禁止配置字段：

```text
script
javascript
selector
url
request
command
action
xpath
```

---

# 24. Config Validation

客户端必须使用严格 schema validation。

原则：

```text
unknown field → ignore or reject
wrong type → reject config
invalid signature/schema → cached/default config
```

远端配置错误不得导致 Runtime 无法启动。

---

# 25. Bootstrap Priority

启动顺序：

```text
Load Bundled Defaults
        ↓
Load Local Settings
        ↓
Load Cached Remote Config
        ↓
Initialize Runtime
        ↓
Render UI
        ↓
Optional Background Config Refresh
```

Config Refresh 失败：

```text
log warning
continue
```

---

# 26. Installation Identity

首次运行生成：

```text
installation_id = UUID
```

用户可以配置显示名称：

```text
Office-PC-A
Office-PC-B
Editing-PC
```

Token 与 ID 分离。

---

# 27. Server API

## Config

```http
GET /api/v1/config
```

Header：

```text
Authorization: Bearer <installation-token>
```

返回声明式配置。

---

# 28. Collection Ingest

```http
POST /api/v1/collections
```

Body：

```json
{
  "collection_id": "...",
  "installation_id": "...",
  "collector": "youtube.channel.basic",
  "collector_version": 1,
  "schema_version": 1,
  "captured_at": "...",
  "status": "COMPLETE",
  "data": {}
}
```

---

# 29. Ingest Idempotency

唯一约束：

```text
collection_id UNIQUE
```

相同 `collection_id` 再次上传：

推荐返回：

```http
200 OK
```

或：

```http
409 Already Exists
```

但不得创建第二份数据。

推荐：

```text
200 + already_ingested=true
```

以减少 Client 处理复杂度。

---

# 30. Error API

可选：

```http
POST /api/v1/errors
```

默认必须由用户设置启用。

MVP 不要求后台自动无限上传错误。

---

# 31. Server 数据库

MVP SQLite。

建议表：

```text
installations
collections
error_logs
remote_config
```

---

# 32. installations

```text
id
display_name
token_hash
enabled
runtime_version
created_at
last_seen_at
```

服务器只保存：

```text
token hash
```

不保存明文 Token。

---

# 33. collections

```text
collection_id PK
installation_id
collector
collector_version
schema_version
captured_at
status
payload_json
received_at
```

MVP 可以先保存完整规范化 JSON。

不要过早拆复杂关系表。

---

# 34. Admin UI

页面：

```text
/admin/
/admin/installations
/admin/collections
/admin/modules
/admin/errors
```

只需要 SSR。

---

# 35. Admin 安全边界

Admin v0.1：

```text
internal only
```

推荐至少使用：

```text
single administrator password
or reverse-proxy authentication
```

不得裸暴露公网。

---

# 36. Phase 0 — Repository & Runtime Skeleton

目标：

建立不依赖任何具体 YouTube 功能的 Runtime。

实现：

```text
Repo
Build
Bootstrap
Module Registry
Task Runner
Capability Manager
Logger
UI shell
```

---

## Phase 0 边界

不实现：

```text
真实采集
自动字幕
Server
Network
复杂 IndexedDB
```

---

## Phase 0 测试条件

环境：

```text
Chrome / Chromium
Tampermonkey
YouTube Studio logged in
```

测试：

### P0-T1

打开 Studio。

期望：

```text
Luftballons button appears
Studio behaves normally
```

### P0-T2

打开普通 YouTube。

期望：

```text
Luftballons Studio modules unavailable
```

### P0-T3

启动模拟 Task。

期望：

```text
RUNNING → COMPLETED
```

### P0-T4

运行 Task 时 Cancel。

期望：

```text
CANCELLED
AbortSignal triggered
```

---

## Phase 0 成功判定

全部满足：

```text
Runtime loads reliably
one-task rule works
cancel works
modules can register
no obvious Studio regression
```

---

## Phase 0 主要风险

### 风险

Runtime 与 Site Adapter 耦合过早。

### 缓解

Core 不得 import：

```text
youtube selectors
youtube page names
youtube module code
```

依赖方向只能：

```text
Site Adapter → Runtime
```

---

# 37. Phase 1 — Local Storage & Sink

目标：

形成完整 Local-first 数据路径。

```text
Collector mock
→ Collection
→ IndexedDB
→ CSV / JSON
```

---

## Phase 1 实现

```text
CollectionService
IndexedDB
CsvSink
JsonSink
Collection UI
```

---

## Phase 1 边界

不实现：

```text
Remote Sync
YouTube real collector
```

---

## Phase 1 测试

### P1-T1

生成测试 Collection。

关闭标签页。

重新打开。

成功判定：

```text
Collection still exists
```

### P1-T2

完全断网。

导出 CSV。

成功：

```text
valid UTF-8 CSV
Excel can open
fields correct
```

### P1-T3

导出 JSON。

成功：

```text
schemaVersion preserved
collectionId preserved
data identical
```

### P1-T4

创建 100 个 Collection。

成功：

```text
UI remains usable
no obvious blocking
```

---

## Phase 1 风险

### IndexedDB Schema Migration

风险：

后续结构升级破坏已有数据。

缓解：

从第一版加入：

```text
db_version
schema_version
```

升级必须 migration。

---

# 38. Phase 2 — YouTube Studio Adapter

目标：

先解决：

> 如何安全识别页面，而不是先写业务 Collector。

实现：

```text
page detector
layout signature
dom targets
navigation
wait-ready
```

---

## Phase 2 边界

不采真实业务数据。

先实现：

```text
Dashboard → Analytics → Content → Back
```

测试导航。

---

## Phase 2 测试

至少用：

```text
2 个不同浏览器 profile
2 台实际电脑优先
```

因为 Studio 可能有 A/B UI。

---

### P2-T1 Known Layout

识别：

```text
DASHBOARD
ANALYTICS
CONTENT
```

成功率要求：

```text
100% in known test environments
```

---

### P2-T2 Unknown Layout

人工移除关键 fixture / 破坏关键 DOM。

预期：

```text
UNKNOWN
```

而不是错误识别。

---

### P2-T3 Navigation

执行：

```text
Dashboard
→ Analytics
→ Content
```

每次进入后验证：

```text
postcondition == true
```

---

### P2-T4 Cancel

导航途中 Cancel。

预期：

```text
不进行下一次点击
```

---

## Phase 2 成功判定

必须证明：

> Luftballons 能知道“我不知道当前页面”。

这是本阶段最重要验收条件。

---

# 39. Phase 3 — YouTube Basic Collector

目标：

实现第一个真实 Collector：

```text
youtube.channel.basic
```

---

# 40. Collector 工作流

推荐：

```text
START

↓
detect channel context

↓
read available dashboard data

↓
navigate Analytics if required

↓
read:
views
subscriber growth

↓
navigate Content

↓
read recent videos

↓
normalize

↓
validate

↓
save Collection

↓
show summary

↓
COMPLETE
```

---

# 41. Collector 第一版数据范围

只允许：

```text
channel name/id where available
selected reporting period
views
subscriber delta
recent video title
recent video id where available
recent video publish date where available
recent video views
```

任何范围扩展必须开新 Issue。

---

# 42. Collector 数据读取策略

优先：

```text
DOM visible value
```

不实现：

```text
private API
network replay
hidden backend query
```

如果 UI 只显示：

```text
12.3K
```

则允许第一版解析为：

```text
12300
```

但必须标记：

```text
precision = DISPLAY_ROUNDED
```

如果需要这种情况，建议 schema 增加：

```ts
interface MetricValue {
  value: number;
  precision: "EXACT" | "DISPLAY_ROUNDED";
}
```

不要假装 UI 显示的缩略值是精确值。

---

# 43. Collector 测试条件

至少准备：

```text
Channel A:
有近期视频

Channel B:
近期视频数量较少

至少一台网络较慢电脑
```

---

### P3-T1 Basic Collection

用户点击：

```text
采集频道数据
```

预期：

```text
single Collection created
```

---

### P3-T2 Manual Verification

随机抽取：

```text
views
subscriber growth
3 recent videos
```

与 Studio UI 人工比对。

成功标准：

```text
exact match
```

若 UI 本身缩写显示：

```text
parsed value follows documented rounding rule
```

---

### P3-T3 Partial Failure

人工让 Recent Video Selector 失败。

预期：

```text
summary retained
Collection.status = PARTIAL
recent video warning shown
```

---

### P3-T4 No Upload

Network Mode = OFF。

运行采集。

使用 DevTools 验证：

```text
Luftballons external network requests = 0
```

---

### P3-T5 Cancel

在 Analytics → Content 过程中取消。

成功：

```text
no further navigation
task CANCELLED
partial collected data may remain locally
```

---

# 44. Phase 3 成功判定

真实电脑环境连续完成：

```text
10 次人工触发采集
```

要求：

```text
无误点击
无错误页面修改
无数据丢失
至少 9/10 完整成功
失败必须 fail-safe
```

目标不是“永远成功”。

目标是：

> 成功时数据正确，失败时安全停止。

---

# 45. Phase 3 风险

## YouTube UI 变化

缓解：

```text
selectors centralized
page signature
postcondition verification
unknown → stop
```

## 数据缩写

缓解：

保存 precision 信息。

## SPA 延迟

缓解：

状态等待，不使用固定 sleep 作为主要同步方式。

---

# 46. Phase 4 — Subtitle Multilang

目标：

实现：

```text
youtube.subtitle.multilang
```

---

# 47. 工作流

```text
用户选择目标语言

↓
verify current video

↓
open subtitles

↓
read existing languages

↓
for each language:

    already exists
        → SKIP

    absent
        → ADD

↓
prepare final state

↓
WRITE_COMMIT?

YES → Human Gate

↓
publish/save

↓
verify result

↓
summary
```

---

# 48. Phase 4 边界

禁止第一版：

```text
无人值守批量视频
跨频道
自动选择目标视频
服务器下发字幕任务
```

一次 Task：

```text
只处理当前用户明确选择的视频。
```

---

# 49. Phase 4 测试

使用测试视频。

优先：

```text
private/unlisted test video
```

---

### P4-T1 Existing Language

预先存在 English。

请求：

```text
English + Japanese
```

预期：

```text
English SKIPPED
Japanese added
```

不得重复 English。

---

### P4-T2 Human Gate

到最终 Publish。

预期：

```text
WAITING_HUMAN
```

无确认不得继续。

---

### P4-T3 Reject

用户点击取消。

预期：

```text
no final commit
```

---

### P4-T4 UI Mismatch

人工破坏关键目标。

预期：

```text
FAILED
no speculative click
```

---

### P4-T5 Re-run

同一任务运行两次。

第二次应主要返回：

```text
EXISTS / SKIPPED
```

不产生重复状态。

---

# 50. Phase 4 成功判定

至少：

```text
5 个测试视频
3 种语言组合
```

连续测试。

要求：

```text
0 次错误发布
0 次错误删除
0 次错误视频操作
```

任何错误视频操作视为 Blocker。

---

# 51. Phase 5 — Remote Server

目标：

让三台客户端可以选择性汇总数据。

---

# 52. 实现顺序

先做：

```text
Installation
Collection Ingest
```

再做：

```text
Config
Admin
Errors
```

不要反过来。

---

# 53. Phase 5 边界

Server 不具备：

```text
task scheduling
browser commands
remote selectors
remote JS
WebSocket
browser push
```

---

# 54. Server 测试拓扑

```text
PC-A
PC-B
PC-C
   │
   ▼
Luftballons Server
```

测试时可以使用：

```text
2 台真实电脑
+
1 个独立 Browser Profile
```

作为最低条件。

正式验收优先 3 台独立环境。

---

# 55. Phase 5 测试

### P5-T1 Registration

三 Installation 能区分。

---

### P5-T2 Sync

三客户端上传 Collection。

Admin 正确显示：

```text
installation
capture time
collector
record count
```

---

### P5-T3 Idempotency

同 Collection 上传：

```text
3 次
```

数据库只存在：

```text
1 record
```

---

### P5-T4 Server Shutdown

Collector 执行途中关闭 Server。

预期：

```text
collection completes locally
```

用户点击 Sync：

```text
sync failed
collection remains local
```

---

### P5-T5 Server Recovery

重新启动。

再次 Sync。

预期：

```text
successful upload
```

---

### P5-T6 Bad Config

Server 返回：

```text
invalid JSON
unknown field
wrong type
```

客户端：

```text
reject
fallback
continue working
```

---

### P5-T7 Revoked Token

Server revoke PC-B。

预期：

```text
PC-B local works
PC-B remote sync fails clearly
PC-A/C unaffected
```

---

# 56. Phase 5 成功判定

必须证明：

> Server 是增强组件，而不是故障传播中心。

即所有 Server Failure Case 都不得造成：

```text
Browser runtime failure
Studio unusable
local collection loss
```

---

# 57. Phase 6 — Security Hardening

在 v0.1 Release 前单独进行。

---

# 58. Security Checklist

检查 Userscript Metadata：

禁止：

```text
@match *://*/*
@connect *
```

只允许所需域名。

---

检查源码：

搜索：

```text
eval(
new Function(
innerHTML =
GM_xmlhttpRequest
fetch(
window.location
document.cookie
localStorage token
```

逐项审计。

---

# 59. Token Handling

要求：

```text
server stores hash
client stores token
logs never print token
```

---

# 60. Network OFF 验收

开启：

```text
Network OFF
```

使用 DevTools Network。

运行：

```text
open Luftballons
collect
export CSV
subtitle task
```

Luftballons 自身远端请求：

```text
0
```

YouTube 自身请求不计。

---

# 61. Remote Compromise Simulation

构造恶意 Config：

```json
{
  "script": "...",
  "endpoint": "https://evil.example",
  "selector": "#publish",
  "command": "click"
}
```

预期：

```text
全部忽略 / schema reject
```

不得产生任何动作。

---

# 62. Browser Impact Test

Studio 打开 Luftballons：

测试：

```text
Idle 10 minutes
```

观察：

```text
CPU
memory
console
DOM mutation frequency
network
```

成功标准：

```text
无明显持续 CPU 活动
无高频轮询
无无限 observer
无持续网络请求
```

---

# 63. Release Gate

任何 v0.1 Release 必须经过以下 Gate。

## Gate A — Functional

```text
Basic Collector PASS
CSV PASS
JSON PASS
Subtitle PASS
```

---

## Gate B — Fail-safe

```text
Unknown UI PASS
Cancel PASS
Partial Failure PASS
```

---

## Gate C — Offline

```text
Server absent PASS
Network OFF PASS
USB export workflow PASS
```

---

## Gate D — Security

```text
No remote code
No arbitrary endpoint
No credential collection
Human Gate enforced
```

---

## Gate E — Multi-installation

至少两台真实电脑验证。

推荐三台。

---

# 64. Blocker 定义

以下任一问题出现不得发布：

```text
操作错视频
误发布
误删除
未知 UI 继续自动点击
Server 宕机导致 Client 不可用
Network OFF 仍外传数据
Remote Config 能控制 selector/action
Collection 丢失
不同 Installation 数据混淆
```

---

# 65. Major Bug

以下可以修复后重新验收：

```text
某页面识别失败
某 UI variant 不支持
CSV 格式问题
Admin 展示问题
采集部分字段失败
```

前提：

```text
系统安全停止
无错误副作用
```

---

# 66. 可接受降级

Luftballons 的设计允许：

```text
“不工作”
```

而不允许：

```text
“猜着工作”
```

因此以下情况可接受：

```text
Unsupported YouTube layout
Unknown page
Metric unavailable
Slow page timeout
```

正确行为：

```text
STOP
explain
log
```

---

# 67. 风险矩阵

| 风险 | 概率 | 影响 | 策略 |
|---|---:|---:|---|
| YouTube UI 改版 | 高 | 高 | Page Signature + Fail Closed |
| Selector 失效 | 高 | 中 | 集中管理 + Semantic Selector |
| SPA 加载慢 | 高 | 中 | State Wait + Timeout |
| Server 宕机 | 中 | 低 | Local-first |
| Server 被入侵 | 低/中 | 高 | No Remote Code + Schema Allowlist |
| Token 泄露 | 中 | 中 | Revocation + Hash Storage |
| Collection 重复 | 中 | 低 | UUID + Idempotent Ingest |
| Collection 丢失 | 低 | 高 | Save Local Before Sync |
| 误点击不可逆操作 | 低 | 极高 | Human Gate + Postcondition |
| 多电脑数据混淆 | 低 | 中 | installation_id |
| 浏览器性能下降 | 中 | 中 | No High-frequency Polling |
| CSV 数据格式错误 | 中 | 低 | Schema Test + Fixture |

---

# 68. 测试策略

分四层。

## Unit

测试：

```text
parsers
schemas
state transitions
capability
config validation
CSV formatting
```

---

## Fixture

保存经过脱敏的：

```text
HTML fragments
DOM snapshots
```

用于测试 Selector 和 Parser。

不得保存：

```text
完整 Studio account HTML
cookie
token
个人敏感信息
```

---

## Integration

真实浏览器：

```text
Tampermonkey
YouTube Studio
```

验证：

```text
navigation
state machine
cancel
human gate
```

---

## Live Acceptance

最终人工环境：

```text
2–3 台电脑
真实工作频道
```

但字幕写操作优先使用：

```text
测试视频 / 未公开视频
```

---

# 69. 推荐开发顺序

不要同时做两个业务模块。

严格顺序：

```text
P0 Runtime
↓
P1 Local Data
↓
P2 Studio Adapter
↓
P3 Collector
↓
P4 Subtitle
↓
P5 Server
↓
P6 Hardening
```

原因：

Collector 是 READ-only。

它比字幕模块更适合验证：

```text
Runtime
Navigation
Page Detection
DOM abstraction
Collection
```

等基础架构。

---

# 70. 首个可用里程碑

建议定义：

```text
M0.1-local
```

完成：

```text
P0
P1
P2
P3
```

此时 Luftballons 已经可以：

```text
在单机
手动启动
采集频道基础数据
导出 CSV
完全离线使用
```

这是第一个真正有业务价值的版本。

---

# 71. 第二里程碑

```text
M0.1-action
```

增加：

```text
P4 Subtitle Automation
```

此时验证整个 Action/Human Gate 模型。

---

# 72. 第三里程碑

```text
M0.1-network
```

增加：

```text
P5 Server
```

此时才形成完整星型拓扑。

---

# 73. Release Candidate

```text
v0.1.0-rc1
```

必须先连续人工使用。

建议至少覆盖：

```text
≥ 20 次 Collector Task
≥ 10 次 Subtitle Task
≥ 3 次离线导出
≥ 3 次远端同步
≥ 1 次 Server Failure Drill
```

---

# 74. v0.1 最终成功定义

Luftballons v0.1 不是以“功能很多”为成功。

成功标准是：

用户在 2–3 台工作电脑上，可以可靠地：

```text
打开 YouTube Studio

→ 主动启动 Luftballons

→ 自动完成基础频道数据采集

→ 本地保存

→ CSV / JSON 导出

→ 可选同步中心服务器

→ 对当前视频执行多语言字幕辅助
```

并且满足：

```text
服务器坏了仍能工作
断网仍能导出
UI 不认识就停止
写操作关键步骤必须确认
远端无法执行任意代码
没有数据时不伪造
失败不产生危险副作用
```

---

# 75. 实施纪律

开发过程中所有新功能必须回答四个问题：

```text
1. 它属于哪个 Module？
2. 它需要哪个 Capability？
3. 离线时如何退化？
4. 失败时怎样保证不产生副作用？
```

如果无法明确回答，不应直接进入实现。

任何想增加：

```text
remote action
private API
automatic background collection
dynamic selector
network observer
```

的变更，都必须单独修改 SPEC，而不能作为“实现细节”偷偷引入。

---

# 76. 第一阶段建议开工 Issue

建议首先建立以下 Issues：

```text
FT-001 Runtime bootstrap and userscript build
FT-002 Module registry and capability manager
FT-003 Task runner and cancellation model
FT-004 Luftballons panel UI
FT-005 IndexedDB collection storage
FT-006 CSV and JSON sinks
FT-007 YouTube Studio page/layout detector
FT-008 YouTube Studio navigation service
FT-009 youtube.channel.basic collector
FT-010 Collector live acceptance
FT-011 youtube.subtitle.multilang
FT-012 Human Gate workflow
FT-013 Server ingest API
FT-014 Installation registration/auth
FT-015 Remote config
FT-016 Minimal Admin
FT-017 Network OFF mode
FT-018 Security hardening and release audit
```

推荐首个开发批次只处理：

```text
FT-001
FT-002
FT-003
FT-004
```

不要在 Runtime 尚未稳定前开始写 YouTube 自动点击逻辑。