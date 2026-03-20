/* eslint-disable no-unused-vars */
import type { DataSource } from "typeorm";
import type { AggregateLocker } from "@noddde/core";
import { LockTimeoutError, fnv1a64 } from "@noddde/core";

/**
 * PostgreSQL advisory lock implementation for TypeORM.
 *
 * Uses `pg_advisory_lock` (blocking) and `pg_try_advisory_lock` (with timeout polling)
 * via TypeORM's `DataSource.query()`. The lock key is a 64-bit FNV-1a hash of
 * `aggregateName:aggregateId`.
 *
 * @internal Used by {@link TypeORMAdvisoryLocker}. Not part of the public API.
 */
export class PostgresLocker implements AggregateLocker {
  constructor(private readonly dataSource: DataSource) {}

  async acquire(
    aggregateName: string,
    aggregateId: string,
    timeoutMs?: number,
  ): Promise<void> {
    const hashKey = fnv1a64(`${aggregateName}:${aggregateId}`);
    if (timeoutMs && timeoutMs > 0) {
      const deadline = Date.now() + timeoutMs;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const result = await this.dataSource.query(
          `SELECT pg_try_advisory_lock($1::bigint) AS acquired`,
          [hashKey],
        );
        const acquired = result[0]?.acquired;
        if (acquired === true || acquired === "t") return;
        if (Date.now() >= deadline)
          throw new LockTimeoutError(aggregateName, aggregateId, timeoutMs);
        await new Promise((r) => setTimeout(r, 50));
      }
    } else {
      await this.dataSource.query(`SELECT pg_advisory_lock($1::bigint)`, [
        hashKey,
      ]);
    }
  }

  async release(aggregateName: string, aggregateId: string): Promise<void> {
    const hashKey = fnv1a64(`${aggregateName}:${aggregateId}`);
    await this.dataSource.query(`SELECT pg_advisory_unlock($1::bigint)`, [
      hashKey,
    ]);
  }
}
