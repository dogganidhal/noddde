import type { DataSource } from "typeorm";
import type { AggregateLocker } from "@noddde/core";
import { LockTimeoutError } from "@noddde/core";

/**
 * MySQL / MariaDB advisory lock implementation for TypeORM.
 *
 * Uses `GET_LOCK` / `RELEASE_LOCK` via TypeORM's `DataSource.query()`.
 * The lock name is the first 64 characters of `aggregateName:aggregateId`
 * (MySQL's named-lock limit).
 *
 * @internal Used by {@link TypeORMAdvisoryLocker}. Not part of the public API.
 */
export class MySQLLocker implements AggregateLocker {
  constructor(private readonly dataSource: DataSource) {}

  async acquire(
    aggregateName: string,
    aggregateId: string,
    timeoutMs?: number,
  ): Promise<void> {
    const lockName = `${aggregateName}:${aggregateId}`.slice(0, 64);
    const timeoutSec = timeoutMs ? Math.ceil(timeoutMs / 1000) : -1;
    const result = await this.dataSource.query(
      `SELECT GET_LOCK(?, ?) AS acquired`,
      [lockName, timeoutSec],
    );
    // mysql2 may return BIGINT as a JS `number` or a `string` ("1"/"0")
    // depending on `typeCast` config — coerce defensively. GET_LOCK can
    // also return NULL on error, in which case `Number(null)` is 0 and we
    // correctly treat it as a timeout.
    const acquired = Number(result[0]?.acquired);
    if (acquired !== 1)
      throw new LockTimeoutError(aggregateName, aggregateId, timeoutMs ?? 0);
  }

  async release(aggregateName: string, aggregateId: string): Promise<void> {
    const lockName = `${aggregateName}:${aggregateId}`.slice(0, 64);
    await this.dataSource.query(`SELECT RELEASE_LOCK(?)`, [lockName]);
  }
}
