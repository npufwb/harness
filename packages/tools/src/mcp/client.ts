import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { Tool, ToolResult } from '@harness/shared';
import { logger } from '@harness/shared';
import type { MCPServerConfig } from './config.js';

export interface MCPClientOptions {
  name: string;
  config: MCPServerConfig;
}

/**
 * MCP 客户端封装
 */
export class MCPClient {
  private client: Client;
  private name: string;
  private config: MCPServerConfig;
  private connected = false;

  constructor(options: MCPClientOptions) {
    this.name = options.name;
    this.config = options.config;

    this.client = new Client(
      { name: `harness-${options.name}`, version: '1.0.0' }
    );
  }

  /**
   * 连接到 MCP 服务器
   */
  async connect(): Promise<void> {
    logger.info({ name: this.name, transport: this.config.transport }, 'Connecting to MCP server');

    let transport;

    if (this.config.transport === 'stdio') {
      if (!this.config.command) {
        throw new Error('stdio transport requires command');
      }
      transport = new StdioClientTransport({
        command: this.config.command,
        args: this.config.args,
        env: this.config.env as Record<string, string>,
      });
    } else if (this.config.transport === 'sse') {
      if (!this.config.url) {
        throw new Error('sse transport requires url');
      }
      transport = new SSEClientTransport(new URL(this.config.url));
    } else {
      throw new Error(`Unsupported transport: ${this.config.transport}`);
    }

    await this.client.connect(transport);
    this.connected = true;
    logger.info({ name: this.name }, 'Connected to MCP server');
  }

  /**
   * 获取服务器提供的工具列表
   */
  async listTools(): Promise<Tool[]> {
    if (!this.connected) {
      throw new Error(`MCP client "${this.name}" not connected`);
    }

    const response = await this.client.listTools();

    return response.tools.map((tool: Record<string, unknown>) => ({
      name: tool['name'] as string,
      description: (tool['description'] as string) ?? '',
      inputSchema: tool['inputSchema'] as Tool['inputSchema'],
    }));
  }

  /**
   * 调用工具
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (!this.connected) {
      throw new Error(`MCP client "${this.name}" not connected`);
    }

    logger.debug({ server: this.name, toolName: name, args }, 'Calling MCP tool');

    try {
      const response = await this.client.callTool({ name, arguments: args });

      // 提取结果内容
      const contentArray = response.content as Array<Record<string, unknown>>;
      const content = contentArray
        .map((c: Record<string, unknown>) => {
          if (c['type'] === 'text') return c['text'] as string;
          if (c['type'] === 'image') return `[Image: ${c['mimeType']}]`;
          return `[${c['type']}]`;
        })
        .join('\n');

      return {
        content,
        isError: response.isError as boolean,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ server: this.name, toolName: name, error: errorMessage }, 'MCP tool call failed');

      return {
        content: `Error: ${errorMessage}`,
        isError: true,
      };
    }
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    if (this.connected) {
      await this.client.close();
      this.connected = false;
      logger.info({ name: this.name }, 'Disconnected from MCP server');
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  getName(): string {
    return this.name;
  }
}
