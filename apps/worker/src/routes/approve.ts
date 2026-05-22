import { Hono } from 'hono';
import { logger as pinoLogger } from '@harness/shared';
import type { AgentExecutor } from '../executor.js';

export function createApprovalRoutes(executor: AgentExecutor): Hono {
  const routes = new Hono();

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
    const result = await executor.execute(
      [],
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

    return c.json({
      status: 'rejected',
      threadId: body.threadId,
      reason: body.reason,
    });
  });

  return routes;
}
