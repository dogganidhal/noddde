/* eslint-disable no-unused-vars */

/**
 * Interface for background processes that can be drained during shutdown.
 * Examples: outbox relay, event replay workers, scheduled cleanup jobs.
 *
 * During graceful shutdown, the domain calls `drain()` to signal
 * that no new work should be accepted and waits for in-flight work
 * to complete.
 */
export interface BackgroundProcess {
  /**
   * Signals the process to stop accepting new work and waits for
   * all in-flight operations to complete.
   *
   * Must resolve within a reasonable time. The domain may enforce
   * a timeout externally.
   *
   * Idempotent: subsequent calls resolve immediately.
   */
  drain(): Promise<void>;
}
