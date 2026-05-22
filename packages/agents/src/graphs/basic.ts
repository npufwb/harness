import { StateGraph, END, START } from '@langchain/langgraph';
import { Annotation } from '@langchain/langgraph';
import type { Message, Tool, AgentResult, TokenUsage } from '@harness/shared';
import { logger as defaultLogger, generateId } from '@harness/shared';
import type { Logger } from 'pino';
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
  usage: Annotation<TokenUsage | undefined>({
    reducer: (prev, next) => {
      if (!prev) return next;
      if (!next) return prev;
      return {
        promptTokens: prev.promptTokens + next.promptTokens,
        completionTokens: prev.completionTokens + next.completionTokens,
        totalTokens: prev.totalTokens + next.totalTokens,
      };
    },
    default: () => undefined,
  }),
});

type AgentState = typeof AgentStateAnnotation.State;

// 创建 Agent 节点
function createAgentNode(provider: LLMProvider, traceLogger: Logger) {
  return async (state: AgentState): Promise<Partial<AgentState>> => {
    traceLogger.info({ messageCount: state.messages.length }, 'Agent node executing');

    const response = await provider.chat(state.messages, state.tools);

    traceLogger.debug(
      { hasToolCalls: !!response.message.toolCalls?.length, usage: response.usage },
      'Agent response received'
    );

    if (response.message.toolCalls?.length) {
      return {
        messages: [response.message],
        currentToolCall: response.message.toolCalls,
        usage: response.usage,
      };
    }

    return {
      messages: [response.message],
      result: response.message.content,
      currentToolCall: undefined,
      usage: response.usage,
    };
  };
}

// 创建工具节点
function createToolNode(
  toolHandlers: Map<string, (input: unknown) => Promise<string>>,
  traceLogger: Logger
) {
  return async (state: AgentState): Promise<Partial<AgentState>> => {
    const toolCalls = state.currentToolCall;
    if (!toolCalls?.length) {
      return {};
    }

    traceLogger.info({ toolCount: toolCalls.length }, 'Tool node executing');

    const toolMessages: Message[] = [];

    for (const toolCall of toolCalls) {
      const handler = toolHandlers.get(toolCall.name);

      if (!handler) {
        traceLogger.error({ toolName: toolCall.name }, 'Tool not found');
        toolMessages.push({
          role: 'tool',
          content: `Error: Tool "${toolCall.name}" not found`,
          toolCallId: toolCall.id,
        });
        continue;
      }

      try {
        const toolStart = Date.now();
        traceLogger.debug({ toolName: toolCall.name, args: toolCall.arguments }, 'Executing tool');
        const result = await handler(toolCall.arguments);
        const toolDuration = Date.now() - toolStart;
        traceLogger.info({ toolName: toolCall.name, duration: toolDuration }, 'Tool executed');
        toolMessages.push({
          role: 'tool',
          content: result,
          toolCallId: toolCall.id,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        traceLogger.error({ toolName: toolCall.name, error: errorMessage }, 'Tool execution failed');
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
    return 'toolExecutor';
  }
  return END;
}

// 创建基础 Agent 图
export function createBasicAgentGraph(
  provider: LLMProvider,
  toolHandlers: Map<string, (input: unknown) => Promise<string>>,
  traceLogger: Logger = defaultLogger
) {
  const agentNode = createAgentNode(provider, traceLogger);
  const toolNode = createToolNode(toolHandlers, traceLogger);

  const graph = new StateGraph(AgentStateAnnotation)
    .addNode('agent', agentNode)
    .addNode('toolExecutor', toolNode)
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', shouldContinue, {
      toolExecutor: 'toolExecutor',
      [END]: END,
    })
    .addEdge('toolExecutor', 'agent');

  return graph.compile();
}

// 执行 Agent
export async function runAgent(
  provider: LLMProvider,
  toolHandlers: Map<string, (input: unknown) => Promise<string>>,
  messages: Message[],
  tools: Tool[],
  traceLogger: Logger = defaultLogger
): Promise<AgentResult> {
  const graph = createBasicAgentGraph(provider, toolHandlers, traceLogger);

  try {
    traceLogger.info('Starting agent execution');

    const result = await graph.invoke({
      messages,
      tools,
    });

    traceLogger.info({ usage: result.usage }, 'Agent execution completed');

    return {
      success: true,
      messages: result.messages,
      result: result.result,
      usage: result.usage,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    traceLogger.error({ error: errorMessage }, 'Agent execution failed');

    return {
      success: false,
      messages: [],
      error: errorMessage,
    };
  }
}
