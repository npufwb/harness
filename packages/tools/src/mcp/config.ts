import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { logger } from '@harness/shared';

export interface MCPServerConfig {
  transport: 'stdio' | 'sse';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
}

export interface MCPConfig {
  servers: Record<string, MCPServerConfig>;
}

/**
 * 加载 MCP 配置文件
 */
export function loadMCPConfig(configPath?: string): MCPConfig {
  const defaultPath = resolve(process.cwd(), 'mcp.config.json');
  const path = configPath ?? defaultPath;

  try {
    logger.info({ path }, 'Loading MCP config');
    const content = readFileSync(path, 'utf-8');
    const config = JSON.parse(content) as MCPConfig;

    // 验证配置
    if (!config.servers || typeof config.servers !== 'object') {
      throw new Error('Invalid MCP config: servers must be an object');
    }

    for (const [name, server] of Object.entries(config.servers)) {
      if (server.transport === 'stdio' && !server.command) {
        throw new Error(`Server "${name}": stdio transport requires "command"`);
      }
      if (server.transport === 'sse' && !server.url) {
        throw new Error(`Server "${name}": sse transport requires "url"`);
      }
    }

    logger.info(
      { serverCount: Object.keys(config.servers).length },
      'MCP config loaded'
    );

    return config;
  } catch (error) {
    if (error instanceof Error && error.message.includes('ENOENT')) {
      logger.warn({ path }, 'MCP config file not found, using empty config');
      return { servers: {} };
    }
    throw error;
  }
}
