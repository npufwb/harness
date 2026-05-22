import type { Tool, ToolResult } from '@harness/shared';

// 计算器工具定义
export const calculatorTool: Tool = {
  name: 'calculator',
  description: '执行数学计算。支持加减乘除、幂运算、取余等基本运算。',
  inputSchema: {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        description: '数学表达式，例如 "2 + 3 * 4" 或 "10 / 2"',
      },
    },
    required: ['expression'],
  },
};

// 计算器工具处理函数
export async function calculatorHandler(
  input: Record<string, unknown>
): Promise<ToolResult> {
  const expression = input['expression'] as string;

  if (!expression) {
    return {
      content: 'Error: expression is required',
      isError: true,
    };
  }

  try {
    // 安全的数学表达式求值
    // 只允许数字、运算符、括号和空格
    const sanitized = expression.replace(/[^0-9+\-*/().%\s]/g, '');

    if (sanitized !== expression) {
      return {
        content: 'Error: Invalid characters in expression',
        isError: true,
      };
    }

    // 使用 Function 构造器进行安全求值
    // eslint-disable-next-line no-new-func
    const result = new Function(`return (${sanitized})`)() as number;

    if (typeof result !== 'number' || !isFinite(result)) {
      return {
        content: 'Error: Invalid calculation result',
        isError: true,
      };
    }

    return {
      content: `${expression} = ${result}`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      content: `Error calculating "${expression}": ${errorMessage}`,
      isError: true,
    };
  }
}
