// 消息类型
export interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

// 工具调用
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

// 工具定义
export interface Tool {
  name: string;
  description: string;
  inputSchema: JSONSchema;
}

// JSON Schema 类型
export interface JSONSchema {
  type: string;
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
  description?: string;
}

export interface JSONSchemaProperty {
  type: string;
  description?: string;
  enum?: string[];
  items?: JSONSchemaProperty;
}

// 工具执行结果
export interface ToolResult {
  content: string;
  isError?: boolean;
}

// 聊天响应
export interface ChatResponse {
  message: Message;
  usage?: TokenUsage;
}

// Token 使用量
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

// 流式输出块
export interface Chunk {
  content?: string;
  toolCall?: Partial<ToolCall>;
  done: boolean;
}

// Provider 配置
export interface ProviderConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

// Agent 执行结果
export interface AgentResult {
  success: boolean;
  messages: Message[];
  result?: string;
  error?: string;
  usage?: TokenUsage;
}
