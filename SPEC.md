# Luftballons MVP SPEC v0.1

## 0. 文档状态

版本：v0.1  
状态：Draft / MVP Baseline  
目标用户：少量受信任内部用户  
首个运行环境：Tampermonkey + YouTube Studio  
拓扑：2–3 个浏览器客户端 + 可选中心服务  
发布方式：内部使用，不面向公众发布

---

# 1. 项目目标

Luftballons 是一个面向浏览器后台工作流的轻量自动化与数据采集框架。
> credit: 99 Luftballons 
首个适配目标为 YouTube Studio。

Luftballons 的核心目标不是构建无人值守 Bot，也不是绕过 YouTube Studio 的正常交互流程，而是：

1. 减少重复鼠标操作；
2. 减少人工抄录和整理数据；
3. 对多个工作电脑上的相同流程进行统一；
4. 支持离线工作；
5. 支持安全、受控的数据汇总；
6. 为未来增加更多浏览器后台工作模块提供统一 Runtime。

MVP 首批功能：

- YouTube 多语言字幕辅助；
- YouTube Studio 基础频道数据采集；
- CSV / JSON 本地导出；
- 可选远端同步；
- 简单中心管理后台。

---

# 2. 非目标

v0.1 明确不实现：

- 无人值守持续运行；
- 定时后台采集；
- 主动构造 YouTube Studio 私有 API 请求；
- 重放 Studio 内部 RPC；
- 任意远程 JS 执行；
- 浏览器远程控制；
- WebSocket 长连接控制；
- 浏览器之间直接通信；
- 浏览器自动登录；
- Cookie、OAuth Token、Google 凭据采集；
- 公开 SaaS；
- 多租户；
- 企业 RBAC；
- 大规模批量账号操作；
- 通用爬虫；
- 自动采集公开 YouTube 视频；
- 复杂 Analytics 图表采集；
- Revenue / CTR / Retention 等高级指标；
- 插件商店正式发布。

---

# 3. 核心设计原则

## 3.1 Local-first

浏览器客户端必须能够脱离服务器独立运行。

服务器不可用时，以下能力仍必须可用：

- 插件加载；
- 本地配置；
- YouTube Studio 自动化；
- 数据采集；
- 本地数据查看；
- CSV 导出；
- JSON 导出。

远端服务器只提供增强能力，不应成为 Runtime 的强依赖。

---

## 3.2 Human-triggered

所有实际工作任务必须由用户明确启动。

禁止：

- 页面打开即自动修改数据；
- 后台自动遍历 YouTube Studio；
- 服务器主动触发浏览器任务；
- 定时无人值守执行。

允许：

用户点击：

```text
[采集频道数据]
```

然后 Luftballons 自动完成一系列页面导航和读取操作。

---

## 3.3 UI-only Automation

MVP 自动化仅模拟普通用户可以通过 YouTube Studio UI 完成的操作。

允许：

```text
点击
等待
读取页面
选择菜单
切换页面
填写表单
导航
```

不允许：

```text
主动构造 Studio 私有 API
重放内部请求
手工生成 RPC payload
复制身份验证 Token
直接调用非公开 backend endpoint
```

Network Observer 若未来加入，只允许观察 Studio 自身发起的数据请求，不允许主动调用。

---

## 3.4 Fail-safe

自动化遇到未知状态必须停止，而不是猜测。

原则：

```text
Known State
→ Action
→ Verify
→ Next State
```

禁止：

```text
click
sleep
click
sleep
click
```

如果预期 UI 元素不存在：

```text
STOP
→ 提示用户
→ 记录诊断信息
```

不得尝试点击“看起来最像”的其它元素。

---

## 3.5 Idempotent

任何可以实现幂等的操作都必须优先实现幂等。

例如添加字幕语言：

```text
检查语言是否已存在

YES → skip
NO  → add
```

重复执行同一任务不应产生重复数据或明显副作用。

---

# 4. 系统架构

总体结构：

