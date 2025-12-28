export type LogContext = Record<string, unknown>;

export type Logger = {
  debug: (message: string, context?: LogContext) => void;
  info: (message: string, context?: LogContext) => void;
  warn: (message: string, context?: LogContext) => void;
  error: (message: string, context?: LogContext) => void;
};

type ConsoleSink = Pick<Console, "debug" | "info" | "warn" | "error">;

export const NOOP_LOGGER: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export function createLogger(options: {
  debug?: boolean;
  sink?: ConsoleSink;
} = {}): Logger {
  const sink = options.sink ?? console;
  const debugEnabled = options.debug ?? false;

  const write = (level: keyof ConsoleSink, message: string, context?: LogContext) => {
    const payload = formatMessage(message, context);
    sink[level](payload);
  };

  return {
    debug: debugEnabled ? (message, context) => write("debug", message, context) : () => undefined,
    info: (message, context) => write("info", message, context),
    warn: (message, context) => write("warn", message, context),
    error: (message, context) => write("error", message, context),
  };
}

export function isDebugEnabled(value?: string): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function wrapFetchWithLogging(
  fetcher: (request: Request) => Response | Promise<Response>,
  options: {
    logger: Logger;
    label: string;
    now?: () => number;
  }
): (request: Request) => Response | Promise<Response> {
  const now = options.now ?? (() => Date.now());
  return async (request: Request) => {
    const start = now();
    const method = request.method;
    const url = request.url;
    options.logger.debug("request_start", { label: options.label, method, url });
    try {
      const response = await fetcher(request);
      const durationMs = now() - start;
      options.logger.debug("request_end", {
        label: options.label,
        method,
        url,
        status: response.status,
        durationMs,
      });
      return response;
    } catch (error) {
      const durationMs = now() - start;
      options.logger.error("request_error", {
        label: options.label,
        method,
        url,
        durationMs,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };
}

function formatMessage(message: string, context?: LogContext): string {
  if (!context || Object.keys(context).length === 0) {
    return message;
  }
  return `${message} ${JSON.stringify(context)}`;
}
