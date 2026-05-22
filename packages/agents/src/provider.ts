import type {
  Message,
  Tool,
  ChatResponse,
  Chunk,
  ProviderConfig,
} from '@harness/shared';
import { logger } from '@harness/shared';

// Provider 类型
export type ProviderType = 'anthropic' | 'openai' | 'openrouter';

// LLM Provider 接口
export interface LLMProvider {
  chat(messages: Message[], tools?: Tool[]): Promise<ChatResponse>;
  stream(messages: Message[], tools?: Tool[]): AsyncIterable<Chunk>;
}

// Anthropic Provider
class AnthropicProvider implements LLMProvider {
  private apiKey: string;
  private model: string;
  private maxTokens: number;

  constructor(config: ProviderConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? 'claude-3-5-sonnet-20241022';
    this.maxTokens = config.maxTokens ?? 4096;
  }

  async chat(messages: Message[], tools?: Tool[]): Promise<ChatResponse> {
    logger.debug({ provider: 'anthropic', model: this.model }, 'Calling Anthropic API');

    // 转换消息格式
    const anthropicMessages = this.convertMessages(messages);
    const anthropicTools = tools ? this.convertTools(tools) : undefined;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: this.maxTokens,
        messages: anthropicMessages,
        ...(anthropicTools && { tools: anthropicTools }),
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
      usage: { input_tokens: number; output_tokens: number };
    };

    // 解析响应
    const content = data.content[0];
    const message: Message = {
      role: 'assistant',
      content: content?.text ?? '',
    };

    // 检查是否有工具调用
    const toolUse = data.content.find((c) => c.type === 'tool_use');
    if (toolUse && toolUse.id && toolUse.name) {
      message.toolCalls = [
        {
          id: toolUse.id,
          name: toolUse.name,
          arguments: (toolUse.input as Record<string, unknown>) ?? {},
        },
      ];
    }

    return {
      message,
      usage: {
        promptTokens: data.usage.input_tokens,
        completionTokens: data.usage.output_tokens,
        totalTokens: data.usage.input_tokens + data.usage.output_tokens,
      },
    };
  }

  async *stream(messages: Message[], tools?: Tool[]): AsyncIterable<Chunk> {
    logger.debug({ provider: 'anthropic', model: this.model }, 'Streaming from Anthropic API');

    const anthropicMessages = this.convertMessages(messages);
    const anthropicTools = tools ? this.convertTools(tools) : undefined;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: this.maxTokens,
        messages: anthropicMessages,
        ...(anthropicTools && { tools: anthropicTools }),
        stream: true,
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            yield { done: true };
            return;
          }

          try {
            const parsed = JSON.parse(data) as {
              type: string;
              delta?: { type: string; text?: string };
            };

            if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
              yield { content: parsed.delta.text, done: false };
            }
          } catch {
            // 忽略解析错误
          }
        }
      }
    }

    yield { done: true };
  }

  private convertMessages(messages: Message[]): unknown[] {
    return messages.map((msg) => ({
      role: msg.role === 'tool' ? 'user' : msg.role,
      content: msg.role === 'tool' ? `[Tool Result]: ${msg.content}` : msg.content,
    }));
  }

  private convertTools(tools: Tool[]): unknown[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }));
  }
}

// OpenAI Provider
class OpenAIProvider implements LLMProvider {
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private maxTokens: number;

  constructor(config: ProviderConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? 'https://api.openai.com/v1';
    this.model = config.model ?? 'gpt-4o';
    this.maxTokens = config.maxTokens ?? 4096;
  }

  async chat(messages: Message[], tools?: Tool[]): Promise<ChatResponse> {
    logger.debug({ provider: 'openai', model: this.model }, 'Calling OpenAI API');

    const openaiMessages = this.convertMessages(messages);
    const openaiTools = tools ? this.convertTools(tools) : undefined;

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: this.maxTokens,
        messages: openaiMessages,
        ...(openaiTools && { tools: openaiTools }),
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as {
      choices: Array<{
        message: {
          role: string;
          content: string | null;
          tool_calls?: Array<{
            id: string;
            type: string;
            function: { name: string; arguments: string };
          }>;
        };
      }>;
      usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };

    const choice = data.choices[0];
    if (!choice) throw new Error('No response from OpenAI');

    const message: Message = {
      role: 'assistant',
      content: choice.message.content ?? '',
    };

    if (choice.message.tool_calls?.length) {
      message.toolCalls = choice.message.tool_calls.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
      }));
    }

    return {
      message,
      usage: {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      },
    };
  }

  async *stream(messages: Message[], tools?: Tool[]): AsyncIterable<Chunk> {
    logger.debug({ provider: 'openai', model: this.model }, 'Streaming from OpenAI API');

    const openaiMessages = this.convertMessages(messages);
    const openaiTools = tools ? this.convertTools(tools) : undefined;

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: this.maxTokens,
        messages: openaiMessages,
        ...(openaiTools && { tools: openaiTools }),
        stream: true,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            yield { done: true };
            return;
          }

          try {
            const parsed = JSON.parse(data) as {
              choices: Array<{
                delta?: { content?: string };
              }>;
            };

            const content = parsed.choices[0]?.delta?.content;
            if (content) {
              yield { content, done: false };
            }
          } catch {
            // 忽略解析错误
          }
        }
      }
    }

    yield { done: true };
  }

  private convertMessages(messages: Message[]): unknown[] {
    return messages.map((msg) => {
      if (msg.role === 'tool') {
        return {
          role: 'tool',
          content: msg.content,
          tool_call_id: msg.toolCallId,
        };
      }

      const converted: Record<string, unknown> = {
        role: msg.role,
        content: msg.content,
      };

      if (msg.toolCalls?.length) {
        converted['tool_calls'] = msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        }));
      }

      return converted;
    });
  }

  private convertTools(tools: Tool[]): unknown[] {
    return tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
  }
}

// OpenRouter Provider（基于 OpenAI 兼容 API）
class OpenRouterProvider extends OpenAIProvider {
  constructor(config: ProviderConfig) {
    super({
      ...config,
      baseUrl: config.baseUrl ?? 'https://openrouter.ai/api/v1',
    });
  }
}

// Provider 工厂
export function createProvider(type: ProviderType, config: ProviderConfig): LLMProvider {
  logger.info({ provider: type }, 'Creating LLM provider');

  switch (type) {
    case 'anthropic':
      return new AnthropicProvider(config);
    case 'openai':
      return new OpenAIProvider(config);
    case 'openrouter':
      return new OpenRouterProvider(config);
    default:
      throw new Error(`Unknown provider type: ${type}`);
  }
}