```text
                       ┌─────────────────────┐
                       │ Luftballons Server  │
                       │                     │
                       │ Config              │
                       │ Ingest              │
                       │ Admin               │
                       └──────────┬──────────┘
                                  │
                           HTTPS / optional
                                  │
               ┌──────────────────┼──────────────────┐
               │                  │                  │
               ▼                  ▼                  ▼
        ┌────────────┐     ┌────────────┐     ┌────────────┐
        │ Browser A  │     │ Browser B  │     │ Browser C  │
        │            │     │            │     │            │
        │ Luftballons│     │ Luftballons│     │ Luftballons│
        └──────┬─────┘     └──────┬─────┘     └──────┬─────┘
               │                  │                  │
               ▼                  ▼                  ▼
        YouTube Studio     YouTube Studio     YouTube Studio
```

每个 Browser 独立拥有：

```text
Runtime
Modules
Local Config
Local Queue
Local Storage
Export
Logs
```

服务器故障不得导致 Browser Runtime 故障。

---

# 5. Client Runtime

建议结构：

```text
Luftballons Runtime
│
├── Bootstrap
├── Module Registry
├── Capability Manager
├── Task Runner
├── Navigation Service
├── DOM Service
├── Collection Service
├── Sink Manager
├── Config Manager
├── Local Storage
├── Logger
└── UI
```

---

# 6. Bootstrap

Bootstrap 是 Tampermonkey 用户脚本的入口。

职责：

- 初始化 Runtime；
- 检查当前域名；
- 加载本地模块；
- 加载本地配置；
- 恢复本地任务状态；
- 注册 UI；
- 可选检查远端配置。

Bootstrap 本身必须保持简单。

不得：

- 动态 eval；
- 下载任意 JS；
- 接受服务端脚本指令。

---

# 7. Module Model

所有功能必须通过 Module 注册。

建议接口：

```text
Module
├── id
├── name
├── version
├── site
├── capabilities
├── detect()
├── run()
└── cleanup()
```

示例：

```text
id:
youtube.subtitle.multilang

site:
studio.youtube.com

capabilities:
NAVIGATE
READ
WRITE_REVERSIBLE
WRITE_COMMIT
```

---

# 8. Module Categories

MVP 定义两类模块。

## 8.1 Action

Action 用于：

> 帮用户执行操作。

例如：

```text
YouTube Subtitle Automation
```

---

## 8.2 Collector

Collector 用于：

> 帮用户读取和整理数据。

例如：

```text
YouTube Basic Channel Collector
```

未来可以增加更多类别，但 v0.1 不需要。

---

# 9. Capability Model

Runtime 必须实现显式能力控制。

v0.1 定义以下 Capability：

```text
READ
NAVIGATE
WRITE_REVERSIBLE
WRITE_COMMIT
NETWORK_SEND
LOCAL_EXPORT
```

---

## 9.1 READ

允许：

- 读取 DOM；
- 读取页面显示的数据；
- 读取本地配置；
- 读取本地 Collection。

默认自动允许。

---

## 9.2 NAVIGATE

允许：

- 页面切换；
- 切换 YouTube Studio Tab；
- 打开视频设置页面；
- 返回上一页面。

用户启动任务后允许自动执行。

---

## 9.3 WRITE_REVERSIBLE

允许执行可撤销的写操作。

例如：

- 添加语言；
- 填写尚未提交的内容；
- 修改未最终提交的 UI 状态。

用户主动启动对应任务后允许。

---

## 9.4 WRITE_COMMIT

表示可能造成正式、持久变化的操作。

例如：

```text
Publish
Save irreversible setting
Delete
```

必须经过 Human Gate。

---

## 9.5 NETWORK_SEND

允许向 Luftballons Server 发送数据。

必须独立于 READ。

即：

```text
Collector 可以读取数据
≠
Collector 可以上传数据
```

离线模式不得需要此 Capability。

---

## 9.6 LOCAL_EXPORT

允许用户主动将 Collection 导出到文件。

支持：

```text
CSV
JSON
```

---

# 10. Human Gate

v0.1 Human Gate 原则：

```text
READ
→ 无需确认

NAVIGATE
→ 任务启动后无需逐步确认

WRITE_REVERSIBLE
→ 用户启动任务即授权

WRITE_COMMIT
→ 每个关键提交必须明确确认

NETWORK_SEND
→ 用户配置启用 + 本次任务允许

LOCAL_EXPORT
→ 用户主动点击
```

Human Gate UI 应明确告诉用户：

