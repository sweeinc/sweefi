/**
 * Logger interface for the Swee ecosystem.
 * Consumers can replace the default console logger with Pino, Winston, etc.
 */
export interface SweeLogger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, error?: Error, context?: Record<string, unknown>): void;
}

/** Default console-based logger */
export const defaultLogger: SweeLogger = {
  debug(message: string, context?: Record<string, unknown>): void {
    console.debug(`[swee:debug] ${message}`, context ?? '');
  },
  info(message: string, context?: Record<string, unknown>): void {
    console.info(`[swee:info] ${message}`, context ?? '');
  },
  warn(message: string, context?: Record<string, unknown>): void {
    console.warn(`[swee:warn] ${message}`, context ?? '');
  },
  error(message: string, error?: Error, context?: Record<string, unknown>): void {
    console.error(`[swee:error] ${message}`, error ?? '', context ?? '');
  },
};
