import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as pinoLogger } from '@harness/shared';
import { ToolRegistry } from './registry.js';

// 创建工具注册表
const registry = new ToolRegistry();

// 创建 Hono 应用
const app = new Hono();

// 中间件
app.use('*', cors());

// 健康检查
app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 获取所有工具
app.get('/tools', (c) => {
  const tools = registry.getAllTools();
  return c.json({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  });
});

// 获取单个工具定义
app.get('/tools/:name', (c) => {
  const name = c.req.param('name');
  const tool = registry.getToolDefinition(name);

  if (!tool) {
    return c.json({ error: `Tool "${name}" not found` }, 404);
  }

  return c.json({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  });
});

// 执行工具
app.post('/tools/:name', async (c) => {
  const startTime = Date.now();
  const name = c.req.param('name');

  try {
    const body = (await c.req.json()) as {
      input?: Record<string, unknown>;
    };

    pinoLogger.info({ toolName: name }, 'Received tool execution request');

    const result = await registry.executeTool(name, body.input ?? {});

    const duration = Date.now() - startTime;
    pinoLogger.info(
      { toolName: name, duration, isError: result.isError },
      'Tool execution completed'
    );

    return c.json({
      content: result.content,
      isError: result.isError ?? false,
      duration,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    pinoLogger.error({ toolName: name, error: errorMessage }, 'Request failed');

    return c.json(
      {
        content: errorMessage,
        isError: true,
      },
      500
    );
  }
});

// 获取已注册的服务
app.get('/services', (c) => {
  const services = registry.getServices();
  return c.json({
    services: services.map((s) => ({
      name: s.name,
      toolCount: s.tools.length,
      tools: s.tools.map((t) => t.name),
    })),
  });
});

// 启动服务器
const port = parseInt(process.env['PORT'] ?? '3002', 10);

async function startGateway() {
  // 加载 MCP 服务
  pinoLogger.info('Loading MCP services...');
  await registry.loadMCPServices();

  // 启动 HTTP 服务
  serve(
    {
      fetch: app.fetch,
      port,
    },
    (info) => {
      pinoLogger.info({ port: info.port }, 'Gateway server started');
    }
  );
}

// 优雅关闭
process.on('SIGINT', async () => {
  pinoLogger.info('Shutting down Gateway...');
  await registry.disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  pinoLogger.info('Shutting down Gateway...');
  await registry.disconnect();
  process.exit(0);
});

startGateway().catch((error) => {
  pinoLogger.error({ error: error.message }, 'Failed to start Gateway');
  process.exit(1);
});