```text
将要执行什么
影响什么
是否可撤销
```

---

# 11. Task Runner

所有自动化操作通过 Task Runner 执行。

Task 状态：

```text
IDLE
RUNNING
WAITING
WAITING_HUMAN
COMPLETED
FAILED
CANCELLED
```

每个 Task 必须支持：

```text
start
cancel
status
log
```

---

# 12. Automation State Machine

UI Automation 必须采用状态机模型。

示例：

```text
START

→ Detect Studio

→ Verify Channel

→ Open Analytics

→ Wait Ready

→ Read Metrics

→ Open Content

→ Wait Ready

→ Read Recent Videos

→ Normalize

→ Save Collection

→ COMPLETE
```

每一步必须：

```text
Precondition
Action
Postcondition
Timeout
Error
```

---

# 13. DOM Interaction

DOM 操作优先使用稳定语义。

优先级：

```text
ARIA
role
data semantic attributes
visible labels
known component structure
```

尽量避免：

```text
nth-child
deep CSS selector
dynamic generated class
absolute DOM position
```

---

# 14. Page Compatibility

YouTube Studio UI 可能存在 A/B 测试和不同版本。

因此 Adapter 必须支持 Page Signature。

例如：

```text
youtube_studio_layout:
legacy
2026_v1
unknown
```

如果：

```text
layout == unknown
```

则：

```text
STOP
```

并提示：

```text
当前 YouTube Studio 页面版本暂未支持。
```

---

# 15. Data Collection Model

所有 Collector 输出统一进入 Collection Service。

标准结构：

```json
{
  "collector": "youtube.channel.basic",
  "collector_version": 1,
  "schema_version": 1,
  "installation_id": "pc-a",
  "captured_at": "...",
  "channel": {},
  "data": {}
}
```

---

# 16. MVP Collection Dataset

v0.1 首批只采集简单数据。

## 16.1 Channel Summary

目标：

```text
频道总体观看数据
订阅者 / 粉丝增长数据
```

最终字段根据 Studio 实际 UI 决定。

建议规范化字段：

```text
channel_id
channel_name
period_start
period_end
views
subscriber_delta
captured_at
```

如果 Studio 页面没有稳定提供 `channel_id`，允许初期仅保存：

```text
channel_name
```

但内部最好尽可能保存稳定 Channel Identifier。

---

## 16.2 Recent Videos

采集最近发布的视频：

```text
video_id
title
published_at
views
captured_at
```

MVP 不要求采集：

```text
likes
comments
CTR
watch time
revenue
retention
traffic source
```

---

# 17. Snapshot Semantics

v0.1 使用 Snapshot 模型。

即每次用户点击：

```text
[采集频道数据]
```

产生：

```text
ChannelSnapshot
RecentVideoSnapshot[]
```

不要求第一版自动计算所有历史变化。

未来服务器可以根据多个 Snapshot 推导趋势。

---

# 18. Collection Flow

推荐工作流：

```text
用户点击
[采集频道数据]

        ↓

验证 YouTube Studio

        ↓

识别当前频道

        ↓

读取当前可获得数据

        ↓

自动导航

        ↓

读取频道指标

        ↓

读取最近视频

        ↓

规范化

        ↓

Validation

        ↓

Local Collection
```

然后：

```text
                Local Collection
                       │
          ┌────────────┼────────────┐
          │            │            │
          ▼            ▼            ▼
      CSV Export   JSON Export   Remote Sync
```

---

# 19. Collection Validation

数据写入 Collection 前必须验证。

例如：

```text
views >= 0
subscriber_delta is numeric
video_id non-empty
title non-empty
captured_at valid
```

如果部分字段失败：

允许：

```text
PARTIAL SUCCESS
```

而不是整次任务失败。

---

# 20. Local Storage

客户端必须具有持久化 Local Storage。

至少保存：

```text
installation_id
runtime config
module config
collections
task logs
remote config cache
```

可以优先使用：

```text
IndexedDB
```

Tampermonkey Storage 可以用于简单配置。

不建议把大量 Collection 存在简单 key-value 存储中。

---

# 21. Sink Architecture

Collection Service 不直接绑定存储目的地。

接口：

```text
Collection
    ↓
Sink
```

v0.1 实现：

