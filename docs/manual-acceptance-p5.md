# Phase 5 Manual Acceptance + Server Deploy Runbook (P5-T1 … P5-T7)

Authoritative criteria: `IMPLEMENTATION.md` §35（Admin internal-only）、§54（Server 测试拓扑）、§55（P5-T1…T7）、§56（成功判定）、§59–§60（Token / Network OFF）；`SPEC.md` §24–§31、§54–§56、§59–§61。

Automated coverage（仓库现状）：server ≈ 23 pytest；client ≈ 153 tests（含 config 白名单、killSwitch、OFF zero-fetch、幂等 ingest）。**真机 + 多 Installation + 局域网 Server 不在 CI 内** — 本手册供与 Phase 4 一并人工验收。

前提：`client/dist/Luftballons.user.js` 已安装（`pnpm build`）；Tampermonkey `@match` 仍仅 Studio / youtube.com；`@grant` 仅 `GM_getValue`/`GM_setValue`/`GM_deleteValue`；无 `@match *://*/*`、无 `@connect *`。P4 字幕相关步骤见 `docs/manual-acceptance-p4.md`。

---

## 1. 环境与拓扑（IMPLEMENTATION §54）

```text
PC-A          PC-B          PC-C
  │             │             │
  └──────┬──────┴──────┬──────┘
         ▼
   Luftballons Server
   (Linux 内网机 或 Windows 工作机)
```

| Item | Requirement |
|------|-------------|
| Installations | **3** 个可区分 Installation（正式验收优先 **3 台独立环境**） |
| 最低可接受 | 2 台真机 + 1 个独立浏览器 profile（仍计 3 Installation） |
| Client | Chrome / Chromium + Tampermonkey；已登录测试用 YouTube Studio |
| Server | FastAPI + SQLite；绑定 loopback 或内网 IP（见 §2） |
| Network Mode（验收默认） | 面板 `MANUAL`（仅人工点击同步 / 刷新配置） |
| Artifact | `client/dist/Luftballons.user.js` |

Server 部署位置任选：Linux 内网机（推荐）或 Windows 工作机。**禁止把 Admin / API 裸暴露公网**（IMPLEMENTATION §35）。

---

## 2. Server 部署 runbook

工作目录均为仓库内 `server/`。

### 2.1 Linux（推荐，内网机）

```bash
cd server
python3 -m venv .venv
.venv/bin/pip install -e '.[dev]'

# 必设管理员密码；可选 DB 路径（默认 server/data/luftballons.db）
export ADMIN_PASSWORD='choose-a-strong-password'
export LUFTBALLONS_DB_PATH=./data/luftballons.db

# 单机 / 本机验收：只绑 loopback
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
```

局域网访问示例（仍属 **internal-only**，非公网）：

```bash
# 将 192.168.2.10 换成本机内网 IP
.venv/bin/uvicorn app.main:app --host 192.168.2.10 --port 8000
```

防火墙注意：仅对受信网段放行 TCP `8000`；不要做公网 DNAT / 云安全组 0.0.0.0/0。

可选 `systemd` unit 示例（路径按实际安装位置修改）：

```ini
[Unit]
Description=Luftballons Server (internal-only)
After=network.target

[Service]
Type=simple
User=luftballons
WorkingDirectory=/opt/luftballons/server
Environment=ADMIN_PASSWORD=choose-a-strong-password
Environment=LUFTBALLONS_DB_PATH=/opt/luftballons/server/data/luftballons.db
ExecStart=/opt/luftballons/server/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

局域网客户端需访问时，将 `--host` 改为内网 IP，并同步收紧防火墙。

### 2.2 Windows（工作机）

```bat
cd server
python -m venv .venv
.venv\Scripts\activate
pip install -e ".[dev]"

set ADMIN_PASSWORD=choose-a-strong-password
set LUFTBALLONS_DB_PATH=.\data\luftballons.db

uvicorn app.main:app --host 127.0.0.1 --port 8000
```

局域网：

```bat
uvicorn app.main:app --host 192.168.2.10 --port 8000
```

前台窗口保持运行即可；验收结束后 Ctrl+C 停止。

### 2.3 健康检查与 Admin 预期

```bash
# Process up（实现路径为 /healthz，非 /health）
curl -sS http://127.0.0.1:8000/healthz
# Expected: {"status":"ok"}

