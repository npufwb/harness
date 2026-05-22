'use client';

import { useState } from 'react';

interface Feature {
  id: string;
  title: string;
  icon: string;
  description: string;
  details: string[];
  phase: 1 | 2;
}

const features: Feature[] = [
  {
    id: 'agent',
    title: 'Agent 编排',
    icon: '🤖',
    description: '基于 LangGraph 的状态图编排',
    details: [
      'Agent → Tool → Agent 循环',
      '支持多轮工具调用',
      '流式输出 (SSE)',
    ],
    phase: 1,
  },
  {
    id: 'tools',
    title: 'MCP 工具集成',
    icon: '🔧',
    description: '统一工具端点，支持 MCP 协议',
    details: [
      '内置工具：计算器、天气查询',
      'MCP 服务动态发现',
      'Gateway 统一路由',
    ],
    phase: 1,
  },
  {
    id: 'memory',
    title: '记忆系统',
    icon: '🧠',
    description: '分层记忆：短期、工作、长期',
    details: [
      '短期记忆：会话内消息历史',
      '工作记忆：LangGraph checkpoint',
      '长期记忆：用户偏好 KV 存储',
    ],
    phase: 2,
  },
  {
    id: 'checkpoint',
    title: '可恢复执行',
    icon: '💾',
    description: 'LangGraph PostgresSaver 持久化',
    details: [
      'Thread 级别状态持久化',
      '断点续跑',
      '执行历史回溯',
    ],
    phase: 2,
  },
  {
    id: 'hitl',
    title: '人工审批 (HITL)',
    icon: '✋',
    description: '高风险操作人工审批',
    details: [
      '按工具触发审批',
      '按规则触发审批',
      '嵌入聊天流的审批卡片',
    ],
    phase: 2,
  },
  {
    id: 'audit',
    title: '审计日志',
    icon: '📋',
    description: '工具调用全链路审计',
    details: [
      '调用参数和结果记录',
      '耗时和状态追踪',
      '审批决策记录',
    ],
    phase: 2,
  },
];

export function FeatureShowcase() {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
      {features.map((feature) => (
        <div
          key={feature.id}
          className="border rounded-lg p-4 cursor-pointer hover:shadow-md transition-shadow bg-white"
          onClick={() => setExpandedId(expandedId === feature.id ? null : feature.id)}
        >
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xl">{feature.icon}</span>
            <h3 className="font-semibold text-sm">{feature.title}</h3>
            <span
              className={`text-xs px-1.5 py-0.5 rounded ${
                feature.phase === 1
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-green-100 text-green-700'
              }`}
            >
              P{feature.phase}
            </span>
          </div>
          <p className="text-xs text-gray-500">{feature.description}</p>

          {expandedId === feature.id && (
            <ul className="mt-3 space-y-1">
              {feature.details.map((detail, i) => (
                <li key={i} className="text-xs text-gray-600 flex items-start gap-1">
                  <span className="text-green-500 mt-0.5">✓</span>
                  {detail}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
