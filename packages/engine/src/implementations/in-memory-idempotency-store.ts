/* eslint-disable no-unused-vars */
import type { ID, IdempotencyRecord, IdempotencyStore } from "@noddde/core";

/**
 * In-memory {@link IdempotencyStore} implementation that stores processed
 * command records in a `Map`. Records are lost when the process exits.
 *
 * Records are keyed by `String(commandId)` to normalize the {@link ID}
 * union type (`string | number | bigint`) to string map keys.
 *
 * When constructed with a `ttlMs`, the {@link exists} method performs lazy
 * cleanup: if the record has expired, it is deleted and `false` is returned.
 * Without `ttlMs`, records never auto-expire from `exists()`.
 *
 * Suitable for development, testing, and prototyping.
 * For production, use a durable idempotency store (PostgreSQL, Redis, etc.).
 */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly store = new Map<string, IdempotencyRecord>();

  /**
   * @param ttlMs - Optional time-to-live in milliseconds. When set,
   *   {@link exists} performs lazy cleanup of expired records.
   */
  constructor(private readonly ttlMs?: number) {}

  /**
   * Checks whether a command with the given ID has already been processed.
   * When `ttlMs` is configured, performs lazy cleanup: if the record
   * has expired, it is deleted and `false` is returned.
   *
   * @param commandId - The unique command identifier to check.
   * @returns `true` if the record exists and has not expired, `false` otherwise.
   */
  public async exists(commandId: ID): Promise<boolean> {
    const key = String(commandId);
    const record = this.store.get(key);
    if (!record) {
      return false;
    }
    if (this.ttlMs != null) {
      const processedAt = new Date(record.processedAt).getTime();
      if (Date.now() - processedAt > this.ttlMs) {
        this.store.delete(key);
        return false;
      }
    }
    return true;
  }

  /**
   * Records that a command has been processed.
   * Overwrites any existing record with the same `commandId`.
   *
   * @param record - The idempotency record to persist.
   */
  public async save(record: IdempotencyRecord): Promise<void> {
    const key = String(record.commandId);
    this.store.set(key, record);
  }

  /**
   * Removes a single idempotency record. No-op if the record does not exist.
   *
   * @param commandId - The unique command identifier to remove.
   */
  public async remove(commandId: ID): Promise<void> {
    const key = String(commandId);
    this.store.delete(key);
  }

  /**
   * Removes all records whose `processedAt` timestamp is older than
   * `Date.now() - ttlMs`.
   *
   * @param ttlMs - The time-to-live in milliseconds.
   */
  public async removeExpired(ttlMs: number): Promise<void> {
    const cutoff = Date.now() - ttlMs;
    for (const [key, record] of this.store) {
      if (new Date(record.processedAt).getTime() <= cutoff) {
        this.store.delete(key);
      }
    }
  }
}
