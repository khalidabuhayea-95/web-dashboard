/**
 * Structured logging utility for consistent logging across the application
 */

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogContext {
  userId?: string;
  requestId?: string;
  route?: string;
  [key: string]: unknown;
}

class Logger {
  private isDev = process.env.NODE_ENV !== "production";
  private scope?: string;
  private parentContext?: LogContext;

  constructor(scope?: string, parentContext?: LogContext) {
    this.scope = scope;
    this.parentContext = parentContext;
  }

  private formatMessage(level: LogLevel, message: string, context?: LogContext) {
    const timestamp = new Date().toISOString();
    // Merge parent context with provided context
    const mergedContext = { ...this.parentContext, ...context };
    return {
      timestamp,
      level,
      scope: this.scope,
      message,
      ...mergedContext,
    };
  }

  debug(message: string, context?: LogContext) {
    if (this.isDev) {
      console.debug(this.formatMessage("debug", message, context));
    }
  }

  info(message: string, context?: LogContext) {
    console.log(this.formatMessage("info", message, context));
  }

  warn(message: string, context?: LogContext) {
    console.warn(this.formatMessage("warn", message, context));
  }

  error(message: string, error?: Error | unknown, context?: LogContext) {
    console.error(this.formatMessage("error", message, context), error);
  }

  /**
   * Create a child logger with additional context
   * @param context - Context to attach to all logs from this logger instance
   * @returns Logger instance with merged context
   */
  child(context: LogContext): Logger {
    const mergedContext = { ...this.parentContext, ...context };
    return new Logger(this.scope, mergedContext);
  }
}

// Default logger instance with no scope
export const logger = new Logger();

/**
 * Create a scoped logger for a specific module/context
 * @param scope - The scope/context name (e.g., "api.mobile.fonts")
 * @returns Logger instance with the specified scope
 */
export function createLogger(scope: string): Logger {
  return new Logger(scope);
}