# 未带 Bearer → 401（鉴权失败），不得 500
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8000/api/v1/config
# Expected: 401
```

| Check | Expected |
|-------|----------|
| `GET /healthz` | `200` + `{"status":"ok"}` |
| `GET /api/v1/config` 无 token | `401`（不是 `500`） |
| `ADMIN_PASSWORD` 未设置时访问 `/admin/` | `401`（无弱默认密码；admin disabled） |
| 已设密码 | Browser Basic Auth：user `admin` + `ADMIN_PASSWORD` → `/admin/` |

Admin 入口：`http://127.0.0.1:8000/admin/`（或内网 IP 同路径）。

---

## 3. 客户端配置（Luftballons 面板 → Server 区）

每台 PC / 每个 profile **各自**完成：

1. 打开 Studio → 打开 Luftballons 面板 → **Server** 区。
2. **服务器地址**填入例如：`http://192.168.2.10:8000`（无尾斜杠亦可；与 uvicorn `--host` 一致）。
3. **网络模式**选 `MANUAL（手动同步）`。
4. 点击 **注册新安装** → 面板一次性展示 `installation_id` + token（文案含「仅显示一次」）。
5. **立即复制保存 token** → 确认 Token 输入框已填入 → 点 **保存**。
6. 三条环境各自注册 → 得到 **三个不同** `installation_id`（对应 P5-T1）。

同步入口：面板 **Collections** 区每条本地 collection 的 **同步到服务器**（非自动后台上传）。

刷新远端配置：Server 区 **立即刷新**。

---

## 4. P5-T1 … T7 与追加项

记录约定：Pass / Fail 填 `PASS` / `FAIL`；Notes 可写 installation_id、截图文件名等。

### P5-T1 — Registration

**Steps**

1. 按 §3 在三环境各注册一次（可填不同展示名便于区分）。
2. 打开 Admin → **Installations**（或查 SQLite `installations` 表）。

**Expected**

- 三条 Installation 可区分（不同 `installation_id`）。
- 各客户端面板显示各自的 `installation_id`。
- Token 仅注册时明文展示一次；此后面板为 password 输入框本地保存。

| Field | Value |
|-------|-------|
| Pass / Fail | ________ |
| installation_id A/B/C | ________ |
| Notes | ________ |

---

### P5-T2 — Sync

**Steps**

1. 三客户端各自先跑一次 `youtube.channel.basic` 采集，确认本地 Collections 有新条目。
2. 网络模式 `MANUAL`；对各本地 collection 点 **同步到服务器**。
3. Admin → **Collections**。

**Expected**

- Admin 列表出现来自三 Installation 的行。
- 每行可核对：`installation_id`、capture time（`captured_at`）、`collector`（及 schema）；列表行数 = 已 ingest 的 collection 条数。
- 同步成功后本地 collection **仍保留**（文案类似「同步成功，本地已保留」）。

| Field | Value |
|-------|-------|
| Pass / Fail | ________ |
| Admin rows seen | ________ |
| Notes | ________ |

---

### P5-T3 — Idempotency

**Steps**

1. 任选一条已同步成功的本地 collection。
2. 对**同一** collection 再点 **同步到服务器** 共 **3 次**（含首次则共 3 次成功路径）。
3. 观察面板提示；Admin Collections / DB 按 `collection_id` 计数。

**Expected**

- 库中该 `collection_id` **仅 1 条**；重复同步不新增行。
- 客户端可出现幂等提示：`alreadyIngested` / 「服务器已有此数据（幂等），本地已保留」。
- 本地数据仍在。

| Field | Value |
|-------|-------|
| Pass / Fail | ________ |
| collection_id | ________ |
| DB/Admin count for id | ________ |
| Notes | ________ |

---

### P5-T4 — Server Shutdown

**Steps**

1. 在一台客户端启动采集（`youtube.channel.basic`）。
2. 采集进行中途停止 Server（systemd stop / Ctrl+C / 关进程）。
3. 等待采集在客户端结束。
4. 对得到的本地 collection 点同步。

**Expected**

- 采集 **正常完成本地保存**（不因 Server 宕机而 runtime 崩溃）。
- 同步 **失败** 且有明确提示；collection **保留本地**。
- Studio 仍可用。

