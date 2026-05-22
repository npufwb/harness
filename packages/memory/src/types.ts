import type { Message } from '@harness/shared';

export interface MemoryEntry {
  namespace: string;
  key: string;
  value: string;
  updatedAt: Date;
}

export interface MemoryStore {
  // Short-term memory
  getMessages(threadId: string): Promise<Message[]>;
  addMessage(threadId: string, message: Message): Promise<void>;

  // Long-term memory
  getMemory(namespace: string, key: string): Promise<string | null>;
  setMemory(namespace: string, key: string, value: string): Promise<void>;
  listMemories(namespace: string): Promise<MemoryEntry[]>;
  deleteMemory(namespace: string, key: string): Promise<void>;
}
