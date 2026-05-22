'use client';

interface ApprovalCardProps {
  toolName: string;
  arguments: Record<string, unknown>;
  reason: string;
  onApprove: () => void;
  onReject: () => void;
  isLoading?: boolean;
}

export function ApprovalCard({
  toolName,
  arguments: args,
  reason,
  onApprove,
  onReject,
  isLoading,
}: ApprovalCardProps) {
  return (
    <div className="border-2 border-amber-200 rounded-lg p-4 bg-amber-50">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-amber-600 font-semibold">需要审批</span>
      </div>

      <p className="text-sm text-gray-600 mb-2">{reason}</p>

      <div className="bg-white rounded p-3 mb-3 text-sm">
        <p className="font-medium text-gray-700">工具: {toolName}</p>
        <pre className="mt-1 text-xs text-gray-500 overflow-auto max-h-32">
          {JSON.stringify(args, null, 2)}
        </pre>
      </div>

      <div className="flex gap-2">
        <button
          onClick={onApprove}
          disabled={isLoading}
          className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50 text-sm"
        >
          {isLoading ? '处理中...' : '批准'}
        </button>
        <button
          onClick={onReject}
          disabled={isLoading}
          className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-50 text-sm"
        >
          {isLoading ? '处理中...' : '拒绝'}
        </button>
      </div>
    </div>
  );
}
