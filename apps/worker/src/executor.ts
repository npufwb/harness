import { runAgent, createProvider } from '@harness/agents';
import { toolDefinitions, toolHandlers } from '@harness/tools';
import type { LLMProvider, ProviderType } from '@harness/agents';
import type { Message, ProviderConfig, AgentResult } from '@harness/shared';
import { logger } from '@harness/shared';

export interface ExecutorConfig {
  provider: ProviderType;
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

export class AgentExecutor {
  private provider: LLMProvider;
  private tools = toolDefinitions;
  private handlers = new Map<string, (input: unknown) => Promise<string>>();

  constructor(config: ExecutorConfig) {
    logger.info({ provider: config.provider }, 'Initializing AgentExecutor');

    this.provider = createProvider(config.provider, {
      apiKey: config.apiKey,
      model: config.model,
      baseUrl: config.baseUrl,
    });

    // 注册工具处理函数
    for (const [name, handler] of toolHandlers) {
      this.handlers.set(name, async (input: unknown) => {
        const result = await handler(input as Record<string, unknown>);
        return result.content;
      });
    }
  }

  async execute(messages: Message[]): Promise<AgentResult> {
    logger.info({ messageCount: messages.length }, 'Executing agent');

    const result = await runAgent(this.provider, this.handlers, messages, this.tools);

    if (result.success) {
      logger.info('Agent execution completed successfully');
    } else {
      logger.error({ error: result.error }, 'Agent execution failed');
    }

    return result;
  }
}
