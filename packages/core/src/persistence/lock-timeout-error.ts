/**
 * Thrown when an {@link AggregateLocker} cannot acquire a lock
 * within the configured timeout period.
 *
 * This is a distinct error from {@link ConcurrencyError}:
 * - `ConcurrencyError`: version mismatch detected during save (optimistic)
 * - `LockTimeoutError`: lock acquisition timed out (pessimistic)
 *
 * @example
 * ```ts
 * try {
 *   await locker.acquire("Account", "acc-1", 5000);
 * } catch (error) {
 *   if (error instanceof LockTimeoutError) {
 *     // Lock not acquired within 5 seconds
 *   }
 * }
 * ```
 */
import type { ID } from "../id";

export class LockTimeoutError extends Error {
  public override readonly name = "LockTimeoutError";

  constructor(
    public readonly aggregateName: string,
    public readonly aggregateId: ID,
    public readonly timeoutMs: number,
  ) {
    super(
      `Lock acquisition timed out for ${aggregateName}:${aggregateId} ` +
        `after ${timeoutMs}ms`,
    );
  }
}
