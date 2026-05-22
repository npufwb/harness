# Phase 2 实现计划 — 记忆、持久化与人机协作

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Harness 平台引入数据库持久化、记忆系统、可恢复执行、人工审批和工具调用审计。

**Architecture:** 使用 PostgreSQL + Drizzle ORM 做持久化，LangGraph 原生 PostgresSaver 做 checkpoint，interrupt() 做 HITL。记忆系统作为独立包，审计日志在 Gateway 层写入。

**Tech Stack:** PostgreSQL, Drizzle ORM, LangGraph PostgresSaver, Hono, Next.js

---

## 文件结构总览

### 新增文件

| 文件 | 职责 |
|------|------|
| `packages/shared/src/db/index.ts` | 数据库连接，导出 drizzle 实例 |
| `packages/shared/src/db/schema/sessions.ts` | 会话表 schema |
| `packages/shared/src/db/schema/messages.ts` | 消息历史表 schema |
| `packages/shared/src/db/schema/memories.ts` | 长期记忆表 schema |
| `packages/shared/src/db/schema/tool-audit.ts` | 审计日志表 schema |
| `packages/shared/src/db/schema/index.ts` | 导出所有 schema |
| `packages/shared/src/governance/rules.ts` | 规则引擎接口和内置规则 |
| `packages/shared/src/governance/config.ts` | 治理配置加载 |
| `packages/shared/src/governance/index.ts` | 导出 |
| `packages/memory/package.json` | Memory 包配置 |
| `packages/memory/tsconfig.json` | TypeScript 配置 |
| `packages/memory/src/types.ts` | MemoryEntry 类型 |
| `packages/memory/src/store.ts` | MemoryStore 实现 |
| `packages/memory/src/index.ts` | 导出 |
| `apps/worker/governance.json` | 治理配置文件 |
| `apps/worker/src/routes/audit.ts` | 审计查询路由 |
| `apps/worker/src/routes/approve.ts` | 审批路由 |
| `apps/web/src/components/approval-card.tsx` | 审批卡片组件 |

### 修改文件

| 文件 | 改动 |
|------|------|
| `packages/shared/package.json` | 添加 drizzle-orm, postgres 依赖 |
| `packages/shared/src/index.ts` | 导出 db, governance |
| `packages/agents/src/graphs/basic.ts` | 添加 checkpointer + interrupt 逻辑 |
| `packages/agents/package.json` | 添加 @langchain/langgraph-checkpoint-postgres |
| `packages/tools/src/definitions/index.ts` | ToolDefinition 添加 requiresApproval |
| `apps/worker/src/executor.ts` | 集成记忆系统、checkpoint、HITL |
| `apps/worker/src/index.ts` | 添加 approve/audit 路由 |
| `apps/gateway/src/registry.ts` | 添加审计日志写入 |
| `apps/web/src/components/chat-interface.tsx` | 处理 approval_needed 事件 |

---

## Task 1: 数据库基础设施

**Files:**
- Modify: `packages/shared/package.json`
- Create: `packages/shared/src/db/index.ts`
- Create: `packages/shared/src/db/schema/sessions.ts`
- Create: `packages/shared/src/db/schema/messages.ts`
- Create: `packages/shared/src/db/schema/memories.ts`
- Create: `packages/shared/src/db/schema/tool-audit.ts`
- Create: `packages/shared/src/db/schema/index.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: 添加依赖**

```bash
cd D:/aicode/harness
pnpm --filter @harness/shared add drizzle-orm postgres
pnpm --filter @harness/shared add -D drizzle-kit @types/pg
```

- [ ] **Step 2: 创建数据库连接**

```typescript
// packages/shared/src/db/index.ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

const connectionString = process.env['DATABASE_URL'];
if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is required');
}

