import { describe, it, expect } from 'vitest';
import { calculatorTool, calculatorHandler } from './calculator.js';

describe('calculator', () => {
  describe('tool definition', () => {
    it('should have correct name', () => {
      expect(calculatorTool.name).toBe('calculator');
    });

    it('should have required expression parameter', () => {
      expect(calculatorTool.inputSchema.required).toContain('expression');
    });
  });

  describe('calculatorHandler', () => {
    it('should evaluate simple addition', async () => {
      const result = await calculatorHandler({ expression: '2 + 3' });
      expect(result.isError).toBeFalsy();
      expect(result.content).toContain('5');
    });

    it('should respect operator precedence', async () => {
      const result = await calculatorHandler({ expression: '2 + 3 * 4' });
      expect(result.isError).toBeFalsy();
      expect(result.content).toContain('14');
    });

    it('should handle parentheses', async () => {
      const result = await calculatorHandler({ expression: '(2 + 3) * 4' });
      expect(result.isError).toBeFalsy();
      expect(result.content).toContain('20');
    });

    it('should return error for missing expression', async () => {
      const result = await calculatorHandler({});
      expect(result.isError).toBe(true);
      expect(result.content).toContain('required');
    });

    it('should return error for invalid characters', async () => {
      const result = await calculatorHandler({ expression: '2 + alert("xss")' });
      expect(result.isError).toBe(true);
    });
  });
});
