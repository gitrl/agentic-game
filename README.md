# 法律悬疑互动小说游戏（Agentic Game）

基于前后端分离架构的法律悬疑互动小说项目。当前版本已支持：
- 会话创建与角色初始化
- SSE 流式叙事输出
- 回合选项推进与状态更新
- 存档 / 读档 / 回放日志
- Token 使用统计
- 标准分层后端结构（Controller / Service / Repository）
- 可选 MongoDB 持久化（默认内存仓储）

## 1. 项目结构

```txt
.
├─ backend/
│  ├─ src/
│  │  ├─ app.ts
│  │  ├─ index.ts
│  │  ├─ config/
│  │  ├─ controllers/
│  │  ├─ services/
│  │  ├─ repositories/
│  │  ├─ routes/
│  │  ├─ middlewares/
│  │  ├─ engine/
│  │  └─ types/
├─ frontend/
│  ├─ src/
│  └─ vite.config.ts
└─ package.json
```

## 2. 环境变量配置

### 2.1 Backend (`backend/.env`)

已提供文件：
- `backend/.env`
- `backend/.env.example`

变量说明：

| 变量名 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `4000` | 后端服务端口 |
| `MONGODB_URI` | 空 | MongoDB 连接串；为空时使用内存仓储 |
| `MONGODB_DB_NAME` | `agentic_game` | MongoDB 数据库名 |
| `MONGODB_STRICT` | `false` | `true` 时 Mongo 连接失败会阻止启动；`false` 时回退内存仓储 |
| `LLM_ENABLED` | `false` | 是否启用 LLM 叙事润色（OpenAI 兼容模式） |
| `OPENAI_BASE_URL` | `https://dashscope.aliyuncs.com/compatible-mode/v1` | OpenAI 兼容 API 地址 |
| `OPENAI_API_KEY` | 空 | OpenAI 兼容 API Key |
| `OPENAI_MODEL` | `qwen3.5-plus` | 统一模型名（千问） |
| `OPENAI_TEMPERATURE` | `0.7` | 采样温度 |
| `OPENAI_TIMEOUT_MS` | `30000` | LLM 请求超时时间（毫秒） |
| `LLM_SOFT_TIMEOUT_MS` | `4000` | 单次润色软超时，超时立即回退规则输出 |
| `LLM_MAX_CONSECUTIVE_FAILURES` | `2` | 连续失败阈值，达到后触发熔断 |
| `LLM_COOLDOWN_MS` | `180000` | 熔断冷却时长（毫秒） |

### 2.2 Frontend (`frontend/.env`)

已提供文件：
- `frontend/.env`
- `frontend/.env.example`

变量说明：

| 变量名 | 默认值 | 说明 |
|---|---|---|
| `VITE_API_BASE_URL` | `http://localhost:4000` | 前端请求后端地址 |

## 3. 启动方式

### 3.1 安装依赖

```bash
npm install --prefix backend
npm install --prefix frontend
```

### 3.2 一键启动前后端

在项目根目录执行：

```bash
npm run dev
```

可选：

```bash
npm run dev:backend
npm run dev:frontend
```

## 4. 后端模式说明

- 默认模式：内存仓储（不依赖数据库，适合本地快速开发）。
- MongoDB 模式：设置 `MONGODB_URI` 后自动启用。
- 启动日志会显示当前仓储模式：`repository=memory` 或 `repository=mongodb`。
- LLM 模式：设置 `LLM_ENABLED=true` 且提供 `OPENAI_API_KEY` 后，后端会通过 OpenAI 兼容接口调用 `qwen3.5-plus` 对每轮叙事进行润色。
- 当网络超时或连续失败时，系统会在软超时后快速回退，并进入短暂熔断冷却，避免每轮都被 LLM 阻塞。
- 叙事润色系统提示词位于 `backend/src/prompts/narrativeSystemPrompt.ts`，可独立维护与迭代。

## 5. 核心接口

- `POST /sessions` 创建会话
- `POST /sessions/:id/init` 初始化角色
- `POST /sessions/:id/actions` 提交动作（SSE）
- `GET /sessions/:id/state` 获取状态
- `POST /sessions/:id/save` 创建存档
- `POST /sessions/load` 读取存档
- `GET /sessions/:id/replay` 获取回放与 Token 汇总

SSE 事件：
- `input_feedback`
- `narrative_delta`
- `choices`
- `state_patch`
- `progress`
- `token_usage`
- `done`

## 6. 稳定性目标

项目目标是“可稳定轮回 50+ 回合不崩溃”，重点是：
- 进程稳定（服务不崩）
- 回合闭环完整（每轮都有可用输出）
- 状态可持续（长回合后存档、读档、回放仍一致）
