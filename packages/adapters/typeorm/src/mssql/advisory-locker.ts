/* eslint-disable no-unused-vars */
import type { DataSource } from "typeorm";
import type { AggregateLocker } from "@noddde/core";
import { LockTimeoutError } from "@noddde/core";

/**
 * MSSQL advisory lock implementation for TypeORM.
 *
 * Uses `sp_getapplock` / `sp_releaseapplock` via TypeORM's `DataSource.query()`.
 * The lock name is the first 255 characters of `aggregateName:aggregateId`
 * (MSSQL's application lock name limit).
 *
 * @internal Used by {@link TypeORMAdvisoryLocker}. Not part of the public API.
 */
export class MSSQLLocker implements AggregateLocker {
  constructor(private readonly dataSource: DataSource) {}

  async acquire(
    aggregateName: string,
    aggregateId: string,
    timeoutMs?: number,
  ): Promise<void> {
    const lockName = `${aggregateName}:${aggregateId}`.slice(0, 255);
    const lockTimeout = timeoutMs && timeoutMs > 0 ? timeoutMs : -1;
    const result = await this.dataSource.query(
      `DECLARE @result int; ` +
        `EXEC @result = sp_getapplock @Resource = @0, @LockMode = 'Exclusive', @LockOwner = 'Session', @LockTimeout = @1; ` +
        `SELECT @result AS lockResult;`,
      [lockName, lockTimeout],
    );
    const lockResult = result[0]?.lockResult;
    if (typeof lockResult === "number" && lockResult < 0) {
      throw new LockTimeoutError(aggregateName, aggregateId, timeoutMs ?? 0);
    }
  }

  async release(aggregateName: string, aggregateId: string): Promise<void> {
    const lockName = `${aggregateName}:${aggregateId}`.slice(0, 255);
    try {
      await this.dataSource.query(
        `EXEC sp_releaseapplock @Resource = @0, @LockOwner = 'Session';`,
        [lockName],
      );
    } catch {
      // Idempotent: releasing an unheld lock raises error 1223 in MSSQL
    }
  }
}