```text
CSVSink
JSONSink
RemoteSink
```

未来可以实现：

```text
SQLiteSink
ExcelSink
PostgresSink
GoogleSheetSink
```

Collector 不得感知具体 Sink。

---

# 22. CSV Export

CSV Export 必须支持完全离线。

典型场景：

```text
PC 无网络

→ 打开 Studio
→ 手动触发采集
→ 导出 CSV
→ U 盘拷走
```

CSV 至少分为：

```text
channel_summary.csv
recent_videos.csv
```

也可以提供统一 ZIP，v0.1 非必需。

---

# 23. JSON Export

JSON 用于：

- 调试；
- 数据迁移；
- 将来重新导入；
- 保留较完整 schema。

必须包含：

```text
schema_version
collector_version
captured_at
installation_id
```

---

# 24. Remote Server

Luftballons Server 为可选组件。

职责：

```text
Config
Ingest
Installation Registry
Basic Admin UI
Error Intake
```

不得承担 Browser Runtime 必需逻辑。

---

# 25. Network Direction

v0.1 原则：

```text
Browser → Server
```

不提供：

```text
Server → Browser direct command
```

不使用：

```text
WebSocket
Remote shell
Reverse channel
Browser polling for task commands
```

---

# 26. Remote Config

远端可以提供声明式配置。

允许：

```text
module enabled
module disabled
feature flag
minimum version
supported layout
sync enabled
ingest endpoint alias
kill switch
```

例如：

```json
{
  "modules": {
    "youtube.channel.basic": {
      "enabled": true
    }
  }
}
```

---

# 27. Remote Config Failure

配置优先级：

```text
Bundled Default
        ↓
Cached Remote Config
        ↓
Fresh Remote Config
```

如果服务器：

```text
timeout
offline
5xx
DNS failure
```

Runtime 必须继续运行。

---

# 28. Kill Switch

Server 可以声明：

```text
module disabled
```

用于：

- YouTube UI 更新；
- 已知 bug；
- 某功能可能误操作。

但是 Kill Switch 只有在客户端成功获取远端配置后生效。

Server 不得主动远程中止正在执行的 Browser Task。

---

# 29. Remote Code Execution Boundary

严格禁止：

```text
eval(remoteCode)
Function(remoteCode)
remote module JS
remote arbitrary selector action
remote arbitrary fetch
remote script command
```

服务器不得下发：

```text
click selector X
execute JS Y
fetch URL Z
```

页面逻辑必须跟随经过审查的 Luftballons 版本发布。

---

# 30. Endpoint Security

Browser 只允许访问显式 allowlist Endpoint。

例如：

```text
https://Luftballons.example/api/config
https://Luftballons.example/api/ingest
https://Luftballons.example/api/error
```

禁止：

```text
@connect *
arbitrary URL proxy
```

---

# 31. Authentication

内部使用情况下，MVP 可以采用 Installation Token。

流程：

```text
首次安装
→ installation_id
→ installation token
→ 本地安全保存
```

Server 支持：

```text
revoke
disable
rotate
```

禁止将长期服务端 Secret 写入 userscript。

---

# 32. Data Minimization

客户端只上传明确需要的数据。

禁止默认上传：

```text
Cookie
Authorization
Google token
完整 HTML
完整 Network Response
浏览历史
其它频道页面
用户个人信息
```

Collector 必须采用字段 allowlist。

---

# 33. Privacy Boundary

Luftballons 处理的数据来自用户自己的 YouTube Studio。

即便如此，仍应遵守最小采集原则。

上传之前最好允许用户查看：

```text
此次将同步：

Channel summary: 1
Videos: 10
```

v0.1 可以不做逐字段预览，但必须有数据数量摘要。

---

# 34. YouTube Subtitle Module

Module ID：

```text
youtube.subtitle.multilang
```

类别：

```text
Action
```

---

# 35. Subtitle MVP Workflow

用户：

```text
打开目标视频
→ Luftballons
→ Multilingual Subtitle
```

选择：

```text
English
Japanese
Korean
...
```

执行：

```text
检测当前视频

→ 打开 Subtitle

→ 检查已有语言

→ 跳过已有语言

→ 添加目标语言

→ 进行 Studio UI 中允许的字幕操作

→ 等待验证

→ 下一语言
```

