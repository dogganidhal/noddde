/* eslint-disable no-unused-vars */
import type { AggregateLocker } from "@noddde/core";
import { LockTimeoutError } from "@noddde/core";
import type { Queryable } from "../advisory-locker";
import { KeyedMutex } from "../keyed-mutex";

/**
 * MySQL / MariaDB advisory lock implementation for TypeORM.
 *
 * Uses `GET_LOCK` / `RELEASE_LOCK` via a single pinned {@link Queryable}
 * connection. The lock name is the first 64 characters of
 * `aggregateName:aggregateId` (MySQL's named-lock limit).
 *
 * @internal Used by {@link TypeORMAdvisoryLocker}. Not part of the public API.
 */
export class MySQLLocker implements AggregateLocker {
  /**
   * Lock names this locker instance believes it currently holds. Used to
   * distinguish an idempotent double-`release()` (name absent → no-op) from
   * a release that landed on a different session than the acquire (name
   * present but `RELEASE_LOCK` returns `0`/`NULL` → multiplexing bug).
   */
  private readonly _held = new Set<string>();
  /**
   * Per-process mutex closing the residual re-entrancy hole: MySQL advisory
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
      const lockName = key.slice(0, 64);
      const timeoutSec = timeoutMs ? Math.ceil(timeoutMs / 1000) : -1;
      const queryable = await this.getQueryable();
      const result = await queryable.query(
        `SELECT GET_LOCK(?, ?) AS acquired`,
        [lockName, timeoutSec],
      );
      const acquired = Number(result[0]?.acquired);
      if (acquired !== 1) {
        throw new LockTimeoutError(aggregateName, aggregateId, timeoutMs ?? 0);
      }
      this._held.add(key);
    } catch (error) {
      this.mutex.unlock(key);
      throw error;
    }
  }

  async release(aggregateName: string, aggregateId: string): Promise<void> {
    const key = `${aggregateName}:${aggregateId}`;
    try {
      const lockName = key.slice(0, 64);
      const believedHeld = this._held.has(key);
      const queryable = await this.getQueryable();

      const result = await queryable.query(
        `SELECT RELEASE_LOCK(?) AS released`,
        [lockName],
      );

      const released = Number(result[0]?.released);
      const ok = released === 1;

      if (ok) {
        this._held.delete(key);
      } else if (believedHeld) {
        throw new Error(
          `TypeORMAdvisoryLocker: RELEASE_LOCK reported the lock for ` +
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
