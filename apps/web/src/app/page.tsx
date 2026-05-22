import { ChatInterface } from '@/components/chat-interface';
import { FeatureShowcase } from '@/components/feature-showcase';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center p-12">
      <div className="z-10 w-full max-w-5xl">
        <h1 className="text-4xl font-bold text-center mb-4">Harness</h1>
        <p className="text-center text-gray-500 mb-8">
          Agent 工程平台 — 构建可控、可观测、可治理的 AI Agent
        </p>

        <FeatureShowcase />

        <div className="mt-8">
          <ChatInterface />
        </div>
      </div>
    </main>
  );
}
