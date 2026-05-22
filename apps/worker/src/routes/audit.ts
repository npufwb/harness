import { Hono } from 'hono';
import { db, toolAuditLogs } from '@harness/shared';
import { eq, desc } from 'drizzle-orm';

export const auditRoutes = new Hono();

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
