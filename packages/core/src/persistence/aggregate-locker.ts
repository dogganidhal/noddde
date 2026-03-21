/* eslint-disable no-unused-vars */
import type { ID } from "../id";

/**
 * Acquires and releases exclusive locks per aggregate instance.
 * Used by the pessimistic concurrency strategy to serialize
 * command execution against the same aggregate.
 *
 * Implementations must ensure that:
 * - Two concurrent `acquire()` calls for the same key block until
 *   the first lock is released.
 * - `release()` is idempotent (calling it twice does not throw).
 * - Locks are not reentrant (acquiring a lock you already hold blocks).
 *
 * @see {@link LockTimeoutError} thrown when acquisition times out.
 */
export interface AggregateLocker {
  /**
   * Acquires an exclusive lock for the given aggregate instance.
   * Blocks until the lock is available or the timeout expires.
   *
   * @param aggregateName - The aggregate type name.
   * @param aggregateId - The unique identifier of the aggregate instance.
   * @param timeoutMs - Maximum time in milliseconds to wait for the lock.
   *   Pass 0 or undefined for no timeout (block indefinitely).
   * @throws {LockTimeoutError} if the lock cannot be acquired within the timeout.
   */
  acquire(
    aggregateName: string,
    aggregateId: ID,
    timeoutMs?: number,
  ): Promise<void>;

  /**
   * Releases a previously acquired lock. Must be called in a `finally`
   * block to prevent lock leaks. Idempotent: releasing an already-released
   * lock is a no-op.
   *
   * @param aggregateName - The aggregate type name.
   * @param aggregateId - The unique identifier of the aggregate instance.
   */
  release(aggregateName: string, aggregateId: ID): Promise<void>;
}
