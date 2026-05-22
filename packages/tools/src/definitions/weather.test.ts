import { describe, it, expect } from 'vitest';
import { weatherTool, weatherHandler } from './weather.js';

describe('weather', () => {
  describe('tool definition', () => {
    it('should have correct name', () => {
      expect(weatherTool.name).toBe('weather');
    });

    it('should have required city parameter', () => {
      expect(weatherTool.inputSchema.required).toContain('city');
    });
  });

  describe('weatherHandler', () => {
    it('should return weather for known city', async () => {
      const result = await weatherHandler({ city: '北京' });
      expect(result.isError).toBeFalsy();

      const data = JSON.parse(result.content);
      expect(data.city).toBe('北京');
      expect(data.temperature).toContain('°C');
    });

    it('should support fahrenheit', async () => {
      const result = await weatherHandler({ city: '北京', unit: 'fahrenheit' });
      expect(result.isError).toBeFalsy();

      const data = JSON.parse(result.content);
      expect(data.temperature).toContain('°F');
    });

    it('should return error for unknown city', async () => {
      const result = await weatherHandler({ city: '未知城市' });
      expect(result.isError).toBe(true);
    });

    it('should return error for missing city', async () => {
      const result = await weatherHandler({});
      expect(result.isError).toBe(true);
      expect(result.content).toContain('required');
    });

    it('should handle case-insensitive city names', async () => {
      const result = await weatherHandler({ city: 'New York' });
      expect(result.isError).toBeFalsy();

      const data = JSON.parse(result.content);
      expect(data.city).toBe('New York');
    });
  });
});
