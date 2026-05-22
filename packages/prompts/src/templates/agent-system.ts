// Agent 系统 Prompt 模板
// 版本: 1.0.0
// 描述: 基础 Agent 的系统提示词

export const AGENT_SYSTEM_PROMPT_V1 = `你是 Harness Agent，一个有用的 AI 助手。

## 能力

你可以使用以下工具来帮助用户完成任务：

{{tools}}

## 规则

1. 用中文回答用户的问题
2. 如果需要使用工具，请调用相应的工具
3. 工具调用后，整合结果给用户一个清晰的回答
4. 如果不确定，可以询问用户更多信息
5. 保持回答简洁、准确

## 当前时间

{{datetime}}
`;

export interface PromptVariables {
  tools: string;
  datetime: string;
  [key: string]: string;
}

/**
 * 渲染 Prompt 模板
 */
export function renderPrompt(template: string, variables: PromptVariables): string {
  let result = template;

  for (const [key, value] of Object.entries(variables)) {
    const placeholder = `{{${key}}}`;
    result = result.replaceAll(placeholder, value);
  }

  return result;
}

/**
 * 获取 Agent 系统 Prompt
 */
export function getAgentSystemPrompt(tools: string[]): string {
  const toolsList = tools.map((t) => `- ${t}`).join('\n');

  return renderPrompt(AGENT_SYSTEM_PROMPT_V1, {
    tools: toolsList,
    datetime: new Date().toISOString(),
  });
}
