/**
 * Thrown by persistence implementations when a save operation detects
 * a version mismatch, indicating a concurrent modification to the
 * same aggregate instance.
 *
 * For event-sourced persistence, the version is the event stream length.
 * For state-stored persistence, the version is a monotonically increasing integer.
 *
 * @example
 * ```ts
 * try {
 *   await persistence.save("Account", "acc-1", events, expectedVersion);
 * } catch (error) {
 *   if (error instanceof ConcurrencyError) {
 *     // Retry or propagate
 *   }
 * }
 * ```
 */
export class ConcurrencyError extends Error {
  public override readonly name = "ConcurrencyError";

  constructor(
    public readonly aggregateName: string,
    public readonly aggregateId: string,
    public readonly expectedVersion: number,
    public readonly actualVersion: number,
  ) {
    super(
      `Concurrency conflict on ${aggregateName}:${aggregateId}: ` +
        `expected version ${expectedVersion}, actual ${actualVersion}`,
    );
  }
}
