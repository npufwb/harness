import { describe, it, expect } from 'vitest';
import { PostgresMemoryStore } from './store.js';
import type { MemoryStore, MemoryEntry } from './types.js';

describe('Memory types', () => {
  it('MemoryEntry interface has correct shape', () => {
    const entry: MemoryEntry = {
      namespace: 'test',
      key: 'key1',
      value: 'value1',
      updatedAt: new Date(),
    };
    expect(entry.namespace).toBe('test');
    expect(entry.key).toBe('key1');
    expect(entry.value).toBe('value1');
    expect(entry.updatedAt).toBeInstanceOf(Date);
  });

  it('PostgresMemoryStore implements MemoryStore interface', () => {
    const store: MemoryStore = new PostgresMemoryStore();
    expect(store.getMessages).toBeTypeOf('function');
    expect(store.addMessage).toBeTypeOf('function');
    expect(store.getMemory).toBeTypeOf('function');
    expect(store.setMemory).toBeTypeOf('function');
    expect(store.listMemories).toBeTypeOf('function');
    expect(store.deleteMemory).toBeTypeOf('function');
  });

  it('PostgresMemoryStore has all required methods', () => {
    const store = new PostgresMemoryStore();
    expect(typeof store.getMessages).toBe('function');
    expect(typeof store.addMessage).toBe('function');
    expect(typeof store.getMemory).toBe('function');
    expect(typeof store.setMemory).toBe('function');
    expect(typeof store.listMemories).toBe('function');
    expect(typeof store.deleteMemory).toBe('function');
  });
});