| Field | Value |
|-------|-------|
| Pass / Fail | ________ |
| Local collection kept | ________ |
| Sync error message | ________ |
| Notes | ________ |

---

### P5-T5 — Recovery

**Steps**

1. 重新按 §2 启动 Server；确认 `/healthz` 与 Admin 可用。
2. 对 T4 中失败同步的同一本地 collection 再次点同步。

**Expected**

- 同步成功；Admin 可见该 collection。
- 本地仍保留。

| Field | Value |
|-------|-------|
| Pass / Fail | ________ |
| Notes | ________ |

---

### P5-T6 — Bad Config

**背景（双层防护）**

- Server 出站 `GET /api/v1/config` 会经 whitelist sanitize：`script` / `selector` 等 forbidden 键丢弃；`enabled` 非 boolean 的模块项丢弃。
- Client `validateRemoteConfig`：forbidden 键 → **整份拒绝**；类型错（如 `enabled: "yes"`）→ **整份拒绝**；未知根键 → **忽略**；刷新失败 / 拒绝 → **保留已应用缓存或 bundled defaults**，采集继续。

Admin **Modules** 页仅暴露 `enabled` / `killSwitch` 复选框（合法写路径）。要在真机上直接打到「脏 JSON 到达浏览器」路径，用 DevTools Response override（推荐）：

**Steps**

1. DevTools → Network → 对下一次 `GET .../api/v1/config` 启用 Override，响应体改为例如：

```json
{
  "schemaVersion": 1,
  "modules": {
    "youtube.channel.basic": { "enabled": "yes", "script": "alert(1)" }
  },
  "script": "evil"
}
```

2. 面板 Server 区点 **立即刷新**。
3. 观察配置来源 / 上次刷新失败信息；再跑一次本地采集。
4. （可选）Admin Modules 正常勾选 `killSwitch` 后恢复干净配置，确认后续刷新可再次应用合法配置。

**Expected**

- 脏配置被客户端 **拒绝**；不执行任何脚本 / 选择器类行为。
- 继续使用缓存或默认配置；**采集仍可工作**。
- 远端配置错误 **不** 导致 browser runtime failure / Studio 不可用 / 本地 collection 丢失。

| Field | Value |
|-------|-------|
| Pass / Fail | ________ |
| Client behavior (reject / fallback) | ________ |
| Collector still works | ________ |
| Notes | ________ |

---

### P5-T7 — Revoked / disabled Token

**Steps**

1. Admin → Installations → 对 **PC-B** 对应 installation 执行 disable / toggle（禁用）。
2. PC-B：本地再采集一次；再点同步 / 立即刷新。
3. PC-A、PC-C：各同步一条（或刷新配置）。

**Expected**

- PC-B：**本地一切正常**（采集 / 导出）；同步或拉配置 **明确失败**（401 / 「鉴权失败（token 无效或已禁用）」类提示）。
- PC-A / PC-C：**不受影响**，同步成功。

| Field | Value |
|-------|-------|
| Pass / Fail | ________ |
| PC-B local OK | ________ |
| PC-B sync fails clearly | ________ |
| PC-A/C unaffected | ________ |
| Notes | ________ |

---

### 追加 A — Token rotate

**Steps**

1. Admin → Installations → 对某 installation **rotate-token**；页面一次性展示 New token（复制）。
2. 该机仍用旧 token 点同步 → 预期失败。
3. 面板粘贴新 token → **保存** → 再同步 → 预期成功。

| Field | Value |
|-------|-------|
| Pass / Fail | ________ |
| Old token sync | FAIL expected ________ |
| New token sync | PASS expected ________ |
| Notes | ________ |

---

### 追加 B — killSwitch

**Steps**

1. Admin → Modules → 对 `youtube.channel.basic` 勾选 **killSwitch** 并保存。
2. 客户端点 **立即刷新**（或按 UI 重新解析可用性）。
3. 观察 `youtube.channel.basic` 与 `youtube.subtitle.multilang`。
4. 取消 killSwitch / 恢复 enabled → 再刷新 → channel.basic 应可再启动。

**Expected**

- `youtube.channel.basic` → **DISABLED**（cause `killSwitch`），不可启动。
- `youtube.subtitle.multilang` **不受影响**（仍按页面可用性逻辑）。
- 恢复后 channel.basic 可用。

