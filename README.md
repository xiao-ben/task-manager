# 任务台

macOS 桌面任务管理：置顶小窗 + 日 / 周 / 月总结，**本地优先**，可选云端同步，并与 [Cursor](https://cursor.com) 双向联动。

默认不上传任何任务数据。待办、仓库路径和总结都写在本机；云端 API 是可选项。

## 功能

- **今日待办**：创建、改期、完成、取消；未完成任务可从近 90 天拉回今天
- **置顶小窗**：无边框透明窗，始终在最前；菜单栏托盘显示未完成数量
- **日 / 周 / 月总结**：根据任务列表生成草稿，可手改或用 AI 润色
- **本地优先**：原生 App 读写 `~/.cursor/task-manager/data.json`
- **可选同步**：开启后与自建 API（Vercel + Postgres）双向合并
- **Cursor → 待办**：Hooks 在会话开始/结束时自动建任务、写备注、标完成
- **待办 → Cursor**：绑定代码目录后一键派发 Local Agent，并回写运行记录

## 数据存在哪里

| 内容 | 位置 | 会不会进 Git |
|------|------|----------------|
| 任务 / 仓库 / 总结 | `~/.cursor/task-manager/data.json` | 否（在家目录，不在仓库） |
| API Token、Cursor Key | 应用设置 / `sidecar/.env` | 否（已被 gitignore） |
| 云端副本（可选） | 你自己的 Postgres | 否 |

克隆本仓库**不会**得到任何人的待办。请不要提交 `.env`、`.env.local` 或 `data.json`。

## 架构

```
┌─────────────┐     ~/.cursor/task-manager/data.json
│  桌面端      │◄──────────────────────────────────► 本机 JSON
│  Tauri +    │
│  React      │     可选双向同步
│             │◄──────────────►  API (Next.js / Vercel + Postgres)
└──────┬──────┘
       │ 本机 HTTP
       ▼
┌─────────────┐
│  Sidecar    │  调用 @cursor/sdk 启动 Local Agent
└─────────────┘
       ▲
┌──────┴──────┐
│ Cursor Hooks│  sessionStart / stop → 本地库或 API
└─────────────┘
```

| 目录 | 作用 |
|------|------|
| `apps/desktop` | React UI + Tauri 2（托盘 / 置顶小窗） |
| `apps/api` | Next.js Route Handlers，可部署到 Vercel |
| `packages/shared` | Zod schema 与总结草稿 |
| `sidecar` | 本机 Node 服务，启动 Cursor Local Agent |
| `hooks-templates` | Cursor `sessionStart` / `stop` 钩子 |

## 环境要求

- Node.js 20+
- [pnpm](https://pnpm.io) 9
- 原生 App：macOS 12+，以及 [Rust](https://rustup.rs/)

## 快速开始（仅本地）

桌面端默认**不同步云端**，只跑 UI 即可试用：

```bash
pnpm install
pnpm --filter @task-manager/shared build
pnpm dev:desktop
```

打开 http://localhost:1420 。浏览器模式把数据存在 `localStorage`；完整能力（小窗、托盘、本机 JSON、自动拉起 sidecar）需要 Tauri 原生 App。

### 原生 App

```bash
cd apps/desktop
pnpm tauri:dev
```

打包：

```bash
cd apps/desktop
pnpm tauri:build
```

产物在 `apps/desktop/src-tauri/target/release/bundle/`。

### 可选：本地 API

需要验证同步或 Hooks 打到 HTTP API 时：

```bash
cp apps/api/.env.example apps/api/.env.local
# 默认 TASK_MANAGER_TOKEN=dev-token-change-me，未配置 DATABASE_URL 时使用内存库
pnpm dev:api
```

在设置里打开同步，填入 `http://127.0.0.1:3001` 和同一个 Token。

冒烟测试（需 API、sidecar、桌面 dev server 都已启动）：

```bash
bash scripts/e2e-smoke.sh
```

## Cursor 联动

### 1. 填写 API Key

复制模板并填入 [Cursor API Key](https://cursor.com/settings)：

```bash
cp sidecar/.env.example sidecar/.env
```

原生 App 启动时会自动拉起 sidecar；浏览器开发模式需手动：

```bash
pnpm dev:sidecar
```

### 2. 绑定代码目录并派发

设置 → 仓库，任选一种方式登记目录：

- 从 Cursor 最近工作区导入
- 任务行「文件夹」图标，弹出系统目录选择器
- 设置页批量选择
- 浏览器模式下手动填写绝对路径

今日任务点「派发」：sidecar 在该目录启动 Agent。结束后任务会标为完成/待办，并可查看运行记录。任务行「↗」用 `cursor://` 打开对应仓库。

### 3. 安装 Hooks（Cursor → 待办）

在设置页点「安装 / 导出 Hooks」，或手动复制 `hooks-templates/` 到 `~/.cursor/hooks/` 并合并 `hooks.json`。

本地模式会把会话写进同一份 `data.json`。若要用云端 API，再写入 `~/.cursor/task-manager.env.json`（模板见 `hooks-templates/task-manager.env.json.example`）。

## 可选：部署云端 API

1. 用 Vercel 导入本仓库，Root Directory 设为 `apps/api`（或在仓库根执行 `vercel`，已包含 `apps/api/vercel.json`）
2. 绑定 Postgres（例如 Neon），设置环境变量：
   - `DATABASE_URL`
   - `TASK_MANAGER_TOKEN`（长随机串，不要用示例值）
3. 在数据库执行：
   - [`apps/api/drizzle/0000_init.sql`](apps/api/drizzle/0000_init.sql)
   - [`apps/api/drizzle/0001_agent_runs.sql`](apps/api/drizzle/0001_agent_runs.sql)

   或本地：`cd apps/api && DATABASE_URL=... pnpm db:push`
4. 桌面端设置中打开同步，填入你的 API URL 与 Token

可选 AI 总结：配置 `AI_GATEWAY_API_KEY` 或 `OPENAI_API_KEY`。

`PATCH` 任务时带 `expectedUpdatedAt`；冲突（409）以服务端为准。

## 环境变量

**`apps/api`**

| 变量 | 说明 |
|------|------|
| `TASK_MANAGER_TOKEN` | Bearer Token，必填 |
| `DATABASE_URL` | Postgres；不设则用内存库 |
| `USE_MEMORY_DB` | 设为 `1` 强制内存库 |
| `AI_GATEWAY_API_KEY` / `OPENAI_API_KEY` | 可选，AI 总结 |

**`sidecar`**

| 变量 | 说明 |
|------|------|
| `CURSOR_API_KEY` | Cursor Agent，仅本机 |

**`apps/desktop`**

| 变量 | 说明 |
|------|------|
| `VITE_TASK_MANAGER_TOKEN` | 可选，预填设置页 Token |

以上均有 `.env.example`，真实 `.env` / `.env.local` 已被忽略。

## 许可

[MIT](LICENSE)
