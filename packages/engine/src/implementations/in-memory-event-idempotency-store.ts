import type { EventIdempotencyStore } from "@noddde/core";

/**
 * In-memory {@link EventIdempotencyStore} implementation that stores
 * processed dedup keys in a `Map` alongside their processed timestamp.
 * Records are lost when the process exits.
 *
 * When constructed with a `ttlMs`, {@link hasProcessed} performs lazy
 * cleanup: if the record has expired, it is deleted and `false` is
 * returned. Without `ttlMs`, records never auto-expire from
 * {@link hasProcessed}.
 *
 * Suitable for development, testing, and single-process prototyping.
 * For multi-instance deployments, use a durable, shared
 * `EventIdempotencyStore` (e.g. `TypeORMEventIdempotencyStore`,
 * `DrizzleEventIdempotencyStore`, or `PrismaEventIdempotencyStore`).
 */
export class InMemoryEventIdempotencyStore implements EventIdempotencyStore {
  private readonly store = new Map<string, number>();

  /**
   * @param ttlMs - Optional time-to-live in milliseconds. When set,
   *   {@link hasProcessed} performs lazy cleanup of expired records.
   */
  constructor(private readonly ttlMs?: number) {}

  /**
   * Checks whether the given key has already been recorded as processed.
   * When `ttlMs` is configured, performs lazy cleanup: if the record has
   * expired, it is deleted and `false` is returned.
   *
   * @param key - The dedup key to check.
   * @returns `true` if the record exists and has not expired, `false` otherwise.
   */
  public async hasProcessed(key: string): Promise<boolean> {
    const recordedAt = this.store.get(key);
    if (recordedAt === undefined) {
      return false;
    }
    if (this.ttlMs != null && Date.now() - recordedAt > this.ttlMs) {
      this.store.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Records the given key as processed with the current timestamp.
   * Overwrites any existing record for the same key.
   *
   * @param key - The dedup key to record.
   */
  public async markProcessed(key: string): Promise<void> {
    this.store.set(key, Date.now());
  }

  /**
   * Removes all records recorded more than `ttlMs` milliseconds ago.
   *
   * @param ttlMs - The time-to-live in milliseconds.
   */
  public async removeExpired(ttlMs: number): Promise<void> {
    const cutoff = Date.now() - ttlMs;
    for (const [key, recordedAt] of this.store) {
      if (recordedAt <= cutoff) {
        this.store.delete(key);
      }
    }
  }
}
