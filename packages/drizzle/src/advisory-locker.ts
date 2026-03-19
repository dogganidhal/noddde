/* eslint-disable no-unused-vars */
import { sql } from "drizzle-orm";
import type { AggregateLocker } from "@noddde/core";
import { LockTimeoutError, fnv1a64 } from "@noddde/core";

type DrizzleDialect = "pg" | "mysql" | "sqlite";

/**
 * Database-backed {@link AggregateLocker} using advisory locks via Drizzle ORM.
 *
 * Supports PostgreSQL (`pg_advisory_lock`) and MySQL (`GET_LOCK`).
 * SQLite does not support advisory locks — use {@link InMemoryAggregateLocker}
 * for single-process SQLite deployments.
 *
 * @example
 * ```ts
 * import { drizzle } from "drizzle-orm/node-postgres";
 * import { DrizzleAdvisoryLocker } from "@noddde/drizzle";
 *
 * const db = drizzle(pool);
 * const locker = new DrizzleAdvisoryLocker(db, "pg");
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
export class DrizzleAdvisoryLocker implements AggregateLocker {
  constructor(
    private readonly db: any,
    private readonly dialect: DrizzleDialect,
  ) {
    if (dialect === "sqlite") {
      throw new Error(
        "Pessimistic locking is not supported with SQLite. " +
          "Use InMemoryAggregateLocker for single-process SQLite deployments.",
      );
    }
  }

  async acquire(
    aggregateName: string,
    aggregateId: string,
    timeoutMs?: number,
  ): Promise<void> {
    const key = `${aggregateName}:${aggregateId}`;
    if (this.dialect === "pg") {
      const hashKey = fnv1a64(key);
      if (timeoutMs && timeoutMs > 0) {
        const deadline = Date.now() + timeoutMs;
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const result = await this.db.execute(
            sql`SELECT pg_try_advisory_lock(${hashKey}::bigint) AS acquired`,
          );
          const acquired = result.rows?.[0]?.acquired ?? result[0]?.acquired;
          if (acquired === true || acquired === "t") return;
          if (Date.now() >= deadline)
            throw new LockTimeoutError(aggregateName, aggregateId, timeoutMs);
          await new Promise((r) => setTimeout(r, 50));
        }
      } else {
        await this.db.execute(sql`SELECT pg_advisory_lock(${hashKey}::bigint)`);
      }
    } else if (this.dialect === "mysql") {
      const timeoutSec = timeoutMs ? Math.ceil(timeoutMs / 1000) : -1;
      const lockName = key.slice(0, 64);
      const result = await this.db.execute(
        sql`SELECT GET_LOCK(${lockName}, ${timeoutSec}) AS acquired`,
      );
      const acquired = result.rows?.[0]?.acquired ?? result[0]?.acquired;
      if (acquired !== 1)
        throw new LockTimeoutError(aggregateName, aggregateId, timeoutMs ?? 0);
    }
  }

  async release(aggregateName: string, aggregateId: string): Promise<void> {
    const key = `${aggregateName}:${aggregateId}`;
    if (this.dialect === "pg") {
      const hashKey = fnv1a64(key);
      await this.db.execute(sql`SELECT pg_advisory_unlock(${hashKey}::bigint)`);
    } else if (this.dialect === "mysql") {
      const lockName = key.slice(0, 64);
      await this.db.execute(sql`SELECT RELEASE_LOCK(${lockName})`);
    }
  }
}
