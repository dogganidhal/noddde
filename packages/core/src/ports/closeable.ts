/* eslint-disable no-unused-vars */

/**
 * Interface for infrastructure components that hold resources requiring
 * cleanup (database connections, file handles, timers, etc.).
 *
 * Implementations must ensure `close()` is idempotent: calling it
 * multiple times has no additional effect after the first call.
 */
export interface Closeable {
  /**
   * Releases all resources held by this component.
   * After `close()` resolves, the component must not be used.
   * Idempotent: subsequent calls resolve immediately.
   */
  close(): Promise<void>;
}

/**
 * Runtime type guard for detecting {@link Closeable} implementations.
 * Used by `Domain.shutdown()` to auto-discover infrastructure
 * components that need cleanup.
 *
 * @param value - The value to check.
 * @returns `true` if the value is an object with a `close` function.
 */
export function isCloseable(value: unknown): value is Closeable {
  return (
    typeof value === "object" &&
    value !== null &&
    "close" in value &&
    typeof (value as Record<string, unknown>).close === "function"
  );
}
