'use client';

import { ToolCallCard, ToolResultCard } from './tool-call';

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

interface ChatMessageProps {
  message: Message;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const isTool = message.role === 'tool';
  const isSystem = message.role === 'system';

  // 系统消息不显示
  if (isSystem) {
    return null;
  }

  // 工具结果
  if (isTool) {
    return <ToolResultCard content={message.content} toolCallId={message.toolCallId} />;
  }

  // 用户消息
  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-lg px-4 py-2 bg-blue-500 text-white">
          <p className="whitespace-pre-wrap">{message.content}</p>
        </div>
      </div>
    );
  }

  // 助手消息（可能包含工具调用）
  return (
    <div className="flex justify-start">
      <div className="max-w-[80%]">
        {/* 工具调用 */}
        {message.toolCalls?.map((toolCall) => (
          <ToolCallCard key={toolCall.id} toolCall={toolCall} />
        ))}

        {/* 消息内容 */}
        {message.content && (
          <div className="rounded-lg px-4 py-2 bg-gray-100 text-gray-900">
            <p className="whitespace-pre-wrap">{message.content}</p>
          </div>
        )}
      </div>
    </div>
  );
}
