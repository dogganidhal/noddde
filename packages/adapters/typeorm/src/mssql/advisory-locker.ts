/* eslint-disable no-unused-vars */
import type { AggregateLocker } from "@noddde/core";
import { LockTimeoutError } from "@noddde/core";
import type { Queryable } from "../advisory-locker";
import { KeyedMutex } from "../keyed-mutex";

/**
 * MSSQL advisory lock implementation for TypeORM.
 *
 * Uses `sp_getapplock` / `sp_releaseapplock` via a single pinned
 * {@link Queryable} connection (`sp_getapplock`'s `@LockOwner = 'Session'`
 * requires acquire/release to run on the same session). The lock name is
 * the first 255 characters of `aggregateName:aggregateId` (MSSQL's
 * application lock name limit).
 *
 * @internal Used by {@link TypeORMAdvisoryLocker}. Not part of the public API.
 */
export class MSSQLLocker implements AggregateLocker {
  /**
   * Per-process mutex closing the residual re-entrancy hole: a
   * session-owned `sp_getapplock` is re-entrant within that session, so two
   * concurrent commands sharing one pinned connection would otherwise both
   * "acquire".
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
      const lockName = key.slice(0, 255);
      const lockTimeout = timeoutMs && timeoutMs > 0 ? timeoutMs : -1;
      const queryable = await this.getQueryable();
      const result = await queryable.query(
        `DECLARE @result int; ` +
          `EXEC @result = sp_getapplock @Resource = @0, @LockMode = 'Exclusive', @LockOwner = 'Session', @LockTimeout = @1; ` +
          `SELECT @result AS lockResult;`,
        [lockName, lockTimeout],
      );
      const lockResult = result[0]?.lockResult;
      if (typeof lockResult === "number" && lockResult < 0) {
        throw new LockTimeoutError(aggregateName, aggregateId, timeoutMs ?? 0);
      }
    } catch (error) {
      this.mutex.unlock(key);
      throw error;
    }
  }

  async release(aggregateName: string, aggregateId: string): Promise<void> {
    const key = `${aggregateName}:${aggregateId}`;
    try {
      const lockName = key.slice(0, 255);
      const queryable = await this.getQueryable();
      try {
        await queryable.query(
          `EXEC sp_releaseapplock @Resource = @0, @LockOwner = 'Session';`,
          [lockName],
        );
      } catch {
        // Idempotent: releasing an unheld lock raises error 1223 in MSSQL.
        // `sp_releaseapplock` gives no distinct signal for "released on the
        // wrong session" vs. "already released" — both raise 1223 — so
        // (unlike Postgres/MySQL above) multiplexing detection here would
        // have to guess; we leave it best-effort/absent rather than fake a
        // check that can't reliably distinguish the two cases.
      }
    } finally {
      this.mutex.unlock(key);
    }
  }
}
