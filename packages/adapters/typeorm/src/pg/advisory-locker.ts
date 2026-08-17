/* eslint-disable no-unused-vars */
import type { AggregateLocker } from "@noddde/core";
import { LockTimeoutError, fnv1a64 } from "@noddde/core";
import type { Queryable } from "../advisory-locker";
import { KeyedMutex } from "../keyed-mutex";

/**
 * PostgreSQL advisory lock implementation for TypeORM.
 *
 * Uses `pg_advisory_lock` (blocking) and `pg_try_advisory_lock` (with timeout polling)
 * via a single pinned {@link Queryable} connection. The lock key is a 64-bit
 * FNV-1a hash of `aggregateName:aggregateId`.
 *
 * @internal Used by {@link TypeORMAdvisoryLocker}. Not part of the public API.
 */
export class PostgresLocker implements AggregateLocker {
  /**
   * Lock keys this locker instance believes it currently holds. Used to
   * distinguish an idempotent double-`release()` (key absent → no-op) from a
   * release that landed on a different session than the acquire (key
   * present but `pg_advisory_unlock` returns `false` → multiplexing bug).
   */
  private readonly _held = new Set<string>();
  /**
   * Per-process mutex closing the residual re-entrancy hole: PG advisory
   * locks are session-scoped, not call-scoped, so two concurrent commands
   * sharing one pinned connection would otherwise both "acquire".
   */
  private readonly mutex = new KeyedMutex();

  constructor(private readonly getQueryable: () => Promise<Queryable>) {}

  async acquire(
    aggregateName: string,
    aggregateId: string,
    timeoutMs?: number,
  ): Promise<void> {
    const key = `${aggregateName}:${aggregateId}`;
    await this.mutex.lock(key);
    try {
      const hashKey = fnv1a64(key);
      const queryable = await this.getQueryable();
      if (timeoutMs && timeoutMs > 0) {
        const deadline = Date.now() + timeoutMs;
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const result = await queryable.query(
            `SELECT pg_try_advisory_lock($1::bigint) AS acquired`,
            [hashKey],
          );
          const acquired = result[0]?.acquired;
          if (acquired === true || acquired === "t") {
            this._held.add(key);
            return;
          }
          if (Date.now() >= deadline) {
            throw new LockTimeoutError(aggregateName, aggregateId, timeoutMs);
          }
          await new Promise((r) => setTimeout(r, 50));
        }
      } else {
        await queryable.query(`SELECT pg_advisory_lock($1::bigint)`, [hashKey]);
        this._held.add(key);
      }
    } catch (error) {
      this.mutex.unlock(key);
      throw error;
    }
  }

  async release(aggregateName: string, aggregateId: string): Promise<void> {
    const key = `${aggregateName}:${aggregateId}`;
    try {
      const hashKey = fnv1a64(key);
      const believedHeld = this._held.has(key);
      const queryable = await this.getQueryable();

      const result = await queryable.query(
        `SELECT pg_advisory_unlock($1::bigint) AS released`,
        [hashKey],
      );

      const released = result[0]?.released;
      const ok = released === true || released === "t";

      if (ok) {
        this._held.delete(key);
      } else if (believedHeld) {
        throw new Error(
          `TypeORMAdvisoryLocker: pg_advisory_unlock reported the lock for ` +
            `"${aggregateName}:${aggregateId}" was not held on this connection, so it ` +
            `was NOT released and will leak. This means acquire() and release() ran on ` +
            `different sessions.`,
        );
      }
    } finally {
      this.mutex.unlock(key);
    }
  }
}
