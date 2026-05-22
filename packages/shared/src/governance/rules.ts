import type { ToolCall } from '../types/index.js';

export interface ApprovalRule {
  name: string;
  description: string;
  condition: (toolCall: ToolCall, context: Record<string, unknown>) => boolean;
}

// Built-in rule: sensitive data detection
export const sensitiveDataRule: ApprovalRule = {
  name: 'sensitive-data',
  description: '检测工具调用参数中是否包含敏感信息',
  condition: (toolCall: ToolCall) => {
    const argsStr = JSON.stringify(toolCall.arguments);
    return /password|secret|token|api[_-]?key/i.test(argsStr);
  },
};

// Built-in rules list
export const builtinRules: ApprovalRule[] = [sensitiveDataRule];

// Check if tool call needs approval
export function checkApprovalNeeded(
  toolCall: ToolCall,
  approvalRequiredTools: string[],
  rules: ApprovalRule[],
  context: Record<string, unknown> = {}
): { needed: boolean; reason: string } {
  // Check if tool is in approval list
  if (approvalRequiredTools.includes(toolCall.name)) {
    return {
      needed: true,
      reason: `工具 "${toolCall.name}" 被配置为需要审批`,
    };
  }

  // Check rules
  for (const rule of rules) {
    if (rule.condition(toolCall, context)) {
      return {
        needed: true,
        reason: `触发规则: ${rule.description}`,
      };
    }
  }

  return { needed: false, reason: '' };
}
