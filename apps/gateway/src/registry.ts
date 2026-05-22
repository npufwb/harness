import { toolDefinitions, toolHandlers, MCPClient, loadMCPConfig } from '@harness/tools';
import type { Tool, ToolResult } from '@harness/shared';
import { logger } from '@harness/shared';

export interface MCPService {
  name: string;
  tools: Tool[];
  handler: (toolName: string, input: Record<string, unknown>) => Promise<ToolResult>;
}

// 工具注册表
export class ToolRegistry {
  private services = new Map<string, MCPService>();
  private toolToService = new Map<string, string>();
  private mcpClients: MCPClient[] = [];

  constructor() {
    // 注册内置工具
    this.registerBuiltinTools();
  }

  /**
   * 加载 MCP 配置并连接外部服务
   */
  async loadMCPServices(configPath?: string): Promise<void> {
    const config = loadMCPConfig(configPath);

    for (const [name, serverConfig] of Object.entries(config.servers)) {
      try {
        const client = new MCPClient({ name, config: serverConfig });
        await client.connect();

        // 获取工具列表
        const tools = await client.listTools();
        logger.info({ serverName: name, toolCount: tools.length }, 'Discovered MCP tools');

        // 注册为服务
        this.registerService({
          name,
          tools,
          handler: async (toolName: string, input: Record<string, unknown>) => {
            return client.callTool(toolName, input);
          },
        });

        this.mcpClients.push(client);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error({ serverName: name, error: errorMessage }, 'Failed to connect to MCP server');
      }
    }
  }

  private registerBuiltinTools(): void {
    const builtinService: MCPService = {
      name: 'builtin',
      tools: toolDefinitions,
      handler: async (toolName: string, input: Record<string, unknown>) => {
        const handler = toolHandlers.get(toolName);
        if (!handler) {
          return {
            content: `Tool "${toolName}" not found`,
            isError: true,
          };
        }
        return handler(input);
      },
    };

    this.registerService(builtinService);
  }

  registerService(service: MCPService): void {
    logger.info(
      { serviceName: service.name, toolCount: service.tools.length },
      'Registering MCP service'
    );

    this.services.set(service.name, service);

    for (const tool of service.tools) {
      this.toolToService.set(tool.name, service.name);
    }
  }

  getServiceForTool(toolName: string): MCPService | undefined {
    const serviceName = this.toolToService.get(toolName);
    if (!serviceName) return undefined;
    return this.services.get(serviceName);
  }

  getToolDefinition(toolName: string): Tool | undefined {
    const service = this.getServiceForTool(toolName);
    return service?.tools.find((t) => t.name === toolName);
  }

  getAllTools(): Tool[] {
    const tools: Tool[] = [];
    for (const service of this.services.values()) {
      tools.push(...service.tools);
    }
    return tools;
  }

  getServices(): MCPService[] {
    return Array.from(this.services.values());
  }

  async executeTool(toolName: string, input: Record<string, unknown>): Promise<ToolResult> {
    const service = this.getServiceForTool(toolName);

    if (!service) {
      return {
        content: `Tool "${toolName}" not found`,
        isError: true,
      };
    }

    logger.debug({ toolName, serviceName: service.name }, 'Executing tool');

    try {
      return await service.handler(toolName, input);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ toolName, error: errorMessage }, 'Tool execution failed');

      return {
        content: `Error executing tool "${toolName}": ${errorMessage}`,
        isError: true,
      };
    }
  }

  /**
   * 断开所有 MCP 连接
   */
  async disconnect(): Promise<void> {
    for (const client of this.mcpClients) {
      await client.disconnect();
    }
    this.mcpClients = [];
  }
}
