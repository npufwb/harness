# Phase 2 设计文档 — 记忆、持久化与人机协作

日期: 2026-05-22
状态: 已批准

## 概述

Phase 2 为 Harness 平台引入数据库持久化、记忆系统、可恢复执行、人工审批和工具调用审计。基于方案 A（完全依赖 LangGraph 生态），使用 LangGraph 原生的 PostgresSaver + interrupt 机制。

## 范围

1. 数据库集成（PostgreSQL + Drizzle ORM）
2. 记忆系统（短期、工作、长期记忆）
3. Checkpoint / 可恢复执行（LangGraph PostgresSaver）
4. HITL 人工审批（工具触发 + 规则触发，嵌入聊天流）
5. 工具调用审计日志

## 架构

### 包依赖关系

```
shared (db, types, logger, governance)
  ↑
memory (记忆系统，依赖 shared 的 db)
  ↑
tools (MCP 工具，依赖 shared 的类型)
  ↑
agents (LangGraph 图，依赖 memory, tools, shared)
  ↑
worker (Hono 服务，依赖 agents, memory)
gateway (Hono 服务，依赖 tools, shared 的审计)
web (Next.js，依赖 worker API)
```

### 执行流程

```
用户发送消息
  → Web (SSE) → Worker
    → 生成 thread_id（或恢复已有）
    → 加载短期记忆（messages 表）
    → 注入 system prompt + 历史消息
    → LangGraph 图执行（带 PostgresSaver）
      → Agent 节点：调用 LLM
        → 有工具调用？
          → 检查 HITL（工具配置 + 规则引擎）
            → 需要审批 → interrupt()，SSE 推送 approval_needed
            → 不需要 → 执行工具
          → Gateway 执行工具 → 写审计日志
          → 结果返回 Agent 节点
      → 循环直到无工具调用
    → 保存消息到短期记忆
    → 返回结果
  → Web 展示

用户审批（中断后）
  → Web → Worker /run/approve
    → Command resume → LangGraph 从 checkpoint 恢复
    → 继续执行被中断的工具调用
```

---

## 第一部分：数据库基础设施

### 新增依赖

- `drizzle-orm` + `drizzle-kit` — ORM 和迁移工具
- `postgres` — PostgreSQL 驱动（Drizzle 推荐）

### 目录结构

```
packages/shared/src/db/
  index.ts          # 数据库连接（导出 drizzle 实例）
  schema/
    sessions.ts     # 会话表
    messages.ts     # 消息历史表
    memories.ts     # 长期记忆表
    tool-audit.ts   # 工具调用审计表
```

### 数据库连接

```typescript
// packages/shared/src/db/index.ts
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

const client = postgres(process.env.DATABASE_URL!)
export const db = drizzle(client)
```

### 环境变量

```
DATABASE_URL=postgresql://user:password@localhost:5432/harness
```

### 迁移策略

用 `drizzle-kit generate` 生成迁移文件，`drizzle-kit push` 开发时快速同步。

---

## 第二部分：记忆系统

### 新增包

`packages/memory/`

### 三种记忆类型

| 类型 | 用途 | 存储方式 | 生命周期 |
|------|------|----------|----------|
| 短期记忆 | 会话内消息历史 | `messages` 表，按 thread_id 查询 | 会话结束可归档 |
| 工作记忆 | 任务执行状态 | LangGraph checkpoint（PostgresSaver） | 任务完成即释放 |
| 长期记忆 | 用户偏好、事实 | `memories` 表，KV 结构 | 永久 |

### 记忆包接口

```typescript
// packages/memory/src/types.ts
export interface MemoryEntry {
  namespace: string
  key: string
  value: string
  updatedAt: Date
}

// packages/memory/src/index.ts
export interface MemoryStore {
  // 短期记忆
  getMessages(threadId: string): Promise<Message[]>
  addMessage(threadId: string, message: Message): Promise<void>

  // 长期记忆
  getMemory(namespace: string, key: string): Promise<string | null>
  setMemory(namespace: string, key: string, value: string): Promise<void>
  listMemories(namespace: string): Promise<MemoryEntry[]>
  deleteMemory(namespace: string, key: string): Promise<void>
}
```

### namespace 设计

- `user:{userId}` — 用户偏好
- `agent:{agentId}` — Agent 级别记忆

### 与 Agent 图的集成

Agent 节点在执行前从短期记忆加载历史消息，执行后将新消息写入。长期记忆通过专门的工具（`memory_get`、`memory_set`）暴露给 Agent。

---

## 第三部分：Checkpoint / 可恢复执行

### 核心

用 LangGraph 的 `PostgresSaver` 作为 checkpointer。

### 改动点

`packages/agents/src/graphs/basic.ts` — 编译图时传入 checkpointer：

```typescript
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres'

const checkpointer = new PostgresSaver(db)
const graph = new StateGraph(AgentStateAnnotation)
  // ... 节点和边定义不变
  .compile({ checkpointer })
```

