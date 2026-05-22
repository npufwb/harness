import pino from 'pino';

export interface LoggerOptions {
  level?: string;
  pretty?: boolean;
  name?: string;
}

/**
 * 创建 Pino 日志实例
 */
export function createLogger(options: LoggerOptions = {}): pino.Logger {
  const { level = 'info', pretty = false, name } = options;

  const pinoOptions: pino.LoggerOptions = {
    level,
  };

  if (pretty) {
    pinoOptions.transport = {
      target: 'pino-pretty',
      options: {
        colorize: true,
      },
    };
  }

  const logger = pino(pinoOptions);

  if (name) {
    return logger.child({ name });
  }

  return logger;
}

// 默认日志实例
export const logger = createLogger({
  level: process.env['LOG_LEVEL'] ?? 'info',
  pretty: process.env['NODE_ENV'] !== 'production',
});

/**
 * 创建带 traceId 的子日志实例
 */
export function createTraceLogger(traceId: string): pino.Logger {
  return logger.child({ traceId });
}
