'use client';

import { useState, useRef } from 'react';
import { ChatMessage } from './chat-message';
import { ChatInput } from './chat-input';

interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

const WORKER_URL = process.env['NEXT_PUBLIC_WORKER_URL'] ?? 'http://localhost:3001';

export function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [statusText, setStatusText] = useState<string>('');
  const [lastUsage, setLastUsage] = useState<TokenUsage | null>(null);
  const [lastTraceId, setLastTraceId] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleSendMessage = async (content: string) => {
    if (!content.trim() || isLoading) return;

    // 添加用户消息
    const userMessage: Message = { role: 'user', content };
    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);
    setLastUsage(null);
    setStatusText('Agent 思考中...');

    // 创建 AbortController
    abortControllerRef.current = new AbortController();

    try {
      // 使用流式端点
      const response = await fetch(`${WORKER_URL}/run/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [
            ...messages
              .filter((m) => m.role !== 'system')
              .map((m) => ({
                role: m.role,
                content: m.content,
                ...(m.toolCalls && { toolCalls: m.toolCalls }),
                ...(m.toolCallId && { toolCallId: m.toolCallId }),
              })),
            userMessage,
          ],
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      // 处理 SSE 流
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';
      let currentMessages: Message[] = [];
      let currentEventType = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEventType = line.slice(7).trim();
            continue;
          }

          if (line.startsWith('data: ')) {
            const data = line.slice(6);

            try {
              const parsed = JSON.parse(data) as Record<string, unknown>;

              // 处理不同类型的 SSE 事件
              if (currentEventType === 'start') {
                // 开始事件，获取 traceId
                if (parsed['traceId']) {
                  setLastTraceId(parsed['traceId'] as string);
                }
              } else if (currentEventType === 'thinking') {
                setStatusText(parsed['message'] as string);
              } else if (currentEventType === 'tool_call') {
                const toolName = parsed['name'] as string;
                setStatusText(`调用工具: ${toolName}...`);
                // 添加工具调用消息
                const toolCallMsg: Message = {
                  role: 'assistant',
                  content: '',
                  toolCalls: [{
                    id: `call_${Date.now()}`,
                    name: toolName,
                    arguments: parsed['arguments'] as Record<string, unknown>,
                  }],
                };
                currentMessages.push(toolCallMsg);
                setMessages((prev) => [
                  ...prev.filter((m) => m.role !== 'system'),
                  userMessage,
                  ...currentMessages,
                ]);
              } else if (currentEventType === 'tool_result') {
                setStatusText('处理工具结果...');
                // 添加工具结果消息
                const toolResultMsg: Message = {
                  role: 'tool',
                  content: parsed['content'] as string,
                  toolCallId: `call_${Date.now()}`,
                };
                currentMessages.push(toolResultMsg);
                setMessages((prev) => [
                  ...prev.filter((m) => m.role !== 'system'),
                  userMessage,
                  ...currentMessages,
                ]);
              } else if (currentEventType === 'message') {
                // 最终消息
                const finalMsg: Message = {
                  role: 'assistant',
                  content: parsed['content'] as string,
                };
                currentMessages.push(finalMsg);
                setMessages((prev) => [
                  ...prev.filter((m) => m.role !== 'system'),
                  userMessage,
                  ...currentMessages,
                ]);
                if (parsed['usage']) {
                  setLastUsage(parsed['usage'] as TokenUsage);
                }
              } else if (currentEventType === 'error') {
                const errorMsg: Message = {
                  role: 'assistant',
                  content: `Error: ${parsed['error']}`,
                };
                setMessages((prev) => [...prev, errorMsg]);
              } else if (currentEventType === 'done') {
                // 完成事件
                if (parsed['usage']) {
                  setLastUsage(parsed['usage'] as TokenUsage);
                }
              }
            } catch {
              // 忽略解析错误
            }
          }
        }
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        setStatusText('已取消');
      } else {
        const errorMessage: Message = {
          role: 'assistant',
          content: `Failed to connect to Worker: ${error instanceof Error ? error.message : 'Unknown error'}`,
        };
        setMessages((prev) => [...prev, errorMessage]);
      }
    } finally {
      setIsLoading(false);
      setStatusText('');
      abortControllerRef.current = null;
    }
  };

  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  return (
    <div className="flex flex-col h-[600px] border rounded-lg overflow-hidden bg-white shadow-lg">
      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="text-center text-gray-400 mt-20">
            <p className="text-lg mb-2">欢迎使用 Harness Agent</p>
            <p className="text-sm">
              输入消息开始对话，Agent 可以使用工具帮助你完成任务
            </p>
            <div className="mt-6 text-left max-w-md mx-auto">
              <p className="text-xs text-gray-500 mb-2">示例：</p>
              <div className="space-y-2">
                <button
                  onClick={() => handleSendMessage('计算 2 + 3 * 4')}
                  className="block w-full text-left px-3 py-2 text-sm bg-gray-50 rounded hover:bg-gray-100"
                >
                  计算 2 + 3 * 4
                </button>
                <button
                  onClick={() => handleSendMessage('北京今天的天气怎么样？')}
                  className="block w-full text-left px-3 py-2 text-sm bg-gray-50 rounded hover:bg-gray-100"
                >
                  北京今天的天气怎么样？
                </button>
              </div>
            </div>
          </div>
        ) : (
          messages.map((message, index) => (
            <ChatMessage key={index} message={message} />
          ))
        )}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-lg px-4 py-2">
              <div className="flex items-center gap-2">
                <div className="flex space-x-1">
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-100" />
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-200" />
                </div>
                <span className="text-sm text-gray-500">{statusText || 'Agent 思考中...'}</span>
                <button
                  onClick={handleCancel}
                  className="ml-2 text-xs text-red-500 hover:text-red-700"
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 状态栏 */}
      {(lastUsage || lastTraceId) && (
        <div className="px-4 py-2 bg-gray-50 border-t text-xs text-gray-500 flex justify-between">
          {lastUsage && (
            <span>
              Tokens: {lastUsage.totalTokens}
              (prompt: {lastUsage.promptTokens}, completion: {lastUsage.completionTokens})
            </span>
          )}
          {lastTraceId && (
            <span className="font-mono">Trace: {lastTraceId.slice(0, 8)}...</span>
          )}
        </div>
      )}

      {/* 输入框 */}
      <ChatInput onSend={handleSendMessage} disabled={isLoading} />
    </div>
  );
}