### Thread 概念

每次 Agent 执行关联一个 `thread_id`（即 session_id）。LangGraph 自动在每个节点执行后保存 checkpoint。如果执行中断（网络断开、进程崩溃），可以用同一个 thread_id 恢复。

### Worker 改动

- `/run` 和 `/run/stream` 接口新增可选参数 `thread_id`
- 如果传入 thread_id，从 checkpoint 恢复执行
- 如果不传，生成新的 thread_id（当前行为）

### 新增依赖

- `@langchain/langgraph-checkpoint-postgres` — LangGraph 官方 PostgreSQL checkpointer

---

## 第四部分：HITL（人工审批）

### 1. 按工具触发

在工具定义中新增 `requiresApproval` 字段：

```typescript
// packages/tools/src/definitions/index.ts
export interface ToolDefinition {
  name: string
  description: string
  parameters: JSONSchema
  handler: (params: any) => Promise<string>
  requiresApproval?: boolean
}
```

治理配置文件 `apps/worker/governance.json`：

```json
{
  "approvalRequired": ["send_email", "delete_file", "execute_code"]
}
```

Worker 启动时加载此文件，运行时可通过 API 热更新。

### 2. 按规则触发

规则引擎接口：

```typescript
// packages/shared/src/governance/rules.ts
export interface ApprovalRule {
  name: string
  condition: (toolCall: ToolCall, context: any) => boolean
}

// 内置规则示例
export const sensitiveDataRule: ApprovalRule = {
  name: 'sensitive-data',
  condition: (toolCall) => {
    return /password|secret|token/i.test(JSON.stringify(toolCall.arguments))
  }
}
```

### 执行流程

在 Agent 图的 `toolExecutor` 节点中，执行工具前检查：

1. 工具是否在 `approvalRequired` 列表中
2. 是否有规则匹配

如果需要审批 → 调用 LangGraph 的 `interrupt()`，将工具调用信息保存到 checkpoint，SSE 推送 `approval_needed` 事件给前端。

### 前端审批卡片

在聊天流中嵌入审批卡片：

```typescript
// 新组件：ApprovalCard
interface ApprovalCardProps {
  toolName: string
  arguments: Record<string, any>
  reason: string  // 为什么需要审批（工具配置 or 规则匹配）
  onApprove: () => void
  onReject: () => void
}
```

用户点击批准/拒绝后，通过 API 调用 Worker，Worker 用 `Command` 恢复 LangGraph 执行。

### 新增 API 端点

```
POST /run/approve   # 批准（传入 thread_id + interrupt_id）
POST /run/reject    # 拒绝（传入 thread_id + interrupt_id + reason）
```

---

## 第五部分：工具调用审计

### 数据表

`tool_audit_logs`：

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| thread_id | UUID | 会话 ID |
| trace_id | UUID | 追踪 ID |
| tool_name | TEXT | 工具名 |
| arguments | JSONB | 调用参数 |
| result | TEXT | 返回结果 |
| status | TEXT | success / error / rejected |
| duration_ms | INTEGER | 耗时 |
| approval | TEXT | auto / approved / rejected |
| approver | TEXT | 审批人 |
| created_at | TIMESTAMPTZ | 创建时间 |

### 写入时机

在 Gateway 的 `ToolRegistry.execute()` 中，每次工具调用完成后写入审计日志。无论成功、失败还是被拒绝，都记录。

### 查询接口

Worker 新增 `/audit` 端点：

```
GET /audit?thread_id=xxx    # 按会话查
GET /audit?tool_name=xxx    # 按工具名查
GET /audit?limit=50&offset=0  # 分页
```

---

## 新增文件清单

### packages/shared/src/db/

- `index.ts` — 数据库连接
- `schema/sessions.ts` — 会话表
- `schema/messages.ts` — 消息历史表
- `schema/memories.ts` — 长期记忆表
- `schema/tool-audit.ts` — 审计表

### packages/shared/src/governance/

- `rules.ts` — 规则引擎接口和内置规则
- `config.ts` — 治理配置加载

### packages/memory/src/

- `index.ts` — 导出
- `store.ts` — MemoryStore 实现
- `types.ts` — 类型定义

### packages/agents/src/graphs/

- `basic.ts` — 改动：加 checkpointer + interrupt 逻辑

### apps/worker/

- `governance.json` — 治理配置文件
- `src/routes/audit.ts` — 审计查询路由
- `src/routes/approve.ts` — 审批路由

### apps/gateway/src/

- `registry.ts` — 改动：加审计写入

### apps/web/src/components/

- `approval-card.tsx` — 审批卡片组件

## 新增依赖

| 包 | 用途 |
|----|------|
| `drizzle-orm` | ORM |
| `drizzle-kit` | 迁移工具 |
| `postgres` | PostgreSQL 驱动 |
| `@langchain/langgraph-checkpoint-postgres` | LangGraph checkpoint |