| Field | Value |
|-------|-------|
| Pass / Fail | ________ |
| Notes | ________ |

---

### 追加 C — Network OFF

**Steps**

1. 面板网络模式改为 **OFF（零网络）** → **保存**。
2. 观察 **立即刷新**、**同步到服务器**、**注册新安装** 是否禁用或点击后零请求。
3. DevTools Network：过滤到 Server base URL，执行打开面板 / 采集 / CSV 导出。
4. 再跑一次本地采集确认仍可用。

**Expected**

- 刷新 / 同步 / 注册：**禁用或明确拒绝**，且对 Server **0** 请求（YouTube 自身请求不计）。
- 采集与本地导出照常。

| Field | Value |
|-------|-------|
| Pass / Fail | ________ |
| Luftballons remote requests | 0 / other: ________ |
| Notes | ________ |

---

## 5. 验收判定表（IMPLEMENTATION §56）

核心命题：

> Server 是增强组件，而不是故障传播中心。

下列三类 **不得** 因 Server 故障、坏配置、token 吊销、Network OFF 而发生：

| Must not happen | Meaning |
|-----------------|---------|
| browser runtime failure | 脚本崩溃、面板无法打开、持续异常刷屏致不可用 |
| Studio unusable | 正常使用 Studio 导航 / 编辑被 Luftballons 破坏 |
| local collection loss | 同步失败或 Server 宕机导致本地 collection 被删或不可读 |

| Case | Pass / Fail | Runtime OK | Studio OK | Local data OK | Notes |
|------|-------------|------------|-----------|---------------|-------|
| P5-T1 Registration | ________ | ________ | ________ | ________ | ________ |
| P5-T2 Sync | ________ | ________ | ________ | ________ | ________ |
| P5-T3 Idempotency | ________ | ________ | ________ | ________ | ________ |
| P5-T4 Server Shutdown | ________ | ________ | ________ | ________ | ________ |
| P5-T5 Recovery | ________ | ________ | ________ | ________ | ________ |
| P5-T6 Bad Config | ________ | ________ | ________ | ________ | ________ |
| P5-T7 Revoked Token | ________ | ________ | ________ | ________ | ________ |
| Token rotate | ________ | ________ | ________ | ________ | ________ |
| killSwitch | ________ | ________ | ________ | ________ | ________ |
| Network OFF | ________ | ________ | ________ | ________ | ________ |

**Phase 5 总判定：** PASS / FAIL ________  
**验收人 / 日期：** ________

---

## 6. 备注

### CORS

当前 Server：`allow_origins=["*"]`，`allow_credentials=False`，仅 `Authorization` + `Content-Type`。

原因：userscript 请求仍走页面 `fetch`，源为 `https://studio.youtube.com`，浏览器强制 CORS。Server 默认 allowlist 为 Studio / youtube.com origins（可用 `LUFTBALLONS_ALLOW_ORIGINS` 扩展），配合 Bearer token + 禁止公网暴露。

### 常见问题

| Symptom | Likely cause / action |
|---------|----------------------|
| Token 忘记 | Admin Installations → **rotate-token**；客户端保存新 token（旧 token 立即失效） |
| 端口占用 | 换 `--port`，或结束占用 8000 的进程；客户端 base URL 端口一致 |
| `/admin` 401 | 未设 `ADMIN_PASSWORD`，或 Basic Auth 密码错误（user 固定 `admin`） |
| 局域网连不上 | uvicorn `--host` 是否为内网 IP；本机防火墙 / 交换机 ACL；客户端填 `http://` 非 `https://`（除非自备 TLS） |
| `/api/v1/config` 500 | 异常；正常无 token 应为 **401**。查 Server 日志与 DB 路径权限 |
| 同步 CORS 失败 | 确认 Server CORS 中间件在跑；勿用错误端口；OFF 模式会拒绝联网 |
| 注册后 token 空白 | 注册响应只展示一次；未保存则 rotate 重发 |

### 相关命令速查

```bash
# Server tests
cd server && .venv/bin/pytest -q

# Client tests / build
cd client && pnpm test && pnpm build
```

---

*Document only — no code changes required to follow this handbook.*
