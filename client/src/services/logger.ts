import type { LogEntry, LogLevel, Logger } from "../runtime/types.js";

const LEVEL_ORDER: Record<LogLevel, number> = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
};

export interface CreateLoggerOptions {
  minLevel?: LogLevel;
  sink?: (entry: LogEntry) => void;
  baseContext?: Record<string, unknown>;
}

function defaultSink(entry: LogEntry): void {
  const payload = `[Luftballons] ${entry.message}`;
  const args = entry.context ? [payload, entry.context] : [payload];
  switch (entry.level) {
    case "DEBUG":
      console.debug(...args);
      break;
    case "INFO":
      console.info(...args);
      break;
    case "WARN":
      console.warn(...args);
      break;
    case "ERROR":
      console.error(...args);
      break;
  }
}

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const minLevel = options.minLevel ?? "INFO";
  const sink = options.sink ?? defaultSink;
  const baseContext = options.baseContext ?? {};

  const emit = (
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
  ): void => {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) {
      return;
    }
    const merged =
      context === undefined
        ? Object.keys(baseContext).length > 0
          ? { ...baseContext }
          : undefined
        : { ...baseContext, ...context };
    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      ...(merged !== undefined ? { context: merged } : {}),
    };
    sink(entry);
  };

  const logger: Logger = {
    debug: (message, context) => emit("DEBUG", message, context),
    info: (message, context) => emit("INFO", message, context),
    warn: (message, context) => emit("WARN", message, context),
    error: (message, context) => emit("ERROR", message, context),
    child: (context) =>
      createLogger({
        minLevel,
        sink,
        baseContext: { ...baseContext, ...context },
      }),
  };

  return logger;
}
