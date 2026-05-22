import { runAgent, createProvider } from '@harness/agents';
import { toolDefinitions, getToolNames } from '@harness/tools';
import { getAgentSystemPrompt } from '@harness/prompts';
import type { LLMProvider, ProviderType } from '@harness/agents';
import type { Message, Tool, ProviderConfig, AgentResult } from '@harness/shared';
import { logger, createTraceLogger } from '@harness/shared';

export interface ExecutorConfig {
  provider: ProviderType;
  apiKey: string;
  model?: string;
  baseUrl?: string;
  gatewayUrl?: string;
}

export interface StreamEvent {
  type: 'thinking' | 'tool_call' | 'tool_result' | 'message' | 'error';
  data: Record<string, unknown>;
}

export class AgentExecutor {
  private provider: LLMProvider;
  private tools = toolDefinitions;
  private gatewayUrl: string;

  constructor(config: ExecutorConfig) {
    logger.info({ provider: config.provider }, 'Initializing AgentExecutor');

    this.provider = createProvider(config.provider, {
      apiKey: config.apiKey,
      model: config.model,
      baseUrl: config.baseUrl,
    });

    this.gatewayUrl = config.gatewayUrl ?? 'http://localhost:3002';
    logger.info({ gatewayUrl: this.gatewayUrl }, 'Gateway URL configured');
  }

  private createGatewayHandlers(traceLogger: ReturnType<typeof createTraceLogger>) {
    const handlers = new Map<string, (input: unknown) => Promise<string>>();

    for (const tool of this.tools) {
      handlers.set(tool.name, async (input: unknown) => {
        traceLogger.info({ toolName: tool.name }, 'Calling tool via Gateway');

        const response = await fetch(`${this.gatewayUrl}/tools/${tool.name}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input }),
        });

        if (!response.ok) {
          throw new Error(`Gateway error: ${response.status} ${response.statusText}`);
        }

        const result = (await response.json()) as { content: string; isError?: boolean };

        if (result.isError) {
          throw new Error(result.content);
        }

        return result.content;
      });
    }

    return handlers;
  }

  private prepareMessages(messages: Message[]): Message[] {
    const hasSystemMessage = messages.some((m) => m.role === 'system');
    const toolNames = getToolNames();
    const systemPrompt = getAgentSystemPrompt(toolNames);

    return hasSystemMessage
      ? messages
      : [{ role: 'system', content: systemPrompt }, ...messages];
  }

  async execute(messages: Message[], traceId: string): Promise<AgentResult> {
    const traceLogger = createTraceLogger(traceId);
    traceLogger.info({ messageCount: messages.length }, 'Executing agent');

    const finalMessages = this.prepareMessages(messages);
    const gatewayHandlers = this.createGatewayHandlers(traceLogger);

    const result = await runAgent(this.provider, gatewayHandlers, finalMessages, this.tools, traceLogger);

    if (result.success) {
      traceLogger.info({ usage: result.usage }, 'Agent execution completed successfully');
    } else {
      traceLogger.error({ error: result.error }, 'Agent execution failed');
    }

    return result;
  }

  async executeStream(
    messages: Message[],
    traceId: string,
    onEvent: (event: StreamEvent) => Promise<void>
  ): Promise<AgentResult> {
    const traceLogger = createTraceLogger(traceId);
    traceLogger.info({ messageCount: messages.length }, 'Executing agent (streaming)');

    const finalMessages = this.prepareMessages(messages);
    const gatewayHandlers = this.createGatewayHandlers(traceLogger);

    // 发送思考事件
    await onEvent({
      type: 'thinking',
      data: { message: 'Agent 开始处理请求...' },
    });

    // 包装 gateway handlers 以发送工具调用事件
    const wrappedHandlers = new Map<string, (input: unknown) => Promise<string>>();

    for (const [toolName, handler] of gatewayHandlers) {
      wrappedHandlers.set(toolName, async (input: unknown) => {
        // 发送工具调用事件
        await onEvent({
          type: 'tool_call',
          data: { name: toolName, arguments: input },
        });

        const result = await handler(input);

        // 发送工具结果事件
        await onEvent({
          type: 'tool_result',
          data: { name: toolName, content: result },
        });

        return result;
      });
    }

    const result = await runAgent(this.provider, wrappedHandlers, finalMessages, this.tools, traceLogger);

    if (result.success) {
      traceLogger.info({ usage: result.usage }, 'Agent execution completed successfully');

      // 发送最终消息事件
      if (result.result) {
        await onEvent({
          type: 'message',
          data: { content: result.result, usage: result.usage },
        });
      }
    } else {
      traceLogger.error({ error: result.error }, 'Agent execution failed');

      await onEvent({
        type: 'error',
        data: { error: result.error },
      });
    }

    return result;
  }
}
