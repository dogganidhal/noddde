/* eslint-disable no-unused-vars */
/**
 * Log levels ordered by severity. `'silent'` suppresses all output.
 */
export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

/**
 * Framework logger interface. Implementations handle level filtering,
 * formatting, and output. The framework calls these methods at
 * instrumentation points throughout the engine.
 *
 * All methods accept a human-readable message and optional structured
 * data for machine-parseable context.
 */
export interface Logger {
  /** Log a debug-level message. Used for verbose tracing (state loads, event details). */
  debug(message: string, data?: Record<string, unknown>): void;
  /** Log an info-level message. Used for lifecycle events (domain init, saga bootstrap). */
  info(message: string, data?: Record<string, unknown>): void;
  /** Log a warn-level message. Used for non-fatal issues (in-memory fallbacks, retries). */
  warn(message: string, data?: Record<string, unknown>): void;
  /** Log an error-level message. Used for failures (handler errors, rollbacks). */
  error(message: string, data?: Record<string, unknown>): void;

  /**
   * Creates a child logger with a narrower namespace.
   * The child inherits the parent's configuration but prepends
   * its namespace to all messages.
   *
   * @param namespace - The sub-namespace (e.g., 'command', 'saga').
   * @returns A new Logger scoped to the given namespace.
   */
  child(namespace: string): Logger;
}