---

# 36. Subtitle Commit Boundary

如果最终操作属于正式发布：

```text
WRITE_COMMIT
```

必须：

```text
Human Gate
```

例如：

```text
即将发布以下字幕：

English
Japanese
Korean

[确认发布]
[取消]
```

---

# 37. Subtitle Error Handling

单语言失败不必导致所有语言失败。

结果：

```text
English      SUCCESS
Japanese     EXISTS
Korean       FAILED
Spanish      CANCELLED
```

最终生成摘要。

---

# 38. YouTube Basic Collector

Module ID：

```text
youtube.channel.basic
```

类别：

```text
Collector
```

Capability：

```text
READ
NAVIGATE
LOCAL_EXPORT
```

联网同步开启时：

```text
NETWORK_SEND
```

---

# 39. Collector Trigger

采集必须由用户主动点击：

```text
[采集频道数据]
```

不得：

- 打开 Studio 自动运行；
- 定时运行；
- 后台静默运行。

---

# 40. Collector Navigation

允许 Collector 自动导航。

例如：

```text
Dashboard
→ Analytics
→ Content
→ Back
```

但所有导航必须：

```text
可见
可取消
有状态提示
```

---

# 41. Collector UI

建议：

```text
Luftballons

YouTube Studio
────────────────────

[采集频道数据]

状态：
● Reading channel summary
○ Reading subscriber growth
○ Reading recent videos
○ Saving

[取消]
```

完成：

```text
采集完成

Channel summary    ✓
Recent videos      10

[导出 CSV]
[导出 JSON]
[同步服务器]
```

---

# 42. Cancel

用户必须可以随时 Cancel。

Cancel 后：

```text
STOP further actions
preserve completed read-only data
mark task CANCELLED
```

不得继续导航。

---

# 43. Logging

客户端记录结构化日志。

级别：

```text
DEBUG
INFO
WARN
ERROR
```

默认持久保存：

```text
INFO+
```

日志不得保存敏感认证信息。

---

# 44. Error Record

错误至少包含：

```text
timestamp
installation_id
module
module_version
runtime_version
page
task_state
error_code
message
layout_signature
```

不得默认包含完整 HTML。

---

# 45. Diagnostics

遇到页面兼容问题，可以允许用户主动生成诊断包。

内容允许：

```text
runtime version
module versions
current path
layout signature
sanitized DOM metadata
logs
```

内容必须去敏。

---

# 46. Server Data Model

MVP 后端建议至少有：

```text
Installation
Collection
CollectionRecord
ErrorLog
Config
```

---

# 47. Installation

```text
id
name
runtime_version
last_seen
enabled
created_at
```

例如：

```text
PC-A
PC-B
PC-C
```

---

# 48. Collection

```text
id
installation_id
collector
captured_at
schema_version
record_count
```

---

# 49. Admin UI

MVP Admin 只需要简单页面。

## Overview

```text
Luftballons Admin
```

## Installations

```text
PC-A    online/recent    v0.1
PC-B    recent           v0.1
PC-C    offline          v0.1
```

这里的 online 不需要实时连接。

可以定义为：

```text
last_seen < threshold
```

---

## Collections

显示：

```text
Installation
Timestamp
Collector
Records
Status
```

---

## Modules

显示和配置：

```text
youtube.subtitle.multilang   ON
youtube.channel.basic        ON
```

---

## Errors

显示近期：

```text
module
installation
time
error
```

---

# 50. Admin 非目标

MVP 不需要：

```text
charts
real-time dashboard
complex search
RBAC
organization
workflow editor
remote task launch
remote browser control
```

---

# 51. Update Model

Tampermonkey 脚本更新使用正常版本发布机制。

推荐：

```text
@updateURL
@downloadURL
```

或内部手动安装。

服务器 Config API 不作为代码更新机制。

---

# 52. Versioning

至少独立维护：

```text
runtime_version
module_version
schema_version
```

例如：

```text
Runtime 0.1.0
youtube.channel.basic 0.1.2
schema 1
```

---

# 53. Compatibility Policy

模块声明：

```text
min_runtime_version
supported_layout
```

不兼容：

```text
disable module
show reason
```

不得强行运行。

---

# 54. Offline Mode

