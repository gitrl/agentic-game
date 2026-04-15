# 逆判：重生证词 — AI 驱动法律悬疑互动小说

基于 Agentic AI 架构的互动叙事游戏。玩家以第一人称扮演一位拥有"重生"能力的辩护律师，在法庭攻防中收集证据、质疑证人、对抗命运阻力，为无辜的被告林策争取无罪判决。

## 目录

- [1. 项目结构](#1-项目结构)
- [2. 快速启动](#2-快速启动)
- [3. 核心游戏流程](#3-核心游戏流程)
- [4. Agent 与 Tool 设计](#4-agent-与-tool-设计)
- [5. 游戏引擎详解](#5-游戏引擎详解)
- [6. 记忆系统](#6-记忆系统)
- [7. 存储系统](#7-存储系统)
- [8. LLM 叙事润色](#8-llm-叙事润色)
- [9. API 接口与 SSE 事件](#9-api-接口与-sse-事件)
- [10. 前端实现](#10-前端实现)
- [11. 环境变量](#11-环境变量)
- [12. 稳定性设计](#12-稳定性设计)

---

## 1. 项目结构

```
.
├── backend/
│   └── src/
│       ├── index.ts                 # 入口：启动 Express 服务
│       ├── app.ts                   # Express 应用配置（CORS、路由、错误处理）
│       ├── config/
│       │   ├── loadEnv.ts           # dotenv 加载
│       │   ├── llmConfig.ts         # LLM 配置读取
│       │   └── repositoryFactory.ts # 仓储工厂（File / MongoDB 自动切换）
│       ├── controllers/
│       │   └── gameController.ts    # 路由控制器（SSE 流式输出）
│       ├── services/
│       │   ├── gameService.ts       # 业务编排层
│       │   ├── llmNarrativeService.ts # LLM 叙事润色（含熔断机制）
│       │   └── inputResolver.ts     # 自然语言意图解析
│       ├── engine/
│       │   └── gameEngine.ts        # 规则引擎（状态机、选项、数值、判决、重生）
│       ├── prompts/
│       │   └── narrativeSystemPrompt.ts # LLM 系统提示词
│       ├── repositories/
│       │   ├── gameRepository.ts    # 仓储接口定义
│       │   ├── file/                # 文件仓储（JSON，默认）
│       │   ├── memory/              # 内存仓储
│       │   └── mongodb/             # MongoDB 仓储
│       ├── utils/
│       │   ├── sse.ts               # SSE 工具函数
│       │   ├── memoryFileWriter.ts  # 记忆 Markdown 写入
│       │   └── asyncHandler.ts      # 异步路由包装
│       ├── core/
│       │   └── errors.ts            # AppError 定义
│       ├── middlewares/
│       │   └── errorHandler.ts      # 全局错误处理中间件
│       └── types/
│           └── game.ts              # 全部 TypeScript 类型定义
├── frontend/
│   └── src/
│       ├── main.tsx                 # React 入口
│       ├── App.tsx                  # 主应用（SSE 接收、状态管理、UI 渲染）
│       ├── types.ts                 # 前端类型定义
│       └── styles.css               # TailwindCSS 样式
├── data/                            # 运行时数据（自动生成）
│   ├── sessions/                    # GameState JSON 文件
│   ├── saves/                       # 存档快照 JSON 文件
│   └── {sessionId}.md              # 记忆 Markdown（供 LLM 上下文使用）
└── package.json                     # 根 monorepo 配置
```

## 2. 快速启动

### 安装依赖

```bash
npm install               # 根目录（concurrently）
npm install --prefix backend
npm install --prefix frontend
```

### 一键启动

```bash
npm run dev
# 后端: http://localhost:4000 (repository=file)
# 前端: http://localhost:5173
```

单独启动：

```bash
npm run dev:backend
npm run dev:frontend
```

### 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 18 + Vite + TailwindCSS + TypeScript |
| 后端 | Express + TypeScript (ESM) |
| AI | OpenAI 兼容接口（默认阿里千问 qwen3.5-plus） |
| 存储 | 文件 JSON（默认）/ MongoDB（可选） |
| 通信 | SSE（Server-Sent Events）流式推送 |

---

## 3. 核心游戏流程

```
创建会话 POST /sessions
        ↓
初始化角色 POST /sessions/:id/init（输入姓名、角色、天赋、初始道具）
        ↓
┌─────────────────────────────────────────────────────┐
│  游戏主循环（每轮）                                    │
│                                                     │
│  玩家提交动作 POST /sessions/:id/actions             │
│        ↓                                            │
│  InputResolver 解析意图 → 匹配到具体选项              │
│        ↓                                            │
│  GameEngine.processAction() 执行规则：                │
│    ├── 应用选项效果（数值变化、证据更新、NPC 关系）      │
│    ├── 检查里程碑事件（新证据、证人反转、干预暴露）      │
│    ├── 更新命运阻力                                   │
│    ├── 评估判决走向                                   │
│    ├── 检查重生触发条件                               │
│    ├── 检查游戏结束条件                               │
│    ├── 生成叙事文本 + 摘要                            │
│    └── 更新三层记忆                                   │
│        ↓                                            │
│  [可选] LLM 叙事润色（第一人称沉浸感增强）             │
│        ↓                                            │
│  SSE 流式推送：叙事片段 → 选项 → 状态变化 → 完成       │
│        ↓                                            │
│  写入文件仓储 + 记忆 Markdown                         │
└─────────────────────────────────────────────────────┘
        ↓
游戏结束（回合 ≥ 50 或提前达成胜利条件）→ 展示结局
```

---

## 4. Agent 与 Tool 设计

本项目采用 **多 Agent 协作** 架构，各 Agent 职责明确：

### 4.1 Rule Engine Agent（规则引擎）

**位置**：`backend/src/engine/gameEngine.ts`

核心 Agent，负责所有游戏逻辑的确定性计算。不依赖 LLM，保证每轮输出稳定可控。

| 职责 | 实现 |
|------|------|
| 状态管理 | 维护完整 GameState（数值、标记、证据、NPC、记忆、重生） |
| 选项生成 | 根据回合数、当前状态动态生成 3 个不重复选项 |
| 效果计算 | 每个选项对应确定性的数值变化、事件触发、关系偏移 |
| 叙事合成 | 基于模板拼接第一人称叙事（不依赖 LLM 也能完整输出） |
| 判决评估 | 根据五维数值实时计算判决走向 |
| 重生控制 | 条件满足时触发重生，执行记忆衰减与状态重置 |
| 结局判定 | 达到条件时生成四种结局之一 |

### 4.2 Story Agent（叙事润色）

**位置**：`backend/src/services/llmNarrativeService.ts` + `backend/src/prompts/narrativeSystemPrompt.ts`

可选 Agent，通过 LLM 对规则引擎输出的叙事进行润色，增强第一人称沉浸感和法庭攻防张力。

| 职责 | 实现 |
|------|------|
| 叙事增强 | 将模板叙事润色为 3-6 句文学化表达 |
| 约束遵守 | 不改变游戏状态含义，不引入新事实 |
| 容错降级 | 超时（4s 软超时）自动回退规则输出；连续失败 2 次触发 3 分钟熔断 |

### 4.3 Memory Agent（记忆管理）

**位置**：`backend/src/engine/gameEngine.ts`（updateMemoryBundles）+ `backend/src/utils/memoryFileWriter.ts`

负责三层记忆的维护和持久化，详见 [第 6 节](#6-记忆系统)。

### 4.4 Input Resolver Tool（意图解析工具）

**位置**：`backend/src/services/inputResolver.ts`

将玩家的自然语言输入解析为游戏可执行的选项。

**解析流程**：

```
玩家输入（choiceId 或自然语言）
        ↓
    有 choiceId？→ 直接匹配（置信度 1.0）
        ↓ 无
    文本归一化（去空白、小写化）
        ↓
    语义有效性检查（≥ 2 个中文/拉丁/数字字符）
        ↓
    多维度评分（对每个可用选项打分）：
      ├── 选项 ID 完全匹配    → +1.0
      ├── 标题完全匹配        → +1.0
      ├── 标题分词匹配        → +0.2 / 词
      ├── 描述分词匹配        → +0.08 / 词
      ├── 影响提示匹配        → +0.2
      └── 关键词库匹配        → +0.28 / 词
        ↓
    最高分 ≥ 0.55 且领先第二名 ≥ 0.12？
      ├── 是 → 匹配成功（status: resolved）
      └── 否 → 降级为安全选项（status: fallback）
```

**关键词库**（每个选项映射约 7 个中文关键词）：

| 选项 | 关键词示例 |
|------|-----------|
| examine_evidence | 证据链、复核、审查、核实、校验 |
| cross_examine | 交叉质证、追问、反问、矛盾 |
| file_motion | 程序、异议、动议、抗辩 |
| private_probe | 暗访、线人、走访、私下 |
| media_guidance | 媒体、舆论、记者、引导 |

---

## 5. 游戏引擎详解

### 5.1 五维数值系统

所有数值每轮根据玩家选择确定性变化，有严格边界：

| 数值 | 范围 | 含义 |
|------|------|------|
| truthScore | 0-100 | 真相分：玩家论述与事实的吻合度 |
| judgeTrust | 0-100 | 法官信任：法官对辩护方论点的采信程度 |
| juryBias | -100 ~ 100 | 陪审偏见：负值有利被告，正值有利控方 |
| publicPressure | 0-100 | 舆论压力：媒体和公众对案件的关注度 |
| evidenceIntegrity | 0-100 | 证据完整度：证据链的可靠性与覆盖度 |

### 5.2 选项系统

每轮提供 3 个选项，从 8 个基础选项中轮转选取（避免重复）：

| 选项 ID | 名称 | 核心效果 |
|---------|------|---------|
| examine_evidence | 复核关键证据 | truthScore +6, evidenceIntegrity +8 |
| cross_examine | 交叉质证 | judgeTrust +5, truthScore +4, 可触发证人关系变化 |
| timeline_rebuild | 重构案发时间线 | evidenceIntegrity +6, truthScore +5 |
| file_motion | 提出程序异议 | judgeTrust +7, juryBias -6 |
| private_probe | 庭外暗线追查 | truthScore +8, publicPressure +6, 命运阻力 +6 |
| media_guidance | 引导舆论风向 | publicPressure -7, juryBias -3 |
| stabilize_court | 庭审秩序稳控 | 条件触发：publicPressure ≥ 70 时出现 |
| challenge_forensics | 质疑争议鉴定 | 条件触发：forgedEvidenceAdmitted 为 true 时出现 |

### 5.3 证据系统

初始 3 份证据，游戏过程中动态增加：

| 证据 | 可信度 | 状态 | 备注 |
|------|--------|------|------|
| 江景台原始监控录像 | 56 | 未验证 | 缺失关键 43 秒 |
| 120 急救电话录音 | 52 | 未验证 | 通话时间与报案时间差 7 分钟 |
| 第一份法医意见书 | 44 | 已质疑 | 缺少原始样本 |
| 跨江收费站过闸记录 | 63 | 未验证 | 第 4 轮自动加入 |

每轮根据选项效果调整证据的可信度（+3 ~ +5）和状态。

### 5.4 NPC 关系系统

4 个核心 NPC，各有信任值和立场：

| NPC | 初始信任 | 初始立场 |
|-----|---------|---------|
| 主控检察官 | 30 | 敌对 |
| 主审法官 | 50 | 中立 |
| 关键证人 | 35 | 中立 |
| 调查员老徐 | 55 | 盟友 |

立场规则：信任 ≥ 62 → 盟友，信任 ≤ 32 → 敌对，其余中立。

### 5.5 里程碑事件

| 触发条件 | 事件 |
|---------|------|
| 第 4 轮 | 新增"跨江收费站过闸记录"证据 |
| 第 7 轮 + truthScore ≥ 62 | 关键证人反转（信任 +12，标记 keyWitnessFlipped） |
| 第 10 轮 + evidenceIntegrity ≤ 50 | 伪造证据被采纳（标记 forgedEvidenceAdmitted） |
| 第 16 轮 + publicPressure ≥ 74 | 外部权力干预暴露（标记 interferenceDetected） |

### 5.6 判决走向系统

实时根据五维数值评估当前判决倾向：

| 判决走向 | 条件 |
|---------|------|
| truth（真相大白） | truthScore ≥ 78 且 evidenceIntegrity ≥ 72 且无伪证 |
| interference（权力干预） | interferenceDetected 或 publicPressure ≥ 85 |
| misled（被误导） | forgedEvidenceAdmitted 或 (truthScore < 60 且 juryBias > 18) |
| wrongful（冤案） | truthScore ≤ 45 或 evidenceIntegrity ≤ 40 或 judgeTrust ≤ 35 |
| undetermined（未定） | 以上均不满足 |

### 5.7 重生系统

**触发条件**：回合 ≥ 6 且 判决走向为 wrongful/misled/interference 且 命运阻力 ≥ 88

**重生时发生的变化**：

```
周目 +1
记忆保留率 -6%（下限 30%）
已知真相按保留率截断（至少保留 1 条）
命运阻力 -24（下限 30）
五维数值向初始值回归（取当前值与默认值的平均）
部分标记重置
```

**命运阻力变化表**：

| 选项 | 阻力变化 |
|------|---------|
| private_probe | +6 |
| cross_examine | +4 |
| file_motion | +2 |
| stabilize_court | -4 |
| media_guidance | -3 |
| examine_evidence / challenge_forensics | -2 ~ -3 |

### 5.8 结局系统

游戏在以下条件结束：
- 回合达到 50（最大回合数）
- 回合 ≥ 30 且 truthScore ≥ 78 且 evidenceIntegrity ≥ 72 且判决走向为 truth（提前胜利）

四种结局：

| 结局 | 描述 |
|------|------|
| truth | "无罪。" — 证据链闭合，真相胜出 |
| wrongful | "有罪。" — 证据链断裂，冤案未能翻转 |
| misled | 被伪造的时间线或证据误导，错误定罪 |
| interference | 外部权力干预，真相被掩盖 |

每种结局在第一周目和后续周目有不同叙事文本。

---

## 6. 记忆系统

### 6.1 三层记忆架构

```
┌────────────────────────────────────────────┐
│  短期记忆 shortWindow                       │
│  最近 6 轮叙事原文，每轮更新                   │
│  用途：提供近期上下文                         │
├────────────────────────────────────────────┤
│  中期记忆 midSummary                        │
│  每 5 轮生成一条摘要，保留最近 10 条            │
│  用途：跨阶段叙事连贯                         │
├────────────────────────────────────────────┤
│  长期锚点 longAnchors                       │
│  关键事件触发写入，最多 8 条                   │
│  用途：核心里程碑不被遗忘                      │
└────────────────────────────────────────────┘
```

### 6.2 重生记忆

| 字段 | 说明 |
|------|------|
| loop | 当前周目数 |
| memoryRetention | 记忆保留率（0.3 ~ 0.9），每次重生 -0.06 |
| knownTruths | 跨周目保留的已知真相（最多 8 条），重生时按保留率截断 |
| fate | 命运阻力值（30 ~ 100），越高越接近重生触发 |

已知真相来源：

| 游戏事件 | 写入的真相 |
|---------|-----------|
| clue_confirmed | 关键证据缺口被补齐，真实作案路径浮现 |
| witness_flip | 关键证人的原始口供存在保留或误导 |
| forensics_rebuttal | 争议鉴定结果并非唯一解释 |
| interference_confirmed | 案件存在场外力量干预 |

### 6.3 记忆持久化

每轮结束后，记忆被写入 `data/{sessionId}.md` 文件，格式化为人和 LLM 均可读的 Markdown：

```markdown
# 游戏记忆 — 林辩

> Session: `abc-123`
> 更新时间: 2026-04-15T10:30:00.000Z

## 基本信息
| 项目 | 值 |
|------|-----|
| 回合 | 12 |
| 章节 | 第2章 — 前案重演 |
| 周目 | 1 |
| 记忆保留率 | 60% |
| 命运阻力 | 72 |

## 短期记忆（最近叙事）
### 片段 1
我站在法庭中央...

## 中期记忆（阶段摘要）
1. 开庭阶段完成，初步掌握案件脉络

## 长期锚点（关键事件）
- 核心目标：不暴露重生记忆，靠证据链改写判决结果

## 已知真相（跨周目保留）
- 林策并非直接致死者
```

---

## 7. 存储系统

### 7.1 仓储接口

```typescript
type GameRepository = {
  createSessionId(): Promise<string>;
  getSession(sessionId: string): Promise<GameState | undefined>;
  upsertSession(state: GameState): Promise<void>;
  createSave(sessionId: string, state: GameState): Promise<SaveSnapshot>;
  getSave(saveId: string): Promise<SaveSnapshot | undefined>;
};
```

### 7.2 三种实现

| 模式 | 触发条件 | 存储位置 | 重启后 |
|------|---------|---------|--------|
| **file**（默认） | `MONGODB_URI` 未配置 | `data/sessions/*.json` + `data/saves/*.json` | 数据保留 |
| **mongodb** | 配置了 `MONGODB_URI` | `sessions` + `saves` 集合 | 数据保留 |
| memory（保留） | 仅开发调试用 | 内存 Map | 数据丢失 |

### 7.3 数据目录

```
data/
├── sessions/           # 完整 GameState（JSON），每轮覆盖更新
│   └── {sessionId}.json
├── saves/              # 存档快照（JSON），手动创建
│   └── {saveId}.json
└── {sessionId}.md      # 记忆 Markdown，每轮覆盖更新
```

### 7.4 存档与恢复

- **存档**：`POST /sessions/:id/save` → 快照当前完整 GameState 到 `data/saves/`
- **读档**：`POST /sessions/load` → 从快照创建新会话（新 sessionId），原会话不受影响
- **页面刷新恢复**：前端将 sessionId 存入 localStorage，刷新后通过 `GET /sessions/:id/state` 恢复

---

## 8. LLM 叙事润色

### 8.1 工作方式

LLM 润色是可选功能，关闭时游戏使用规则引擎的模板叙事，功能完整不受影响。

```
规则引擎输出（模板叙事 + 数值变化 + 事件）
        ↓
LlmNarrativeService.enhanceTurn()
        ↓
    构建 JSON 输入：{ turn, progress, base_narrative, base_summary,
                     stat_changes, events, verdict_outlook }
        ↓
    调用 OpenAI 兼容 API（system prompt + user payload）
        ↓
    解析 JSON 响应：{ narrative, summary }
        ↓
    回写到 GameState（currentNarrative, historySummaries, memory）
```

### 8.2 System Prompt 要求

- 只做语言表达优化，不改变状态含义
- 必须第一人称"我"视角，3-6 句叙事 + 1 句摘要
- 不得引入输入中不存在的事实、证据、人物
- 不得将"重生记忆"当作可采信证据
- 输出纯 JSON，无 Markdown 包裹

### 8.3 容错机制

| 机制 | 配置 | 行为 |
|------|------|------|
| 软超时 | `LLM_SOFT_TIMEOUT_MS=4000` | 超时立即终止请求，回退规则输出 |
| 连续失败熔断 | `LLM_MAX_CONSECUTIVE_FAILURES=2` | 连续失败 2 次进入冷却期 |
| 熔断冷却 | `LLM_COOLDOWN_MS=180000` | 冷却 3 分钟内跳过所有 LLM 调用 |
| 输出裁剪 | — | 叙事超 1200 字截断，摘要超 220 字截断 |

---

## 9. API 接口与 SSE 事件

### 9.1 REST 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| POST | `/sessions` | 创建会话，返回 `{ sessionId }` |
| POST | `/sessions/:id/init` | 初始化角色，body: `{ name, role, talent, starterItem }` |
| POST | `/sessions/:id/actions` | 提交动作（SSE 流式响应），body: `{ choiceId }` 或 `{ userInput }` |
| GET | `/sessions/:id/state` | 获取完整游戏状态 |
| POST | `/sessions/:id/save` | 创建存档，返回 `{ saveId, sessionId, createdAt }` |
| POST | `/sessions/load` | 读取存档，body: `{ saveId }`，返回新 sessionId |
| GET | `/sessions/:id/replay` | 获取回放日志与 Token 汇总 |

### 9.2 SSE 事件流（actions 接口）

提交动作后，服务端通过 SSE 按以下顺序推送事件：

| 事件名 | 数据 | 说明 |
|--------|------|------|
| `input_feedback` | InputFeedback 对象 | 输入解析结果（匹配/降级/无效） |
| `narrative_delta` | `{ text }` | 叙事文本片段（34 字/块，80ms 间隔，打字机效果） |
| `choices` | Choice[] | 本轮可用选项列表 |
| `state_patch` | 数值/标记/证据/NPC/判决/重生等 | 状态变化快照 |
| `progress` | Progress 对象 | 当前章节/场景进度 |
| `token_usage` | TokenUsage 对象 | 本轮 Token 消耗估算 |
| `done` | `{ summary }` | 本轮完成信号 + 回合摘要 |
| `game_over` | `{ endingType, endingNarrative }` | 游戏结束（仅在结局时发送） |

---

## 10. 前端实现

### 10.1 核心组件

前端为单页 React 应用（`App.tsx`），包含：

- **标题栏**：游戏名称"逆判：重生证词"、当前进度、连接状态
- **案件简报面板**：玩家姓名输入、角色初始化
- **叙事区域**：滚动展示累积叙事文本，SSE 打字机效果
- **策略选项面板**：3 个可点击选项卡片 + 自然语言输入框
- **状态面板**：五维数值条、证据列表、NPC 关系、判决走向指示器
- **重生信息**：周目数、记忆保留率、命运阻力、已知真相列表
- **操作按钮**：存档 / 读档 / 回放

### 10.2 SSE 流式处理

```
前端发起 POST /sessions/:id/actions
        ↓
    读取 SSE 流，逐事件解析
        ↓
    narrative_delta → 推入字符队列
        ↓
    16ms 定时器逐字弹出 → 打字机效果渲染
        ↓
    done 事件 → 固化叙事到历史记录，清空流式缓冲
```

### 10.3 本地状态持久化

- sessionId 存入 `localStorage`（key: `agentic-game-session-id`）
- 页面刷新后自动调用 `GET /sessions/:id/state` 恢复游戏进度

---

## 11. 环境变量

### Backend (`backend/.env`)

| 变量名 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `4000` | 后端服务端口 |
| `MONGODB_URI` | 空 | MongoDB 连接串；为空时使用文件仓储 |
| `MONGODB_DB_NAME` | `agentic_game` | MongoDB 数据库名 |
| `MONGODB_STRICT` | `false` | `true` 时 Mongo 连接失败阻止启动；`false` 时回退文件仓储 |
| `LLM_ENABLED` | `false` | 是否启用 LLM 叙事润色 |
| `OPENAI_BASE_URL` | `https://dashscope.aliyuncs.com/compatible-mode/v1` | OpenAI 兼容 API 地址 |
| `OPENAI_API_KEY` | 空 | API Key |
| `OPENAI_MODEL` | `qwen3.5-plus` | 模型名 |
| `OPENAI_TEMPERATURE` | `0.7` | 采样温度 |
| `OPENAI_TIMEOUT_MS` | `30000` | LLM 请求超时（毫秒） |
| `LLM_SOFT_TIMEOUT_MS` | `4000` | 单次润色软超时 |
| `LLM_MAX_CONSECUTIVE_FAILURES` | `2` | 连续失败熔断阈值 |
| `LLM_COOLDOWN_MS` | `180000` | 熔断冷却时长 |

### Frontend (`frontend/.env`)

| 变量名 | 默认值 | 说明 |
|---|---|---|
| `VITE_API_BASE_URL` | `http://localhost:4000` | 后端地址 |

---

## 12. 稳定性设计

项目目标：**可稳定运行 50+ 回合不崩溃**。

| 设计 | 实现 |
|------|------|
| 引擎确定性 | 规则引擎不依赖 LLM，纯数值计算，保证每轮必有可用输出 |
| LLM 降级 | 软超时 + 熔断机制，LLM 故障不影响游戏流程 |
| 异常恢复 | 引擎异常时自动切换保底叙事 + 3 个安全选项，不中断游戏 |
| 上下文控制 | 三层记忆分层管理，短期 6 轮、中期 10 条、长期 8 条，防止无限膨胀 |
| 状态持久化 | 每轮写入文件仓储，页面刷新 / 服务重启不丢数据 |
| 防鬼打墙 | 选项轮转 + 去重 + 里程碑事件推进，避免重复循环 |
| Token 估算 | 基于记忆长度估算每轮消耗，回放接口提供汇总统计 |
