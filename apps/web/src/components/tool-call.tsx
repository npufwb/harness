'use client';

import { useState } from 'react';

interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

interface ToolCallProps {
  toolCall: ToolCall;
}

export function ToolCallCard({ toolCall }: ToolCallProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 my-2">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 w-full text-left"
      >
        <span className="text-blue-500">&#x1f527;</span>
        <span className="font-medium text-blue-700">
          调用工具: {toolCall.name}
        </span>
        <span className="text-blue-400 text-sm ml-auto">
          {isExpanded ? '收起' : '展开'}
        </span>
      </button>
      {isExpanded && (
        <div className="mt-2 p-2 bg-white rounded border border-blue-100">
          <p className="text-xs text-gray-500 mb-1">参数：</p>
          <pre className="text-sm text-gray-700 overflow-x-auto">
            {JSON.stringify(toolCall.arguments, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

interface ToolResultProps {
  content: string;
  toolCallId?: string;
}

export function ToolResultCard({ content, toolCallId }: ToolResultProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // 尝试解析 JSON
  let displayContent = content;
  let isJson = false;
  try {
    const parsed = JSON.parse(content);
    displayContent = JSON.stringify(parsed, null, 2);
    isJson = true;
  } catch {
    // 不是 JSON，直接显示
  }

  return (
    <div className="bg-green-50 border border-green-200 rounded-lg p-3 my-2 ml-4">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 w-full text-left"
      >
        <span className="text-green-500">&#x2705;</span>
        <span className="font-medium text-green-700">工具返回结果</span>
        <span className="text-green-400 text-sm ml-auto">
          {isExpanded ? '收起' : '展开'}
        </span>
      </button>
      {isExpanded && (
        <div className="mt-2 p-2 bg-white rounded border border-green-100">
          <pre className={`text-sm overflow-x-auto ${isJson ? 'text-gray-700' : 'text-gray-600'}`}>
            {displayContent}
          </pre>
          {toolCallId && (
            <p className="text-xs text-gray-400 mt-2">ID: {toolCallId}</p>
          )}
        </div>
      )}
    </div>
  );
}