Offline Mode 可以由：

```text
网络不可用
```

或：

```text
用户主动启用
```

触发。

Offline Mode 中必须禁用：

```text
Remote Config Refresh
Remote Sync
Error Upload
```

其它本地功能保持正常。

---

# 55. Network Disable Mode

建议提供一个强制模式：

```text
Network Capability
[OFF]
```

此状态下 Luftballons 不发起任何远端请求。

适合：

```text
隔离电脑
敏感环境
USB 导出场景
```

---

# 56. 安全边界

Luftballons Server 被完全攻陷时，攻击者原则上不应获得：

```text
Google Account control
YouTube Studio arbitrary execution
Browser arbitrary JS execution
Cookie
Google token
remote shell
```

最大影响应尽量限制为：

```text
错误远端配置
错误 module enable/disable
接收到上传的数据
```

客户端必须验证 Config Schema，忽略未知或越权字段。

---

# 57. Threat Model

MVP 至少考虑：

## T1 Server Compromise

缓解：

```text
no remote code
allowlisted schema
no push control
capability separation
```

---

## T2 MITM

缓解：

```text
HTTPS only
reject insecure endpoint
```

---

## T3 Browser Script Bug

缓解：

```text
state machine
verification
human gate
kill switch
cancel
```

---

## T4 YouTube UI Change

缓解：

```text
layout detection
fail closed
versioned adapter
```

---

## T5 Accidental Upload

缓解：

```text
NETWORK_SEND separate capability
manual sync
offline mode
preview/count
```

---

## T6 Duplicate Collection

缓解：

每个 collection 有：

```text
collection_id
captured_at
installation_id
```

Server 支持幂等 ingest。

---

# 58. 推荐技术路线

## Client

```text
JavaScript / TypeScript
Tampermonkey
IndexedDB
```

如果构建系统值得引入：

```text
TypeScript
esbuild / Vite library mode
```

最终 bundle 为 userscript。

---

## Server

MVP 建议：

```text
Python
FastAPI
SQLite
```

理由：

- 只有 2–3 客户端；
- 数据量很小；
- 运维简单；
- 后续可迁移 PostgreSQL。

---

## Admin

建议：

```text
FastAPI SSR
Jinja2
少量 HTMX
```

不建议 MVP 上 React SPA。

---

# 59. API Surface

建议 MVP：

```text
GET  /api/v1/config

POST /api/v1/collections

POST /api/v1/errors

GET  /admin/
```

可选：

```text
POST /api/v1/installations/register
```

---

# 60. Collection Ingest

示例：

```json
{
  "collection_id": "uuid",
  "installation_id": "pc-a",
  "collector": "youtube.channel.basic",
  "collector_version": 1,
  "schema_version": 1,
  "captured_at": "...",
  "records": []
}
```

Server 必须允许重复 POST 相同 `collection_id` 而不产生重复数据。

---

# 61. Reliability Requirements

服务器不可用：

```text
Client task continues
```

上传失败：

```text
Collection remains local
```

页面读取失败：

```text
Task fails safely
```

一个 Collector 失败：

```text
其它 Module unaffected
```

远端 Config 错误：

```text
fallback cached/default
```

---

# 62. Performance Requirements

MVP 不追求速度极限。

原则：

```text
可靠 > 快
```

自动点击间隔根据：

```text
DOM Ready
UI State
```

决定，而不是硬编码极短延时。

Luftballons 不应明显降低 Studio 页面性能。

---

# 63. Browser Impact Constraints

禁止：

- 高频 MutationObserver 全 DOM 扫描；
- 高频轮询；
- 大量 Network Hook；
- 大量 Console 输出；
- 长期后台 CPU 占用；
- 页面级全局函数污染。

Observer 必须：

```text
范围最小化
任务结束 cleanup
```

---

# 64. MVP 开发阶段

## Phase 0 — Runtime Skeleton

实现：

```text
Bootstrap
Module Registry
Task Runner
Capability
Logger
Local Storage
Basic UI
```

验收：

- Studio 正常加载；
- Luftballons UI 可开关；
- 不执行任务时无明显性能影响。

---

## Phase 1 — Local Collection Framework

实现：

```text
Collection Service
IndexedDB
CSVSink
JSONSink
```

