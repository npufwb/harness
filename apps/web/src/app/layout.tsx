import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Harness - Agent 控制台',
  description: 'Agent 工程平台 — 构建可控、可观测、可治理的 AI Agent',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
