# Harness

Agent 工程平台，用于构建可控、可观测、可治理、可长期运行的 AI Agent。

不是聊天机器人，而是让 Agent 具备生产级能力的基础设施。

## 核心能力

- **Agent 编排** — 基于 LangGraph 的状态图执行引擎
- **工具调用 (MCP)** — 统一的 Model Context Protocol 工具端点
- **记忆系统** — 短期、工作、长期、语义、程序多层记忆
- **上下文工程** — 结构化上下文注入与管理
- **人机协作 (HITL)** — 中断与审批流程
- **评估** — Agent 质量基准测试
- **可观测性** — OpenTelemetry + 结构化日志
- **治理** — 工具调用审计与策略控制

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

## 项目结构

```
apps/
  web/           # Next.js 控制台
  gateway/       # MCP Gateway
  worker/        # Agent Worker

packages/
  agents/        # LangGraph agent 定义
  tools/         # MCP 工具定义和适配器
  memory/        # 记忆抽象层
  evals/         # 评估框架
  prompts/       # Prompt 模板
  shared/        # 共享类型、工具函数、常量

infra/
  docker/        # Dockerfile、compose 配置
  k8s/           # Kubernetes 清单
```

## 快速开始

```bash
# 安装依赖
pnpm install

# 启动基础设施
docker compose up -d

# 开发
pnpm dev
```

## 开发命令

```bash
pnpm dev                              # 所有应用
pnpm --filter @harness/web dev        # Next.js 控制台
pnpm --filter @harness/gateway dev    # MCP Gateway
pnpm --filter @harness/worker dev     # Agent Worker

pnpm build                            # 构建
pnpm lint                             # 代码检查
pnpm typecheck                        # 类型检查
pnpm test                             # 全部测试

pnpm db:generate                      # 生成迁移
pnpm db:migrate                       # 执行迁移
pnpm db:push                          # 推送 schema
```

## 开发阶段

- **Phase 1** — 单 Agent + 工具调用：LangGraph 基础、MCP 集成、简单 Next.js 控制台
- **Phase 2** — 记忆、checkpoint、人工审批、工具治理
- **Phase 3** — 多 Agent、评估、规划、自主循环

## License

MIT
