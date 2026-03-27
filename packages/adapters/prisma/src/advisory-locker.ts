/* eslint-disable no-unused-vars */
import type { PrismaClient } from "@prisma/client";
import type { AggregateLocker } from "@noddde/core";
import { PostgresLocker } from "./pg/advisory-locker";
import { MySQLLocker } from "./mysql/advisory-locker";

export type PrismaDialect = "postgresql" | "mysql" | "mariadb";

/**
 * Database-backed {@link AggregateLocker} using advisory locks via Prisma.
 *
 * Supports PostgreSQL (`pg_advisory_lock`), MySQL (`GET_LOCK`),
 * and MariaDB (`GET_LOCK`, same as MySQL).
 * SQLite is not supported — use {@link InMemoryAggregateLocker}
 * for single-process SQLite deployments.
 *
 * @example
 * ```ts
 * import { PrismaClient } from "@prisma/client";
 * import { PrismaAdvisoryLocker } from "@noddde/prisma";
 * import { wireDomain } from "@noddde/engine";
 *
 * const prisma = new PrismaClient();
 * const locker = new PrismaAdvisoryLocker(prisma, "postgresql");
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
export class PrismaAdvisoryLocker implements AggregateLocker {
  private readonly inner: AggregateLocker;

  constructor(prisma: PrismaClient, dialect: PrismaDialect) {
    if (dialect === "postgresql") {
      this.inner = new PostgresLocker(prisma);
    } else if (dialect === "mysql" || dialect === "mariadb") {
      this.inner = new MySQLLocker(prisma);
    } else {
      throw new Error(
        `Pessimistic locking is not supported with ${String(dialect)}. ` +
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