const client = postgres(connectionString);
export const db = drizzle(client, { schema });
export type Database = typeof db;
```

- [ ] **Step 3: 创建会话表 schema**

```typescript
// packages/shared/src/db/schema/sessions.ts
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  threadId: text('thread_id').notNull().unique(),
  title: text('title'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
```

- [ ] **Step 4: 创建消息历史表 schema**

```typescript
// packages/shared/src/db/schema/messages.ts
import { pgTable, text, timestamp, uuid, jsonb } from 'drizzle-orm/pg-core';
import { sessions } from './sessions.js';

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  threadId: text('thread_id').notNull().references(() => sessions.threadId),
  role: text('role', { enum: ['user', 'assistant', 'system', 'tool'] }).notNull(),
  content: text('content').notNull(),
  toolCallId: text('tool_call_id'),
  toolCalls: jsonb('tool_calls'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export type MessageRow = typeof messages.$inferSelect;
export type NewMessageRow = typeof messages.$inferInsert;
```

- [ ] **Step 5: 创建长期记忆表 schema**

```typescript
// packages/shared/src/db/schema/memories.ts
import { pgTable, text, timestamp, uuid, uniqueIndex } from 'drizzle-orm/pg-core';

export const memories = pgTable('memories', {
  id: uuid('id').primaryKey().defaultRandom(),
  namespace: text('namespace').notNull(),
  key: text('key').notNull(),
  value: text('value').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('namespace_key_idx').on(table.namespace, table.key),
]);

export type MemoryRow = typeof memories.$inferSelect;
export type NewMemoryRow = typeof memories.$inferInsert;
```

- [ ] **Step 6: 创建审计日志表 schema**

```typescript
// packages/shared/src/db/schema/tool-audit.ts
import { pgTable, text, timestamp, uuid, jsonb, integer } from 'drizzle-orm/pg-core';

export const toolAuditLogs = pgTable('tool_audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  threadId: text('thread_id').notNull(),
  traceId: text('trace_id').notNull(),
  toolName: text('tool_name').notNull(),
  arguments: jsonb('arguments'),
  result: text('result'),
  status: text('status', { enum: ['success', 'error', 'rejected'] }).notNull(),
  durationMs: integer('duration_ms'),
  approval: text('approval', { enum: ['auto', 'approved', 'rejected'] }),
  approver: text('approver'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export type ToolAuditLog = typeof toolAuditLogs.$inferSelect;
export type NewToolAuditLog = typeof toolAuditLogs.$inferInsert;
```

- [ ] **Step 7: 创建 schema 导出文件**

```typescript
// packages/shared/src/db/schema/index.ts
export { sessions, type Session, type NewSession } from './sessions.js';
export { messages, type MessageRow, type NewMessageRow } from './messages.js';
export { memories, type MemoryRow, type NewMemoryRow } from './memories.js';
export { toolAuditLogs, type ToolAuditLog, type NewToolAuditLog } from './tool-audit.js';
```

- [ ] **Step 8: 更新 shared 包导出**

```typescript
// packages/shared/src/index.ts
export * from './types/index.js';
export * from './utils/index.js';
export { createLogger, logger, createTraceLogger } from './logger.js';
export type { LoggerOptions } from './logger.js';
export { db, type Database } from './db/index.js';
export * from './db/schema/index.js';
export * from './governance/index.js';
```

- [ ] **Step 9: 创建 .env 文件并测试连接**

```bash
# 在 apps/worker/.env 中添加
DATABASE_URL=postgresql://user:password@localhost:5432/harness
```

- [ ] **Step 10: 提交**

```bash
git add packages/shared/
git commit -m "feat: add database infrastructure with Drizzle ORM schemas"
```

---

## Task 2: 治理规则引擎

**Files:**
- Create: `packages/shared/src/governance/rules.ts`
- Create: `packages/shared/src/governance/config.ts`
- Create: `packages/shared/src/governance/index.ts`
- Create: `apps/worker/governance.json`

- [ ] **Step 1: 创建规则引擎接口和内置规则**

```typescript
// packages/shared/src/governance/rules.ts
import type { ToolCall } from '../types/index.js';

export interface ApprovalRule {
  name: string;
  description: string;
  condition: (toolCall: ToolCall, context: Record<string, unknown>) => boolean;
}

// 内置规则：敏感数据检测
export const sensitiveDataRule: ApprovalRule = {
  name: 'sensitive-data',
  description: '检测工具调用参数中是否包含敏感信息',
  condition: (toolCall: ToolCall) => {
    const argsStr = JSON.stringify(toolCall.arguments);
    return /password|secret|token|api[_-]?key/i.test(argsStr);
  },
};

// 内置规则列表
export const builtinRules: ApprovalRule[] = [sensitiveDataRule];

// 检查工具调用是否需要审批
export function checkApprovalNeeded(
  toolCall: ToolCall,
  approvalRequiredTools: string[],
  rules: ApprovalRule[],
  context: Record<string, unknown> = {}
): { needed: boolean; reason: string } {
  // 检查工具是否在审批列表中
  if (approvalRequiredTools.includes(toolCall.name)) {
    return {
      needed: true,
      reason: `工具 "${toolCall.name}" 被配置为需要审批`,
    };
  }

  // 检查规则
  for (const rule of rules) {
    if (rule.condition(toolCall, context)) {
      return {
        needed: true,
        reason: `触发规则: ${rule.description}`,
      };
    }
  }

  return { needed: false, reason: '' };
}
```

- [ ] **Step 2: 创建治理配置加载器**

```typescript
// packages/shared/src/governance/config.ts
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { logger } from '../logger.js';
import { builtinRules, type ApprovalRule } from './rules.js';

export interface GovernanceConfig {
  approvalRequired: string[];
  rules: string[];
}

const DEFAULT_CONFIG: GovernanceConfig = {
  approvalRequired: [],
  rules: ['sensitive-data'],
};

export class GovernanceManager {
  private config: GovernanceConfig;
  private rules: ApprovalRule[];
  private configPath: string;

  constructor(configPath?: string) {
    this.configPath = configPath ?? resolve(process.cwd(), 'governance.json');
    this.config = DEFAULT_CONFIG;
    this.rules = [...builtinRules];
    this.loadConfig();
  }

  private loadConfig(): void {
    if (!existsSync(this.configPath)) {
      logger.info({ path: this.configPath }, 'Governance config not found, using defaults');
      return;
    }

    try {
      const raw = readFileSync(this.configPath, 'utf-8');
      this.config = JSON.parse(raw) as GovernanceConfig;
      logger.info({ config: this.config }, 'Governance config loaded');
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error: msg, path: this.configPath }, 'Failed to load governance config');
    }
  }

  reloadConfig(): void {
    this.loadConfig();
  }

  getApprovalRequiredTools(): string[] {
    return this.config.approvalRequired;
  }

  getRules(): ApprovalRule[] {
    return this.rules;
  }

  addRule(rule: ApprovalRule): void {
    this.rules.push(rule);
  }
}
```

- [ ] **Step 3: 创建导出文件**

```typescript
// packages/shared/src/governance/index.ts
export {
  type ApprovalRule,
  sensitiveDataRule,
  builtinRules,
  checkApprovalNeeded,
} from './rules.js';
export { GovernanceManager, type GovernanceConfig } from './config.js';
```

- [ ] **Step 4: 创建 Worker 治理配置文件**

```json
{
  "approvalRequired": [],
  "rules": ["sensitive-data"]
}
```

- [ ] **Step 5: 提交**

```bash
git add packages/shared/src/governance/ apps/worker/governance.json
git commit -m "feat: add governance rules engine with approval config"
```

---

## Task 3: Memory 包 — 类型与接口

**Files:**
- Create: `packages/memory/package.json`
- Create: `packages/memory/tsconfig.json`
- Create: `packages/memory/src/types.ts`
- Create: `packages/memory/src/index.ts`

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "@harness/memory",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "build": "tsc",
    "lint": "eslint src/",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@harness/shared": "workspace:*",
    "drizzle-orm": "^0.35.0",
    "postgres": "^3.4.0"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 2: 创建 tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: 创建类型定义**

```typescript
// packages/memory/src/types.ts
import type { Message } from '@harness/shared';

export interface MemoryEntry {
  namespace: string;
  key: string;
  value: string;
  updatedAt: Date;
}

export interface MemoryStore {
  // 短期记忆
  getMessages(threadId: string): Promise<Message[]>;
  addMessage(threadId: string, message: Message): Promise<void>;

  // 长期记忆
  getMemory(namespace: string, key: string): Promise<string | null>;
  setMemory(namespace: string, key: string, value: string): Promise<void>;
  listMemories(namespace: string): Promise<MemoryEntry[]>;
  deleteMemory(namespace: string, key: string): Promise<void>;
}
```

- [ ] **Step 4: 创建导出文件（暂时只导出类型）**

```typescript
// packages/memory/src/index.ts
export type { MemoryEntry, MemoryStore } from './types.js';
```

- [ ] **Step 5: 安装依赖**

```bash
cd D:/aicode/harness
pnpm install
```

- [ ] **Step 6: 提交**

```bash
git add packages/memory/
git commit -m "feat: create memory package with types and interfaces"
```

---

## Task 4: Memory 包 — 实现

**Files:**
- Create: `packages/memory/src/store.ts`
- Modify: `packages/memory/src/index.ts`

- [ ] **Step 1: 实现 MemoryStore**

```typescript
// packages/memory/src/store.ts
import { eq, and } from 'drizzle-orm';
import { db, messages, memories } from '@harness/shared';
import type { Message } from '@harness/shared';
import type { MemoryEntry, MemoryStore } from './types.js';

export class PostgresMemoryStore implements MemoryStore {
  // 短期记忆
  async getMessages(threadId: string): Promise<Message[]> {
    const rows = await db
      .select()
      .from(messages)
      .where(eq(messages.threadId, threadId))
      .orderBy(messages.createdAt);

    return rows.map((row) => ({
      role: row.role as Message['role'],
      content: row.content,
      ...(row.toolCallId && { toolCallId: row.toolCallId }),
      ...(row.toolCalls && { toolCalls: row.toolCalls as Message['toolCalls'] }),
    }));
  }

  async addMessage(threadId: string, message: Message): Promise<void> {
    await db.insert(messages).values({
      threadId,
      role: message.role,
      content: message.content,
      toolCallId: message.toolCallId ?? null,
      toolCalls: message.toolCalls ?? null,
    });
  }

  // 长期记忆
  async getMemory(namespace: string, key: string): Promise<string | null> {
    const rows = await db
      .select()
      .from(memories)
      .where(and(eq(memories.namespace, namespace), eq(memories.key, key)))
      .limit(1);

    return rows[0]?.value ?? null;
  }

  async setMemory(namespace: string, key: string, value: string): Promise<void> {
    const existing = await this.getMemory(namespace, key);

    if (existing !== null) {
      await db
        .update(memories)
        .set({ value, updatedAt: new Date() })
        .where(and(eq(memories.namespace, namespace), eq(memories.key, key)));
    } else {
      await db.insert(memories).values({ namespace, key, value });
    }
  }

  async listMemories(namespace: string): Promise<MemoryEntry[]> {
    const rows = await db
      .select()
      .from(memories)
      .where(eq(memories.namespace, namespace));

    return rows.map((row) => ({
      namespace: row.namespace,
      key: row.key,
      value: row.value,
      updatedAt: row.updatedAt,
    }));
  }

  async deleteMemory(namespace: string, key: string): Promise<void> {
    await db
      .delete(memories)
      .where(and(eq(memories.namespace, namespace), eq(memories.key, key)));
  }
}
```

- [ ] **Step 2: 更新导出**

```typescript
// packages/memory/src/index.ts
export type { MemoryEntry, MemoryStore } from './types.js';
export { PostgresMemoryStore } from './store.js';
```

- [ ] **Step 3: 类型检查**

```bash
cd D:/aicode/harness
pnpm --filter @harness/memory typecheck
```

- [ ] **Step 4: 提交**

```bash
git add packages/memory/src/
git commit -m "feat: implement PostgresMemoryStore with short-term and long-term memory"
```

---

## Task 5: LangGraph Checkpoint 集成

**Files:**
- Modify: `packages/agents/package.json`
- Modify: `packages/agents/src/graphs/basic.ts`

- [ ] **Step 1: 添加依赖**

```bash
cd D:/aicode/harness
pnpm --filter @harness/agents add @langchain/langgraph-checkpoint-postgres
```

- [ ] **Step 2: 修改 createBasicAgentGraph 支持 checkpointer**

```typescript
// packages/agents/src/graphs/basic.ts
import { StateGraph, END, START } from '@langchain/langgraph';
import { Annotation } from '@langchain/langgraph';
import type { Message, Tool, AgentResult, TokenUsage } from '@harness/shared';
import { logger as defaultLogger, generateId } from '@harness/shared';
import type { Logger } from 'pino';
import type { LLMProvider } from '../provider.js';

// Agent 状态定义
const AgentStateAnnotation = Annotation.Root({
  messages: Annotation<Message[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
  tools: Annotation<Tool[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  currentToolCall: Annotation<Message['toolCalls'] | undefined>({
    reducer: (_prev, next) => next,
    default: () => undefined,
  }),
  result: Annotation<string | undefined>({
    reducer: (_prev, next) => next,
    default: () => undefined,
  }),
  usage: Annotation<TokenUsage | undefined>({
    reducer: (prev, next) => {
      if (!prev) return next;
      if (!next) return prev;
      return {
        promptTokens: prev.promptTokens + next.promptTokens,
        completionTokens: prev.completionTokens + next.completionTokens,
        totalTokens: prev.totalTokens + next.totalTokens,
      };
    },
    default: () => undefined,
  }),
  // HITL: 审批状态
  approvalState: Annotation<{
    needed: boolean;
    toolCall?: Message['toolCalls'];
    reason?: string;
  } | undefined>({
    reducer: (_prev, next) => next,
    default: () => undefined,
  }),
});

type AgentState = typeof AgentStateAnnotation.State;

// 创建 Agent 节点
function createAgentNode(provider: LLMProvider, traceLogger: Logger) {
  return async (state: AgentState): Promise<Partial<AgentState>> => {
    traceLogger.info({ messageCount: state.messages.length }, 'Agent node executing');

    const response = await provider.chat(state.messages, state.tools);

    traceLogger.debug(
      { hasToolCalls: !!response.message.toolCalls?.length, usage: response.usage },
      'Agent response received'
    );

    if (response.message.toolCalls?.length) {
      return {
        messages: [response.message],
        currentToolCall: response.message.toolCalls,
        usage: response.usage,
      };
    }

    return {
      messages: [response.message],
      result: response.message.content,
      currentToolCall: undefined,
      usage: response.usage,
    };
  };
}

// 创建带 HITL 检查的工具节点
function createToolNode(
  toolHandlers: Map<string, (input: unknown) => Promise<string>>,
  traceLogger: Logger,
  approvalChecker?: (toolCall: { id: string; name: string; arguments: Record<string, unknown> }) => { needed: boolean; reason: string }
) {
  return async (state: AgentState): Promise<Partial<AgentState>> => {
    const toolCalls = state.currentToolCall;
    if (!toolCalls?.length) {
      return {};
    }

    traceLogger.info({ toolCount: toolCalls.length }, 'Tool node executing');

    // HITL 检查
    if (approvalChecker) {
      for (const toolCall of toolCalls) {
        const check = approvalChecker(toolCall);
        if (check.needed) {
          traceLogger.info({ toolName: toolCall.name, reason: check.reason }, 'Approval needed');
          return {
            approvalState: {
              needed: true,
              toolCall: [toolCall],
              reason: check.reason,
            },
          };
        }
      }
    }

    const toolMessages: Message[] = [];

    for (const toolCall of toolCalls) {
      const handler = toolHandlers.get(toolCall.name);

      if (!handler) {
        traceLogger.error({ toolName: toolCall.name }, 'Tool not found');
        toolMessages.push({
          role: 'tool',
          content: `Error: Tool "${toolCall.name}" not found`,
          toolCallId: toolCall.id,
        });
        continue;
      }

      try {
        const toolStart = Date.now();
        traceLogger.debug({ toolName: toolCall.name, args: toolCall.arguments }, 'Executing tool');
        const result = await handler(toolCall.arguments);
        const toolDuration = Date.now() - toolStart;
        traceLogger.info({ toolName: toolCall.name, duration: toolDuration }, 'Tool executed');
        toolMessages.push({
          role: 'tool',
          content: result,
          toolCallId: toolCall.id,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        traceLogger.error({ toolName: toolCall.name, error: errorMessage }, 'Tool execution failed');
        toolMessages.push({
          role: 'tool',
          content: `Error: ${errorMessage}`,
          toolCallId: toolCall.id,
        });
      }
    }

    return {
      messages: toolMessages,
      currentToolCall: undefined,
      approvalState: undefined,
    };
  };
}

// 条件边：决定是否继续调用工具
function shouldContinue(state: AgentState): string {
  if (state.approvalState?.needed) {
    return 'waitForApproval';
  }
  if (state.currentToolCall?.length) {
    return 'toolExecutor';
  }
  return END;
}

// 等待审批节点（interrupt）
function createWaitForApprovalNode(traceLogger: Logger) {
  return async (_state: AgentState): Promise<Partial<AgentState>> => {
    traceLogger.info('Waiting for approval (interrupt)');
    // interrupt 会在 graph.invoke 时自动触发
    return {};
  };
}

// 创建基础 Agent 图（支持 checkpoint 和 HITL）
export function createBasicAgentGraph(
  provider: LLMProvider,
  toolHandlers: Map<string, (input: unknown) => Promise<string>>,
  traceLogger: Logger = defaultLogger,
  options?: {
    checkpointer?: unknown;
    approvalChecker?: (toolCall: { id: string; name: string; arguments: Record<string, unknown> }) => { needed: boolean; reason: string };
  }
) {
  const agentNode = createAgentNode(provider, traceLogger);
  const toolNode = createToolNode(toolHandlers, traceLogger, options?.approvalChecker);
  const waitNode = createWaitForApprovalNode(traceLogger);

  const graph = new StateGraph(AgentStateAnnotation)
    .addNode('agent', agentNode)
    .addNode('toolExecutor', toolNode)
    .addNode('waitForApproval', waitNode)
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', shouldContinue, {
      toolExecutor: 'toolExecutor',
      waitForApproval: 'waitForApproval',
      [END]: END,
    })
    .addEdge('toolExecutor', 'agent')
    .addEdge('waitForApproval', 'agent');

  return graph.compile({
    ...(options?.checkpointer ? { checkpointer: options.checkpointer } : {}),
  });
}

// 执行 Agent
export async function runAgent(
  provider: LLMProvider,
  toolHandlers: Map<string, (input: unknown) => Promise<string>>,
  messages: Message[],
  tools: Tool[],
  traceLogger: Logger = defaultLogger,
  options?: {
    checkpointer?: unknown;
    threadId?: string;
    approvalChecker?: (toolCall: { id: string; name: string; arguments: Record<string, unknown> }) => { needed: boolean; reason: string };
  }
): Promise<AgentResult> {
  const graph = createBasicAgentGraph(provider, toolHandlers, traceLogger, {
    checkpointer: options?.checkpointer,
    approvalChecker: options?.approvalChecker,
  });

  try {
    traceLogger.info('Starting agent execution');

    const config = options?.threadId
      ? { configurable: { thread_id: options.threadId } }
      : undefined;

    const result = await graph.invoke(
      { messages, tools },
      config
    );

    traceLogger.info({ usage: result.usage }, 'Agent execution completed');

    return {
      success: true,
      messages: result.messages,
      result: result.result,
      usage: result.usage,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    traceLogger.error({ error: errorMessage }, 'Agent execution failed');

    return {
      success: false,
      messages: [],
      error: errorMessage,
    };
  }
}
```

- [ ] **Step 3: 类型检查**

```bash
cd D:/aicode/harness
pnpm --filter @harness/agents typecheck
```

- [ ] **Step 4: 提交**

```bash
git add packages/agents/
git commit -m "feat: add checkpoint and HITL support to agent graph"
```

---

## Task 6: Worker 集成 — Executor 改造

**Files:**
- Modify: `apps/worker/src/executor.ts`

- [ ] **Step 1: 改造 AgentExecutor 集成记忆和 checkpoint**

```typescript
// apps/worker/src/executor.ts
import { runAgent, createProvider } from '@harness/agents';
import { toolDefinitions, getToolNames } from '@harness/tools';
import { getAgentSystemPrompt } from '@harness/prompts';
import { PostgresMemoryStore } from '@harness/memory';
import { GovernanceManager, checkApprovalNeeded, db } from '@harness/shared';
import type { LLMProvider, ProviderType } from '@harness/agents';
import type { Message, Tool, ProviderConfig, AgentResult } from '@harness/shared';
import { logger, createTraceLogger } from '@harness/shared';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';

export interface ExecutorConfig {
  provider: ProviderType;
  apiKey: string;
  model?: string;
  baseUrl?: string;
  gatewayUrl?: string;
}

export interface StreamEvent {
  type: 'thinking' | 'tool_call' | 'tool_result' | 'message' | 'error' | 'approval_needed';
  data: Record<string, unknown>;
}

export class AgentExecutor {
  private provider: LLMProvider;
  private tools = toolDefinitions;
  private gatewayUrl: string;
  private memoryStore: PostgresMemoryStore;
  private governance: GovernanceManager;
  private checkpointer: PostgresSaver;

  constructor(config: ExecutorConfig) {
    logger.info({ provider: config.provider }, 'Initializing AgentExecutor');

    this.provider = createProvider(config.provider, {
      apiKey: config.apiKey,
      model: config.model,
      baseUrl: config.baseUrl,
    });

    this.gatewayUrl = config.gatewayUrl ?? 'http://localhost:3002';
    this.memoryStore = new PostgresMemoryStore();
    this.governance = new GovernanceManager();
    this.checkpointer = new PostgresSaver(db);

    logger.info({ gatewayUrl: this.gatewayUrl }, 'Gateway URL configured');
  }

  private createGatewayHandlers(traceLogger: ReturnType<typeof createTraceLogger>) {
    const handlers = new Map<string, (input: unknown) => Promise<string>>();

    for (const tool of this.tools) {
      handlers.set(tool.name, async (input: unknown) => {
        traceLogger.info({ toolName: tool.name }, 'Calling tool via Gateway');

        const response = await fetch(`${this.gatewayUrl}/tools/${tool.name}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input }),
        });

        if (!response.ok) {
          throw new Error(`Gateway error: ${response.status} ${response.statusText}`);
        }

        const result = (await response.json()) as { content: string; isError?: boolean };

        if (result.isError) {
          throw new Error(result.content);
        }

        return result.content;
      });
    }

    return handlers;
  }

  private prepareMessages(messages: Message[]): Message[] {
    const hasSystemMessage = messages.some((m) => m.role === 'system');
    const toolNames = getToolNames();
    const systemPrompt = getAgentSystemPrompt(toolNames);

    return hasSystemMessage
      ? messages
      : [{ role: 'system', content: systemPrompt }, ...messages];
  }

  private createApprovalChecker(traceLogger: ReturnType<typeof createTraceLogger>) {
    const approvalRequired = this.governance.getApprovalRequiredTools();
    const rules = this.governance.getRules();

    return (toolCall: { id: string; name: string; arguments: Record<string, unknown> }) => {
      const check = checkApprovalNeeded(
        { id: toolCall.id, name: toolCall.name, arguments: toolCall.arguments },
        approvalRequired,
        rules
      );

      if (check.needed) {
        traceLogger.info({ toolName: toolCall.name, reason: check.reason }, 'Approval required');
      }

      return check;
    };
  }

  async execute(messages: Message[], traceId: string, threadId?: string): Promise<AgentResult> {
    const traceLogger = createTraceLogger(traceId);
    traceLogger.info({ messageCount: messages.length }, 'Executing agent');

    const finalMessages = this.prepareMessages(messages);
    const gatewayHandlers = this.createGatewayHandlers(traceLogger);
    const approvalChecker = this.createApprovalChecker(traceLogger);

    // 加载历史消息（如果有 threadId）
    if (threadId) {
      const history = await this.memoryStore.getMessages(threadId);
      if (history.length > 0) {
        traceLogger.info({ historyCount: history.length }, 'Loaded message history');
      }
    }

    const result = await runAgent(this.provider, gatewayHandlers, finalMessages, this.tools, traceLogger, {
      checkpointer: this.checkpointer,
      threadId,
      approvalChecker,
    });

    // 保存消息到短期记忆
    if (threadId && result.success) {
      for (const msg of result.messages) {
        await this.memoryStore.addMessage(threadId, msg);
      }
    }

    if (result.success) {
      traceLogger.info({ usage: result.usage }, 'Agent execution completed successfully');
    } else {
      traceLogger.error({ error: result.error }, 'Agent execution failed');
    }

    return result;
  }

  async executeStream(
    messages: Message[],
    traceId: string,
    onEvent: (event: StreamEvent) => Promise<void>,
    threadId?: string
  ): Promise<AgentResult> {
    const traceLogger = createTraceLogger(traceId);
    traceLogger.info({ messageCount: messages.length }, 'Executing agent (streaming)');

    const finalMessages = this.prepareMessages(messages);
    const gatewayHandlers = this.createGatewayHandlers(traceLogger);
    const approvalChecker = this.createApprovalChecker(traceLogger);

    // 加载历史消息
    if (threadId) {
      const history = await this.memoryStore.getMessages(threadId);
      if (history.length > 0) {
        traceLogger.info({ historyCount: history.length }, 'Loaded message history');
      }
    }

    // 发送思考事件
    await onEvent({
      type: 'thinking',
      data: { message: 'Agent 开始处理请求...' },
    });

    // 包装 gateway handlers 以发送工具调用事件
    const wrappedHandlers = new Map<string, (input: unknown) => Promise<string>>();

    for (const [toolName, handler] of gatewayHandlers) {
      wrappedHandlers.set(toolName, async (input: unknown) => {
        await onEvent({
          type: 'tool_call',
          data: { name: toolName, arguments: input },
        });

        const result = await handler(input);

        await onEvent({
          type: 'tool_result',
          data: { name: toolName, content: result },
        });

        return result;
      });
    }

    const result = await runAgent(this.provider, wrappedHandlers, finalMessages, this.tools, traceLogger, {
      checkpointer: this.checkpointer,
      threadId,
      approvalChecker,
    });

    // 保存消息到短期记忆
    if (threadId && result.success) {
      for (const msg of result.messages) {
        await this.memoryStore.addMessage(threadId, msg);
      }
    }

    if (result.success) {
      traceLogger.info({ usage: result.usage }, 'Agent execution completed successfully');

      if (result.result) {
        await onEvent({
          type: 'message',
          data: { content: result.result, usage: result.usage },
        });
      }
    } else {
      traceLogger.error({ error: result.error }, 'Agent execution failed');

      await onEvent({
        type: 'error',
        data: { error: result.error },
      });
    }

    return result;
  }

  getMemoryStore(): PostgresMemoryStore {
    return this.memoryStore;
  }

  getGovernance(): GovernanceManager {
    return this.governance;
  }

  getCheckpointer(): PostgresSaver {
    return this.checkpointer;
  }
}
```

- [ ] **Step 2: 类型检查**

```bash
cd D:/aicode/harness
pnpm --filter @harness/worker typecheck
```

- [ ] **Step 3: 提交**

```bash
git add apps/worker/src/executor.ts
git commit -m "feat: integrate memory, checkpoint, and HITL into AgentExecutor"
```

---

## Task 7: Worker 路由 — 审计和审批

**Files:**
- Create: `apps/worker/src/routes/audit.ts`
- Create: `apps/worker/src/routes/approve.ts`
- Modify: `apps/worker/src/index.ts`

- [ ] **Step 1: 创建审计查询路由**

```typescript
// apps/worker/src/routes/audit.ts
import { Hono } from 'hono';
import { db, toolAuditLogs } from '@harness/shared';
import { eq, desc } from 'drizzle-orm';

export const auditRoutes = new Hono();

// 按 thread_id 查询审计日志
auditRoutes.get('/', async (c) => {
  const threadId = c.req.query('thread_id');
  const toolName = c.req.query('tool_name');
  const limit = parseInt(c.req.query('limit') ?? '50', 10);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);

  let query = db.select().from(toolAuditLogs);

  if (threadId) {
    query = query.where(eq(toolAuditLogs.threadId, threadId)) as typeof query;
  }
  if (toolName) {
    query = query.where(eq(toolAuditLogs.toolName, toolName)) as typeof query;
  }

  const results = await query
    .orderBy(desc(toolAuditLogs.createdAt))
    .limit(limit)
    .offset(offset);

  return c.json({ logs: results, limit, offset });
});
```

- [ ] **Step 2: 创建审批路由**

```typescript
// apps/worker/src/routes/approve.ts
import { Hono } from 'hono';
import { logger as pinoLogger } from '@harness/shared';
import type { AgentExecutor } from '../executor.js';

export function createApprovalRoutes(executor: AgentExecutor): Hono {
  const routes = new Hono();

  // 批准
  routes.post('/approve', async (c) => {
    const body = (await c.req.json()) as {
      threadId: string;
      interruptId: string;
    };

    if (!body.threadId || !body.interruptId) {
      return c.json({ error: 'threadId and interruptId are required' }, 400);
    }

    pinoLogger.info(
      { threadId: body.threadId, interruptId: body.interruptId },
      'Approval received'
    );

    // Resume execution via LangGraph checkpoint
    // The graph will continue from the interrupt point
    const result = await executor.execute(
      [], // Messages will be loaded from checkpoint
      crypto.randomUUID(),
      body.threadId
    );

    return c.json({
      status: 'approved',
      threadId: body.threadId,
      success: result.success,
      result: result.result,
    });
  });

  // 拒绝
  routes.post('/reject', async (c) => {
    const body = (await c.req.json()) as {
      threadId: string;
      interruptId: string;
      reason?: string;
    };

    if (!body.threadId || !body.interruptId) {
      return c.json({ error: 'threadId and interruptId are required' }, 400);
    }

    pinoLogger.info(
      { threadId: body.threadId, interruptId: body.interruptId, reason: body.reason },
      'Rejection received'
    );

    // For rejection, we don't resume the agent - the tool call is skipped
    // The agent will need to handle this gracefully in the next execution
    return c.json({
      status: 'rejected',
      threadId: body.threadId,
      reason: body.reason,
    });
  });

  return routes;
}
```

- [ ] **Step 3: 更新 Worker 主文件添加路由**

```typescript
// apps/worker/src/index.ts
import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { logger as pinoLogger } from '@harness/shared';
import { AgentExecutor } from './executor.js';
import { auditRoutes } from './routes/audit.js';
import { createApprovalRoutes } from './routes/approve.js';
import type { ExecutorConfig } from './executor.js';
import type { Message } from '@harness/shared';

// 从环境变量读取配置
const config: ExecutorConfig = {
  provider: (process.env['LLM_PROVIDER'] as ExecutorConfig['provider']) ?? 'anthropic',
  apiKey: process.env['LLM_API_KEY'] ?? '',
  model: process.env['LLM_MODEL'],
  baseUrl: process.env['LLM_BASE_URL'],
  gatewayUrl: process.env['GATEWAY_URL'] ?? 'http://localhost:3002',
};

if (!config.apiKey) {
  pinoLogger.error('LLM_API_KEY environment variable is required');
  process.exit(1);
}

// 创建 Agent 执行器
const executor = new AgentExecutor(config);

// 创建 Hono 应用
const app = new Hono();

// 中间件
app.use('*', cors());

// 健康检查
app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 审计路由
app.route('/audit', auditRoutes);

// 审批路由
app.route('/run', createApprovalRoutes(executor));

// Agent 执行端点（非流式）
app.post('/run', async (c) => {
  const startTime = Date.now();
  const traceId = crypto.randomUUID();

  try {
    const body = (await c.req.json()) as {
      messages: Message[];
      threadId?: string;
    };

    if (!body.messages?.length) {
      return c.json({ error: 'messages array is required' }, 400);
    }

    pinoLogger.info(
      { traceId, messageCount: body.messages.length, threadId: body.threadId },
      'Received agent execution request'
    );

    const result = await executor.execute(body.messages, traceId, body.threadId);

    const duration = Date.now() - startTime;
    pinoLogger.info({ traceId, duration, success: result.success }, 'Request completed');

    return c.json({
      success: result.success,
      result: result.result,
      messages: result.messages,
      error: result.error,
      usage: result.usage,
      traceId,
      threadId: body.threadId,
      duration,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    pinoLogger.error({ traceId, error: errorMessage }, 'Request failed');

    return c.json(
      {
        success: false,
        error: errorMessage,
        traceId,
      },
      500
    );
  }
});

// Agent 流式执行端点 (SSE)
app.post('/run/stream', async (c) => {
  const traceId = crypto.randomUUID();

  return streamSSE(c, async (stream) => {
    try {
      const body = (await c.req.json()) as {
        messages: Message[];
        threadId?: string;
      };

      if (!body.messages?.length) {
        await stream.writeSSE({ event: 'error', data: JSON.stringify({ error: 'messages array is required' }) });
        return;
      }

      pinoLogger.info(
        { traceId, messageCount: body.messages.length, threadId: body.threadId },
        'Received streaming agent execution request'
      );

      // 发送开始事件
      await stream.writeSSE({
        event: 'start',
        data: JSON.stringify({ traceId, threadId: body.threadId }),
      });

      // 使用流式执行
      const result = await executor.executeStream(
        body.messages,
        traceId,
        async (event) => {
          await stream.writeSSE({
            event: event.type,
            data: JSON.stringify(event.data),
          });
        },
        body.threadId
      );

      // 发送完成事件
      await stream.writeSSE({
        event: 'done',
        data: JSON.stringify({
          success: result.success,
          result: result.result,
          usage: result.usage,
          traceId,
          threadId: body.threadId,
        }),
      });

      pinoLogger.info({ traceId, success: result.success }, 'Streaming request completed');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      pinoLogger.error({ traceId, error: errorMessage }, 'Streaming request failed');

      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({ error: errorMessage, traceId }),
      });
    }
  });
});

// 启动服务器
const port = parseInt(process.env['PORT'] ?? '3001', 10);

serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    pinoLogger.info({ port: info.port }, 'Worker server started');
  }
);
```

- [ ] **Step 4: 类型检查**

```bash
cd D:/aicode/harness
pnpm --filter @harness/worker typecheck
```

- [ ] **Step 5: 提交**

```bash
git add apps/worker/src/
git commit -m "feat: add audit and approval routes to Worker"
```

---

## Task 8: Gateway 审计日志

**Files:**
- Modify: `apps/gateway/src/registry.ts`
- Modify: `apps/gateway/package.json`

- [ ] **Step 1: 添加 shared 依赖（如果还没有）**

```bash
cd D:/aicode/harness
pnpm --filter @harness/gateway add @harness/shared
```

- [ ] **Step 2: 修改 ToolRegistry 添加审计日志**

```typescript
// apps/gateway/src/registry.ts
import { toolDefinitions, toolHandlers, MCPClient, loadMCPConfig } from '@harness/tools';
import { db, toolAuditLogs, logger } from '@harness/shared';
import type { Tool, ToolResult } from '@harness/shared';

export interface MCPService {
  name: string;
  tools: Tool[];
  handler: (toolName: string, input: Record<string, unknown>) => Promise<ToolResult>;
}

export interface AuditContext {
  threadId?: string;
  traceId?: string;
  approval?: 'auto' | 'approved' | 'rejected';
  approver?: string;
}

// 工具注册表
export class ToolRegistry {
  private services = new Map<string, MCPService>();
  private toolToService = new Map<string, string>();
  private mcpClients: MCPClient[] = [];

  constructor() {
    this.registerBuiltinTools();
  }

  async loadMCPServices(configPath?: string): Promise<void> {
    const config = loadMCPConfig(configPath);

    for (const [name, serverConfig] of Object.entries(config.servers)) {
      try {
        const client = new MCPClient({ name, config: serverConfig });
        await client.connect();

        const tools = await client.listTools();
        logger.info({ serverName: name, toolCount: tools.length }, 'Discovered MCP tools');

        this.registerService({
          name,
          tools,
          handler: async (toolName: string, input: Record<string, unknown>) => {
            return client.callTool(toolName, input);
          },
        });

        this.mcpClients.push(client);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error({ serverName: name, error: errorMessage }, 'Failed to connect to MCP server');
      }
    }
  }

  private registerBuiltinTools(): void {
    const builtinService: MCPService = {
      name: 'builtin',
      tools: toolDefinitions,
      handler: async (toolName: string, input: Record<string, unknown>) => {
        const handler = toolHandlers.get(toolName);
        if (!handler) {
          return { content: `Tool "${toolName}" not found`, isError: true };
        }
        return handler(input);
      },
    };

    this.registerService(builtinService);
  }

  registerService(service: MCPService): void {
    logger.info(
      { serviceName: service.name, toolCount: service.tools.length },
      'Registering MCP service'
    );

    this.services.set(service.name, service);

    for (const tool of service.tools) {
      this.toolToService.set(tool.name, service.name);
    }
  }

  getServiceForTool(toolName: string): MCPService | undefined {
    const serviceName = this.toolToService.get(toolName);
    if (!serviceName) return undefined;
    return this.services.get(serviceName);
  }

  getToolDefinition(toolName: string): Tool | undefined {
    const service = this.getServiceForTool(toolName);
    return service?.tools.find((t) => t.name === toolName);
  }

  getAllTools(): Tool[] {
    const tools: Tool[] = [];
    for (const service of this.services.values()) {
      tools.push(...service.tools);
    }
    return tools;
  }

  getServices(): MCPService[] {
    return Array.from(this.services.values());
  }

  async executeTool(
    toolName: string,
    input: Record<string, unknown>,
    auditContext?: AuditContext
  ): Promise<ToolResult> {
    const service = this.getServiceForTool(toolName);

    if (!service) {
      return { content: `Tool "${toolName}" not found`, isError: true };
    }

    logger.debug({ toolName, serviceName: service.name }, 'Executing tool');

    const startTime = Date.now();
    let result: ToolResult;
    let status: 'success' | 'error' = 'success';

    try {
      result = await service.handler(toolName, input);
      if (result.isError) {
        status = 'error';
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ toolName, error: errorMessage }, 'Tool execution failed');
      result = {
        content: `Error executing tool "${toolName}": ${errorMessage}`,
        isError: true,
      };
      status = 'error';
    }

    const durationMs = Date.now() - startTime;

    // 写入审计日志
    try {
      await db.insert(toolAuditLogs).values({
        threadId: auditContext?.threadId ?? 'unknown',
        traceId: auditContext?.traceId ?? 'unknown',
        toolName,
        arguments: input,
        result: result.content,
        status,
        durationMs,
        approval: auditContext?.approval ?? 'auto',
        approver: auditContext?.approver,
      });
    } catch (auditError) {
      const msg = auditError instanceof Error ? auditError.message : 'Unknown error';
      logger.error({ error: msg }, 'Failed to write audit log');
    }

    return result;
  }

  async disconnect(): Promise<void> {
    for (const client of this.mcpClients) {
      await client.disconnect();
    }
    this.mcpClients = [];
  }
}
```

- [ ] **Step 3: 类型检查**

```bash
cd D:/aicode/harness
pnpm --filter @harness/gateway typecheck
```

- [ ] **Step 4: 提交**

```bash
git add apps/gateway/
git commit -m "feat: add audit logging to Gateway tool execution"
```

---

## Task 9: 前端审批卡片

**Files:**
- Create: `apps/web/src/components/approval-card.tsx`
- Modify: `apps/web/src/components/chat-interface.tsx`

- [ ] **Step 1: 创建 ApprovalCard 组件**

```tsx
// apps/web/src/components/approval-card.tsx
'use client';

interface ApprovalCardProps {
  toolName: string;
  arguments: Record<string, unknown>;
  reason: string;
  onApprove: () => void;
  onReject: () => void;
  isLoading?: boolean;
}

export function ApprovalCard({
  toolName,
  arguments: args,
  reason,
  onApprove,
  onReject,
  isLoading,
}: ApprovalCardProps) {
  return (
    <div className="border-2 border-amber-200 rounded-lg p-4 bg-amber-50">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-amber-600 font-semibold">⚠ 需要审批</span>
      </div>

      <p className="text-sm text-gray-600 mb-2">{reason}</p>

      <div className="bg-white rounded p-3 mb-3 text-sm">
        <p className="font-medium text-gray-700">工具: {toolName}</p>
        <pre className="mt-1 text-xs text-gray-500 overflow-auto max-h-32">
          {JSON.stringify(args, null, 2)}
        </pre>
      </div>

      <div className="flex gap-2">
        <button
          onClick={onApprove}
          disabled={isLoading}
          className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50 text-sm"
        >
          {isLoading ? '处理中...' : '批准'}
        </button>
        <button
          onClick={onReject}
          disabled={isLoading}
          className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-50 text-sm"
        >
          {isLoading ? '处理中...' : '拒绝'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 更新 ChatInterface 处理 approval_needed 事件**

在 `apps/web/src/components/chat-interface.tsx` 中添加对 `approval_needed` SSE 事件的处理。

需要在现有的 SSE 事件处理逻辑中添加：

```typescript
// 在 chat-interface.tsx 的 SSE 处理循环中添加
} else if (currentEventType === 'approval_needed') {
  // 添加审批卡片到消息列表
  const approvalMsg: Message = {
    role: 'assistant',
    content: '', // ApprovalCard 会渲染内容
    approval: {
      toolName: parsed['toolName'] as string,
      arguments: parsed['arguments'] as Record<string, unknown>,
      reason: parsed['reason'] as string,
      threadId: parsed['threadId'] as string,
      interruptId: parsed['interruptId'] as string,
    },
  };
  currentMessages.push(approvalMsg);
  setMessages((prev) => [
    ...prev.filter((m) => m.role !== 'system'),
    userMessage,
    ...currentMessages,
  ]);
}
```

同时需要更新 Message 接口以支持 approval 字段，并在 ChatMessage 组件中渲染 ApprovalCard。

- [ ] **Step 3: 更新 ChatMessage 组件渲染审批卡片**

在 `apps/web/src/components/chat-message.tsx` 中添加对 approval 消息的渲染。

- [ ] **Step 4: 类型检查**

```bash
cd D:/aicode/harness
pnpm --filter @harness/web typecheck
```

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/components/
git commit -m "feat: add ApprovalCard component and approval event handling"
```

---

## Task 10: 依赖安装与集成测试

**Files:**
- Modify: `apps/worker/.env`

- [ ] **Step 1: 安装所有新依赖**

```bash
cd D:/aicode/harness
pnpm install
```

- [ ] **Step 2: 配置 DATABASE_URL**

在 `apps/worker/.env` 中添加：

```
DATABASE_URL=postgresql://user:password@localhost:5432/harness
```

- [ ] **Step 3: 创建数据库**

```bash
createdb harness
```

- [ ] **Step 4: 推送 schema 到数据库**

```bash
cd D:/aicode/harness
pnpm --filter @harness/shared exec drizzle-kit push
```

- [ ] **Step 5: 运行类型检查**

```bash
cd D:/aicode/harness
pnpm typecheck
```

- [ ] **Step 6: 运行测试**

```bash
cd D:/aicode/harness
pnpm test
```

- [ ] **Step 7: 启动服务测试**

```bash
# 终端 1: 启动 Worker
pnpm --filter @harness/worker dev

# 终端 2: 启动 Gateway
pnpm --filter @harness/gateway dev

# 终端 3: 启动 Web
pnpm --filter @harness/web dev
```

测试端点：
- `GET http://localhost:3001/health`
- `GET http://localhost:3002/health`
- `POST http://localhost:3001/run` 带 `threadId`
- `GET http://localhost:3001/audit`

- [ ] **Step 8: 提交**

```bash
git add .
git commit -m "feat: Phase 2 complete — memory, checkpoint, HITL, audit"
```

---

## Task 11: 文档更新

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: 更新 CLAUDE.md 的 Phase 2 部分**

将 Phase 2 从"计划"更新为"已完成"，记录所有新增的 API 端点和功能。

- [ ] **Step 2: 提交**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with Phase 2 completion details"
```
