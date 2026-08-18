/**
 * Thrown by {@link IdempotencyStore.save} when a record for the given
 * `commandId` already exists, signaling that the command is a duplicate.
 *
 * This is the atomic conflict signal: unlike {@link IdempotencyStore.exists},
 * which is a fast-path check subject to a check-then-act race under
 * concurrency, a thrown `IdempotencyConflictError` from `save()` is the
 * authoritative duplicate signal (analogous to how {@link ConcurrencyError}
 * is the authoritative version-mismatch signal for aggregate persistence).
 *
 * @example
 * ```ts
 * try {
 *   await idempotencyStore.save(record);
 * } catch (error) {
 *   if (error instanceof IdempotencyConflictError) {
 *     // Duplicate command — do not publish events, report as already processed.
 *   }
 * }
 * ```
 */
import type { ID } from "../id";

export class IdempotencyConflictError extends Error {
  public override readonly name = "IdempotencyConflictError";

  constructor(public readonly commandId: ID) {
    super(
      `Idempotency conflict: a record for commandId ${commandId} already exists`,
    );
  }
}
