# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在本仓库中工作时提供指导。

## 项目概述

Harness — Agent 工程平台，用于构建可控、可观测、可治理、可长期运行的 AI Agent。不是聊天机器人，而是让 Agent 具备生产级能力的基础设施。

核心能力：Agent 编排、工具调用 (MCP)、记忆系统、上下文工程、人机协作 (HITL)、评估、可观测性、治理。

**所有回答请使用中文。**

## 技术栈

| 层级 | 技术 |
|------|------|
| 运行时 | Node.js 22+, TypeScript, pnpm |
| Agent 编排 | LangGraph.js, LangChain.js |
| 工具协议 | MCP SDK (Model Context Protocol) |
| 前端控制台 | Next.js, Tailwind CSS, shadcn/ui, React Flow |
| 数据库 | PostgreSQL, Drizzle ORM, pgvector |
| 缓存/队列 | Redis |
| 可观测性 | OpenTelemetry, Pino |
| 部署 | Docker Compose (开发), Kubernetes (生产) |
| 模型层 | Provider 无关 (Anthropic, OpenAI, OpenRouter) |

## 常用命令

```bash
# 安装依赖
pnpm install

# 开发（所有应用）
pnpm dev

# 开发（单个应用）
pnpm --filter @harness/web dev        # Next.js 控制台
pnpm --filter @harness/gateway dev    # MCP Gateway
pnpm --filter @harness/worker dev     # Agent Worker

# 构建
pnpm build

# 代码检查 & 类型检查
pnpm lint
pnpm typecheck

# 测试
pnpm test                             # 全部测试
pnpm test --filter @harness/agents    # 按包运行
pnpm test -- --run src/agents/graph.test.ts  # 单文件

# 数据库
pnpm db:generate                      # 生成 Drizzle 迁移
pnpm db:migrate                       # 执行迁移
pnpm db:push                          # 推送 schema（开发快捷方式）

# Docker
docker compose up -d                  # 启动基础设施（Postgres, Redis）
docker compose -f docker/docker-compose.yml up  # 完整启动
```

## 架构

Monorepo，由 pnpm workspaces 管理：

```
apps/
  web/           # Next.js 控制台 — 仪表盘、Trace 查看器、Memory 查看器、
                 # 工具日志、人工审批 UI、工作流编辑器 (React Flow)
  gateway/       # MCP Gateway — 统一工具端点，将工具调用路由到
                 # 已注册的 MCP 服务（IDE、浏览器、Figma、GitHub 等）
  worker/        # Agent Worker — 执行 LangGraph agent run，消费
                 # 任务队列，管理长时间运行/可持久化的执行

packages/
  agents/        # LangGraph agent 定义 — 状态图、节点函数、
                 # 工具路由、interrupt/HITL 逻辑
  tools/         # MCP 工具定义和适配器 — 将外部服务
                 # 包装为 MCP 兼容工具
  memory/        # 记忆抽象层 — 短期（会话）、工作记忆
                 # （任务状态）、长期（用户）、语义（向量）、程序（SOP）
  evals/         # 评估框架 — agent 基准测试、质量指标
  prompts/       # Prompt 模板 — 版本化、参数化
  shared/        # 共享类型、工具函数、常量

infra/
  docker/        # Dockerfile、compose 配置
  k8s/           # Kubernetes 清单（后期）
```

### 关键设计决策

- **Provider 抽象**：不绑定单一 LLM。使用 provider 接口，可在 Anthropic、OpenAI、OpenRouter 之间切换。
- **MCP 作为工具标准**：所有外部工具集成通过 MCP 进行，Gateway 作为统一工具端点。
- **LangGraph 做编排**：状态图 + checkpoint + durable execution + interrupt（HITL）+ 流式输出。
- **Drizzle 而非 Prisma**：更适合基础设施项目 — 更轻量、SQL 更透明、迁移控制更好。
- **pgvector 而非 Pinecone**：先保持简单，向量搜索就在 Postgres 里，规模不够再换。
- **分层记忆**：不同记忆类型服务不同的时间和语义目的。上下文工程 > Prompt 工程。