验收：

- 创建测试 Collection；
- 刷新后仍存在；
- CSV 可导出；
- 完全断网可工作。

---

## Phase 2 — YouTube Basic Collector

实现：

```text
Channel summary
Subscriber growth
Recent videos
```

验收：

- 用户显式启动；
- 自动导航；
- 数据正确读取；
- 可取消；
- 可本地导出。

---

## Phase 3 — Subtitle Automation

实现：

```text
语言选择
自动导航
已有语言识别
新增语言
Human Gate
结果摘要
```

---

## Phase 4 — Remote Server

实现：

```text
Installation
Config
Ingest
Admin
```

验收：

- 服务器宕机不影响本地功能；
- Collection 可上传；
- 重复上传幂等。

---

## Phase 5 — Security Hardening

实现：

```text
Network Off
Endpoint Allowlist
Token revoke
Config validation
Kill switch
Diagnostic sanitization
```

---

# 65. MVP 总体验收标准

v0.1 必须满足：

### A. Offline

完全断网环境：

```text
Luftballons loads
Collector works
CSV export works
JSON export works
```

PASS。

---

### B. Server Failure

正在运行 Collector 时关闭服务器。

预期：

```text
Collector continues
local data saved
sync reports failure
data not lost
```

PASS。

---

### C. Unknown UI

人工修改测试环境使关键 Selector 不存在。

预期：

```text
automation stops
no speculative click
error shown
```

PASS。

---

### D. Human Gate

Subtitle 操作到最终提交。

预期：

```text
system pauses
requires explicit approval
```

PASS。

---

### E. Cancel

采集运行过程中点击 Cancel。

预期：

```text
no additional actions
task marked CANCELLED
```

PASS。

---

### F. Data Integrity

同一 Collection 上传两次。

预期：

```text
server stores once
```

PASS。

---

### G. Network Isolation

开启：

```text
Network Capability OFF
```

预期 Luftballons：

```text
zero remote request
```

PASS。

---

### H. Multi-installation

PC-A / PC-B / PC-C 上传数据。

Server 能正确区分：

```text
installation
collection
capture time
```

PASS。

---

# 66. v0.1 Definition of Done

当以下条件全部满足，即认为 Luftballons v0.1 MVP 完成：

1. Tampermonkey Runtime 稳定运行；
2. YouTube Studio 正常使用不受明显影响；
3. 数据采集必须手动触发；
4. 可采集频道基础观看数据；
5. 可采集订阅者增长；
6. 可采集最近视频及观看数；
7. 可 CSV / JSON 离线导出；
8. 自动导航可 Cancel；
9. 未知 UI 状态 Fail Closed；
10. Subtitle Module 可运行；
11. WRITE_COMMIT 有 Human Gate；
12. 可选服务器支持 2–3 个 Installation；
13.服务器失效不影响客户端；
14. Server 无远程代码执行能力；
15. Network 能完全关闭；
16. Collection 可安全同步和幂等接收；
17. 简单 Admin 可以查看 Installation、Collection、Module 和 Error。

---

# 67. 后续候选方向

以下内容全部留到 v0.2+：

```text
Advanced Analytics
CTR
Impressions
Watch Time
Retention
Revenue
Traffic Source
Geography
Scheduled Collection
Advanced CSV layouts
Excel Export
SQLite Export
Google Sheets
Network Observer
Studio response parsing
Additional subtitle workflows
Metadata automation
Bulk video management
Cross-channel comparison
Trend dashboard
```

任何未来的“主动调用 Studio 私有接口”能力都必须单独进行架构与风险评审，不得默认成为现有 Collector 的自然扩展。

---

# 68. 最终架构原则

Luftballons v0.1 的设计可以概括为：

```text
Human-triggered
Local-first
Fail-safe
Capability-constrained
UI-driven
Offline-capable
Server-optional
No remote execution
```

核心产品边界：

> Luftballons 是用户操作 YouTube Studio 时的辅助 Runtime，而不是一个独立控制 YouTube 的 Bot。

核心安全边界：

> Luftballons Server 可以接收数据和提供声明式配置，但永远不应拥有浏览器任意执行能力。

核心可靠性边界：

> 任何中心节点故障，都不应阻止用户继续在本地完成工作。