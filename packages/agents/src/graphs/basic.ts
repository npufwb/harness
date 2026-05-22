import { StateGraph, END, START } from '@langchain/langgraph';
import { Annotation } from '@langchain/langgraph';
import type { Message, Tool, AgentResult } from '@harness/shared';
import { logger, generateId } from '@harness/shared';
import type { LLMProvider } from '../provider.js';

// Agent 状态定义
const AgentStateAnnotation = Annotation.Root({
  messages: Annotation<Message[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
  tools: Annotation<Tool[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  currentToolCall: Annotation<Message['toolCalls'] | undefined>({
    reducer: (_prev, next) => next,
    default: () => undefined,
  }),
  result: Annotation<string | undefined>({
    reducer: (_prev, next) => next,
    default: () => undefined,
  }),
});

type AgentState = typeof AgentStateAnnotation.State;

// 创建 Agent 节点
function createAgentNode(provider: LLMProvider) {
  return async (state: AgentState): Promise<Partial<AgentState>> => {
    logger.info({ messageCount: state.messages.length }, 'Agent node executing');

    const response = await provider.chat(state.messages, state.tools);

    logger.debug(
      { hasToolCalls: !!response.message.toolCalls?.length },
      'Agent response received'
    );

    if (response.message.toolCalls?.length) {
      return {
        messages: [response.message],
        currentToolCall: response.message.toolCalls,
      };
    }

    return {
      messages: [response.message],
      result: response.message.content,
      currentToolCall: undefined,
    };
  };
}

// 创建工具节点
function createToolNode(toolHandlers: Map<string, (input: unknown) => Promise<string>>) {
  return async (state: AgentState): Promise<Partial<AgentState>> => {
    const toolCalls = state.currentToolCall;
    if (!toolCalls?.length) {
      return {};
    }

    logger.info({ toolCount: toolCalls.length }, 'Tool node executing');

    const toolMessages: Message[] = [];

    for (const toolCall of toolCalls) {
      const handler = toolHandlers.get(toolCall.name);

      if (!handler) {
        logger.error({ toolName: toolCall.name }, 'Tool not found');
        toolMessages.push({
          role: 'tool',
          content: `Error: Tool "${toolCall.name}" not found`,
          toolCallId: toolCall.id,
        });
        continue;
      }

      try {
        logger.debug({ toolName: toolCall.name, args: toolCall.arguments }, 'Executing tool');
        const result = await handler(toolCall.arguments);
        toolMessages.push({
          role: 'tool',
          content: result,
          toolCallId: toolCall.id,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error({ toolName: toolCall.name, error: errorMessage }, 'Tool execution failed');
        toolMessages.push({
          role: 'tool',
          content: `Error: ${errorMessage}`,
          toolCallId: toolCall.id,
        });
      }
    }

    return {
      messages: toolMessages,
      currentToolCall: undefined,
    };
  };
}

// 条件边：决定是否继续调用工具
function shouldContinue(state: AgentState): string {
  if (state.currentToolCall?.length) {
    return 'tools';
  }
  return END;
}

// 创建基础 Agent 图
export function createBasicAgentGraph(
  provider: LLMProvider,
  toolHandlers: Map<string, (input: unknown) => Promise<string>>
) {
  const agentNode = createAgentNode(provider);
  const toolNode = createToolNode(toolHandlers);

  const graph = new StateGraph(AgentStateAnnotation)
    .addNode('agent', agentNode)
    .addNode('tools', toolNode)
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', shouldContinue, {
      tools: 'tools',
      [END]: END,
    })
    .addEdge('tools', 'agent');

  return graph.compile();
}

// 执行 Agent
export async function runAgent(
  provider: LLMProvider,
  toolHandlers: Map<string, (input: unknown) => Promise<string>>,
  messages: Message[],
  tools: Tool[]
): Promise<AgentResult> {
  const graph = createBasicAgentGraph(provider, toolHandlers);

  try {
    logger.info('Starting agent execution');

    const result = await graph.invoke({
      messages,
      tools,
    });

    logger.info('Agent execution completed');

    return {
      success: true,
      messages: result.messages,
      result: result.result,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ error: errorMessage }, 'Agent execution failed');

    return {
      success: false,
      messages: [],
      error: errorMessage,
    };
  }
}
