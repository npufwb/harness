import { eq, and } from 'drizzle-orm';
import { db, messages, memories } from '@harness/shared';
import type { Message } from '@harness/shared';
import type { MemoryEntry, MemoryStore } from './types.js';

export class PostgresMemoryStore implements MemoryStore {
  // Short-term memory
  async getMessages(threadId: string): Promise<Message[]> {
    const rows = await db
      .select()
      .from(messages)
      .where(eq(messages.threadId, threadId))
      .orderBy(messages.createdAt);

    return rows.map((row) => {
      const msg: Message = {
        role: row.role as Message['role'],
        content: row.content,
      };
      if (row.toolCallId) {
        msg.toolCallId = row.toolCallId;
      }
      if (row.toolCalls) {
        msg.toolCalls = row.toolCalls as Message['toolCalls'];
      }
      return msg;
    });
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

  // Long-term memory
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
