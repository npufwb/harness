import { describe, it, expect } from 'vitest';
import { generateId, safeJsonParse, truncate, sleep } from './index.js';

describe('utils', () => {
  describe('generateId', () => {
    it('should generate a UUID', () => {
      const id = generateId();
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    });

    it('should generate unique IDs', () => {
      const id1 = generateId();
      const id2 = generateId();
      expect(id1).not.toBe(id2);
    });
  });

  describe('safeJsonParse', () => {
    it('should parse valid JSON', () => {
      const result = safeJsonParse<{ name: string }>('{"name":"test"}');
      expect(result).toEqual({ name: 'test' });
    });

    it('should return null for invalid JSON', () => {
      const result = safeJsonParse('invalid');
      expect(result).toBeNull();
    });
  });

  describe('truncate', () => {
    it('should not truncate short strings', () => {
      expect(truncate('hello', 10)).toBe('hello');
    });

    it('should truncate long strings', () => {
      const result = truncate('hello world', 8);
      expect(result).toBe('hello...');
      expect(result.length).toBe(8);
    });
  });

  describe('sleep', () => {
    it('should resolve after specified time', async () => {
      const start = Date.now();
      await sleep(50);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(40);
    });
  });
});
