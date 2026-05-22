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
