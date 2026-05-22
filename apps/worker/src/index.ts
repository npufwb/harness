import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as pinoLogger } from '@harness/shared';
import { AgentExecutor } from './executor.js';
import type { ExecutorConfig } from './executor.js';
import type { Message } from '@harness/shared';

// 从环境变量读取配置
const config: ExecutorConfig = {
  provider: (process.env['LLM_PROVIDER'] as ExecutorConfig['provider']) ?? 'anthropic',
  apiKey: process.env['LLM_API_KEY'] ?? '',
  model: process.env['LLM_MODEL'],
  baseUrl: process.env['LLM_BASE_URL'],
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

// Agent 执行端点
app.post('/run', async (c) => {
  const startTime = Date.now();

  try {
    const body = (await c.req.json()) as {
      messages: Message[];
    };

    if (!body.messages?.length) {
      return c.json({ error: 'messages array is required' }, 400);
    }

    pinoLogger.info(
      { messageCount: body.messages.length },
      'Received agent execution request'
    );

    const result = await executor.execute(body.messages);

    const duration = Date.now() - startTime;
    pinoLogger.info({ duration, success: result.success }, 'Request completed');

    return c.json({
      success: result.success,
      result: result.result,
      messages: result.messages,
      error: result.error,
      duration,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    pinoLogger.error({ error: errorMessage }, 'Request failed');

    return c.json(
      {
        success: false,
        error: errorMessage,
      },
      500
    );
  }
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
