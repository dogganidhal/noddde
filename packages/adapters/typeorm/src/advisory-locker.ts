import type { DataSource } from "typeorm";
import type { AggregateLocker } from "@noddde/core";
import { PostgresLocker } from "./pg/advisory-locker";
import { MySQLLocker } from "./mysql/advisory-locker";
import { MSSQLLocker } from "./mssql/advisory-locker";

/**
 * Database-backed {@link AggregateLocker} using advisory locks via TypeORM.
 *
 * Auto-detects the dialect from `dataSource.options.type`. Supports:
 * - `postgres` — uses `pg_advisory_lock` / `pg_try_advisory_lock`
 * - `mysql` / `mariadb` — uses `GET_LOCK` / `RELEASE_LOCK`
 * - `mssql` — uses `sp_getapplock` / `sp_releaseapplock`
 *
 * SQLite and better-sqlite3 are not supported — use
 * {@link InMemoryAggregateLocker} for single-process deployments.
 *
 * @example
 * ```ts
 * import { DataSource } from "typeorm";
 * import { TypeORMAdvisoryLocker } from "@noddde/typeorm";
 *
 * const dataSource = new DataSource({ type: "postgres", ... });
 * await dataSource.initialize();
 * const locker = new TypeORMAdvisoryLocker(dataSource);
 *
 * const domain = await configureDomain({
 *   // ...
 *   infrastructure: {
 *     aggregateConcurrency: {
 *       strategy: "pessimistic",
 *       locker,
 *       lockTimeoutMs: 5000,
 *     },
 *   },
 * });
 * ```
 */
export class TypeORMAdvisoryLocker implements AggregateLocker {
  private readonly inner: AggregateLocker;

  constructor(dataSource: DataSource) {
    const dbType = dataSource.options.type;
    if (dbType === "postgres") {
      this.inner = new PostgresLocker(dataSource);
    } else if (dbType === "mysql" || dbType === "mariadb") {
      this.inner = new MySQLLocker(dataSource);
    } else if (dbType === "mssql") {
      this.inner = new MSSQLLocker(dataSource);
    } else {
      throw new Error(
        `Pessimistic locking is not supported with ${dbType}. ` +
          "Use InMemoryAggregateLocker for single-process deployments.",
      );
    }
  }

  acquire(
    aggregateName: string,
    aggregateId: string,
    timeoutMs?: number,
  ): Promise<void> {
    return this.inner.acquire(aggregateName, aggregateId, timeoutMs);
  }

  release(aggregateName: string, aggregateId: string): Promise<void> {
    return this.inner.release(aggregateName, aggregateId);
  }
}
