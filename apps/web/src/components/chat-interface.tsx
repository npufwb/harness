'use client';

import { useState } from 'react';
import { ChatMessage } from './chat-message';
import { ChatInput } from './chat-input';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const handleSendMessage = async (content: string) => {
    if (!content.trim() || isLoading) return;

    // 添加用户消息
    const userMessage: Message = { role: 'user', content };
    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    try {
      // 发送到 Worker
      const response = await fetch('http://localhost:3001/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [
            {
              role: 'system',
              content:
                '你是 Harness Agent，一个有用的 AI 助手。你可以使用工具来帮助用户完成任务。请用中文回答。',
            },
            ...messages.map((m) => ({
              role: m.role,
              content: m.content,
            })),
            userMessage,
          ],
        }),
      });

      const data = (await response.json()) as {
        success: boolean;
        result?: string;
        error?: string;
      };

      if (data.success && data.result) {
        const assistantMessage: Message = {
          role: 'assistant',
          content: data.result,
        };
        setMessages((prev) => [...prev, assistantMessage]);
      } else {
        const errorMessage: Message = {
          role: 'assistant',
          content: `Error: ${data.error ?? 'Unknown error'}`,
        };
        setMessages((prev) => [...prev, errorMessage]);
      }
    } catch (error) {
      const errorMessage: Message = {
        role: 'assistant',
        content: `Failed to connect to Worker: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
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
              <div className="flex space-x-2">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-100" />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-200" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 输入框 */}
      <ChatInput onSend={handleSendMessage} disabled={isLoading} />
    </div>
  );
}
