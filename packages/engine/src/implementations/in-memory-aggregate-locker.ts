/* eslint-disable no-unused-vars */
import type { AggregateLocker, ID } from "@noddde/core";
import { LockTimeoutError } from "@noddde/core";

/**
 * In-memory {@link AggregateLocker} using promise-based mutexes.
 * Each aggregate instance key gets an independent FIFO lock queue.
 *
 * Suitable for single-process development and testing.
 * For multi-process production, use database-backed advisory locks
 * (`DrizzleAdvisoryLocker`, `PrismaAdvisoryLocker`, `TypeORMAdvisoryLocker`).
 */
export class InMemoryAggregateLocker implements AggregateLocker {
  private readonly locks = new Map<
    string,
    {
      locked: boolean;
      queue: Array<{
        resolve: () => void;
        reject: (err: Error) => void;
      }>;
    }
  >();

  private getEntry(key: string) {
    let entry = this.locks.get(key);
    if (!entry) {
      entry = { locked: false, queue: [] };
      this.locks.set(key, entry);
    }
    return entry;
  }

  /**
   * Acquires the lock for the given aggregate instance.
   * If the lock is held, the caller waits in a FIFO queue.
   *
   * @param aggregateName - The aggregate type name.
   * @param aggregateId - The unique identifier of the aggregate instance.
   * @param timeoutMs - Optional timeout in milliseconds. 0 or undefined = no timeout.
   * @throws {LockTimeoutError} if the lock cannot be acquired within the timeout.
   */
  public async acquire(
    aggregateName: string,
    aggregateId: ID,
    timeoutMs?: number,
  ): Promise<void> {
    const key = `${aggregateName}:${aggregateId}`;
    const entry = this.getEntry(key);

    if (!entry.locked) {
      entry.locked = true;
      return;
    }

    // Lock is held — enqueue and wait
    return new Promise<void>((resolve, reject) => {
      const waiter = { resolve, reject };
      entry.queue.push(waiter);

      if (timeoutMs && timeoutMs > 0) {
        const timer = setTimeout(() => {
          const idx = entry.queue.indexOf(waiter);
          if (idx !== -1) {
            entry.queue.splice(idx, 1);
            reject(new LockTimeoutError(aggregateName, aggregateId, timeoutMs));
          }
        }, timeoutMs);

        // Wrap resolve to clear timeout on successful acquisition
        const originalResolve = waiter.resolve;
        waiter.resolve = () => {
          clearTimeout(timer);
          originalResolve();
        };
      }
    });
  }

  /**
   * Releases the lock for the given aggregate instance.
   * If waiters are queued, the next one acquires the lock.
   * Idempotent: releasing an already-released lock is a no-op.
   *
   * @param aggregateName - The aggregate type name.
   * @param aggregateId - The unique identifier of the aggregate instance.
   */
  public async release(aggregateName: string, aggregateId: ID): Promise<void> {
    const key = `${aggregateName}:${aggregateId}`;
    const entry = this.locks.get(key);
    if (!entry || !entry.locked) return; // idempotent

    if (entry.queue.length > 0) {
      // Transfer ownership to next waiter (lock stays held)
      const next = entry.queue.shift()!;
      next.resolve();
    } else {
      entry.locked = false;
    }
  }
}
