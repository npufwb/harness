import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
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

// Agent 执行端点（非流式，保持兼容）
app.post('/run', async (c) => {
  const startTime = Date.now();
  const traceId = crypto.randomUUID();

  try {
    const body = (await c.req.json()) as {
      messages: Message[];
    };

    if (!body.messages?.length) {
      return c.json({ error: 'messages array is required' }, 400);
    }

    pinoLogger.info(
      { traceId, messageCount: body.messages.length },
      'Received agent execution request'
    );

    const result = await executor.execute(body.messages, traceId);

    const duration = Date.now() - startTime;
    pinoLogger.info({ traceId, duration, success: result.success }, 'Request completed');

    return c.json({
      success: result.success,
      result: result.result,
      messages: result.messages,
      error: result.error,
      usage: result.usage,
      traceId,
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
      };

      if (!body.messages?.length) {
        await stream.writeSSE({ event: 'error', data: JSON.stringify({ error: 'messages array is required' }) });
        return;
      }

      pinoLogger.info(
        { traceId, messageCount: body.messages.length },
        'Received streaming agent execution request'
      );

      // 发送开始事件
      await stream.writeSSE({
        event: 'start',
        data: JSON.stringify({ traceId }),
      });

      // 使用流式执行
      const result = await executor.executeStream(body.messages, traceId, async (event) => {
        await stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event.data),
        });
      });

      // 发送完成事件
      await stream.writeSSE({
        event: 'done',
        data: JSON.stringify({
          success: result.success,
          result: result.result,
          usage: result.usage,
          traceId,
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
