/* eslint-disable no-unused-vars */
import type { AggregateLocker } from "@noddde/core";
import { PostgresLocker } from "./pg/advisory-locker";
import { MySQLLocker } from "./mysql/advisory-locker";

export type DrizzleDialect = "pg" | "mysql" | "sqlite";

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
 * import { wireDomain } from "@noddde/engine";
 *
 * const db = drizzle(pool);
 * const locker = new DrizzleAdvisoryLocker(db, "pg");
 *
 * const domain = await wireDomain(definition, {
 *   aggregates: {
 *     concurrency: {
 *       strategy: "pessimistic",
 *       locker,
 *       lockTimeoutMs: 5000,
 *     },
 *   },
 * });
 * ```
 */
export class DrizzleAdvisoryLocker implements AggregateLocker {
  private readonly inner: AggregateLocker;

  constructor(db: any, dialect: DrizzleDialect) {
    if (dialect === "pg") {
      this.inner = new PostgresLocker(db);
    } else if (dialect === "mysql") {
      this.inner = new MySQLLocker(db);
    } else {
      throw new Error(
        `Pessimistic locking is not supported with ${dialect}. ` +
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