### Agent 执行流程

```
用户/触发器
  → Worker 接收任务
    → LangGraph 状态图执行
      → 节点通过 MCP Gateway 调用工具
      → 通过 memory 包读写记忆
      → interrupt 用于人工审批（HITL）
      → checkpoint 用于可恢复执行
    → 结果持久化 + 流式推送到前端
  → 控制台展示 trace、工具日志、memory 差异
```

## 开发阶段

### Phase 1 ✅ — 单 Agent + 工具调用

已完成：
- Monorepo 基础设施（pnpm workspace、TypeScript strict、路径别名）
- 共享层（类型定义、Pino 日志、工具函数）
- Provider 抽象层（Anthropic/OpenAI/OpenRouter）
- LangGraph Agent 状态图（agent → tool → agent 循环）
- MCP 工具集成（计算器、天气查询示例工具）
- Agent Worker（Hono HTTP API，端口 3001）
- MCP Gateway（统一工具端点，端口 3002）
- Next.js 控制台（聊天界面，端口 3000）
- Prompt 模板版本化

启动方式：
```bash
# 配置环境变量（在 apps/worker/.env 中）
LLM_PROVIDER=openai
LLM_API_KEY=your-api-key
LLM_BASE_URL=https://api.example.com/v1
LLM_MODEL=your-model

pnpm dev:worker   # 启动 Worker (端口 3001)
pnpm dev:gateway  # 启动 Gateway (端口 3002)
pnpm dev:web      # 启动 Web 控制台 (端口 3000)
```

测试验证：
```
Worker 健康检查  ✅ GET  http://localhost:3001/health
Gateway 健康检查 ✅ GET  http://localhost:3002/health
Gateway 工具列表 ✅ GET  http://localhost:3002/tools

Agent 计算器测试 ✅ POST http://localhost:3001/run
  输入: "计算 2 + 3 * 4"
  流程: Agent → 调用 calculator 工具 → 返回 14
  输出: "按照运算优先级，先计算乘法：3×4=12，再计算加法：2+12=14"

Agent 天气查询测试 ✅ POST http://localhost:3001/run
  输入: "北京今天的天气怎么样？"
  流程: Agent → 调用 weather 工具 → 返回天气数据
  输出: "今天北京天气很好！温度22°C，湿度45%，晴"

Gateway 工具直调 ✅ POST http://localhost:3002/tools/calculator
  输入: {"input": {"expression": "10 * 5 + 3"}}
  输出: "10 * 5 + 3 = 53" (耗时 4ms)
```

### Phase 2 — 记忆与持久化

计划：
- 数据库集成（PostgreSQL + Drizzle ORM + pgvector）
- 记忆系统（短期、工作、长期、语义记忆）
- Checkpoint / 可恢复执行
- 人工审批 (HITL) UI
- 工具调用审计与治理

### Phase 3 — 多 Agent 与自主

计划：
- 多 Agent 编排与协作
- 评估框架（Agent 基准测试、质量指标）
- 规划与自主循环
- 工作流编辑器 (React Flow)
- Trace 查看器与可观测性增强

## 开发规范

- 严格 TypeScript（`strict: true`）。禁止 `any`。
- 路径别名：`@harness/agents`、`@harness/tools` 等，在 tsconfig 中映射。
- Drizzle schema 文件放在 `packages/shared/src/db/schema/`。
- Agent 图定义在 `packages/agents/src/graphs/`，每个图一个文件。
- MCP 工具定义在 `packages/tools/src/`，按领域分组。
- Prompt 模板是 `packages/prompts/` 中的版本化文件，不写内联字符串。
- 使用 Pino 做结构化日志。生产代码禁止 `console.log`。
- OpenTelemetry span 包裹 agent run、工具调用、记忆操作。
