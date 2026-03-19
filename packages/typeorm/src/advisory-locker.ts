import type { DataSource } from "typeorm";
import type { AggregateLocker } from "@noddde/core";
import { LockTimeoutError, fnv1a64 } from "@noddde/core";

/**
 * Database-backed {@link AggregateLocker} using advisory locks via TypeORM.
 *
 * Auto-detects the dialect from `dataSource.options.type`. Supports:
 * - `postgres` — uses `pg_advisory_lock` / `pg_try_advisory_lock`
 * - `mysql` / `mariadb` — uses `GET_LOCK` / `RELEASE_LOCK`
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
  private readonly dialect: "postgres" | "mysql";

  constructor(private readonly dataSource: DataSource) {
    const dbType = dataSource.options.type;
    if (dbType === "postgres") {
      this.dialect = "postgres";
    } else if (dbType === "mysql" || dbType === "mariadb") {
      this.dialect = "mysql";
    } else {
      throw new Error(
        `Pessimistic locking is not supported with ${dbType}. ` +
          "Use InMemoryAggregateLocker for single-process deployments.",
      );
    }
  }

  async acquire(
    aggregateName: string,
    aggregateId: string,
    timeoutMs?: number,
  ): Promise<void> {
    const key = `${aggregateName}:${aggregateId}`;
    if (this.dialect === "postgres") {
      const hashKey = fnv1a64(key);
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
    } else if (this.dialect === "mysql") {
      const timeoutSec = timeoutMs ? Math.ceil(timeoutMs / 1000) : -1;
      const lockName = key.slice(0, 64);
      const result = await this.dataSource.query(
        `SELECT GET_LOCK(?, ?) AS acquired`,
        [lockName, timeoutSec],
      );
      const acquired = result[0]?.acquired;
      if (acquired !== 1)
        throw new LockTimeoutError(aggregateName, aggregateId, timeoutMs ?? 0);
    }
  }

  async release(aggregateName: string, aggregateId: string): Promise<void> {
    const key = `${aggregateName}:${aggregateId}`;
    if (this.dialect === "postgres") {
      const hashKey = fnv1a64(key);
      await this.dataSource.query(`SELECT pg_advisory_unlock($1::bigint)`, [
        hashKey,
      ]);
    } else if (this.dialect === "mysql") {
      const lockName = key.slice(0, 64);
      await this.dataSource.query(`SELECT RELEASE_LOCK(?)`, [lockName]);
    }
  }
}
