import type { Tool, ToolResult } from '@harness/shared';
import { calculatorTool, calculatorHandler } from './calculator.js';
import { weatherTool, weatherHandler } from './weather.js';

// 所有工具定义
export const toolDefinitions: Tool[] = [calculatorTool, weatherTool];

// 工具处理函数映射
export const toolHandlers = new Map<string, (input: Record<string, unknown>) => Promise<ToolResult>>(
  [
    ['calculator', calculatorHandler],
    ['weather', weatherHandler],
  ]
);

// 根据名称获取工具定义
export function getToolByName(name: string): Tool | undefined {
  return toolDefinitions.find((t) => t.name === name);
}

// 获取所有工具名称
export function getToolNames(): string[] {
  return toolDefinitions.map((t) => t.name);
}
