/* eslint-disable no-unused-vars */
import type { PrismaClient } from "@prisma/client";
import type { AggregateLocker } from "@noddde/core";
import { LockTimeoutError, fnv1a64 } from "@noddde/core";

type PrismaDialect = "postgresql" | "mysql";

/**
 * Database-backed {@link AggregateLocker} using advisory locks via Prisma.
 *
 * Supports PostgreSQL (`pg_advisory_lock`) and MySQL (`GET_LOCK`).
 * SQLite is not supported — use {@link InMemoryAggregateLocker}
 * for single-process SQLite deployments.
 *
 * @example
 * ```ts
 * import { PrismaClient } from "@prisma/client";
 * import { PrismaAdvisoryLocker } from "@noddde/prisma";
 *
 * const prisma = new PrismaClient();
 * const locker = new PrismaAdvisoryLocker(prisma, "postgresql");
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
export class PrismaAdvisoryLocker implements AggregateLocker {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly dialect: PrismaDialect,
  ) {}

  async acquire(
    aggregateName: string,
    aggregateId: string,
    timeoutMs?: number,
  ): Promise<void> {
    const key = `${aggregateName}:${aggregateId}`;
    if (this.dialect === "postgresql") {
      const hashKey = fnv1a64(key);
      if (timeoutMs && timeoutMs > 0) {
        const deadline = Date.now() + timeoutMs;
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const result: any[] = await (this.prisma as any).$queryRawUnsafe(
            `SELECT pg_try_advisory_lock($1::bigint) AS acquired`,
            hashKey,
          );
          const acquired = result[0]?.acquired;
          if (acquired === true || acquired === "t") return;
          if (Date.now() >= deadline)
            throw new LockTimeoutError(aggregateName, aggregateId, timeoutMs);
          await new Promise((r) => setTimeout(r, 50));
        }
      } else {
        await (this.prisma as any).$queryRawUnsafe(
          `SELECT pg_advisory_lock($1::bigint)`,
          hashKey,
        );
      }
    } else if (this.dialect === "mysql") {
      const timeoutSec = timeoutMs ? Math.ceil(timeoutMs / 1000) : -1;
      const lockName = key.slice(0, 64);
      const result: any[] = await (this.prisma as any).$queryRawUnsafe(
        `SELECT GET_LOCK(?, ?) AS acquired`,
        lockName,
        timeoutSec,
      );
      const acquired = result[0]?.acquired;
      if (acquired !== 1)
        throw new LockTimeoutError(aggregateName, aggregateId, timeoutMs ?? 0);
    }
  }

  async release(aggregateName: string, aggregateId: string): Promise<void> {
    const key = `${aggregateName}:${aggregateId}`;
    if (this.dialect === "postgresql") {
      const hashKey = fnv1a64(key);
      await (this.prisma as any).$queryRawUnsafe(
        `SELECT pg_advisory_unlock($1::bigint)`,
        hashKey,
      );
    } else if (this.dialect === "mysql") {
      const lockName = key.slice(0, 64);
      await (this.prisma as any).$queryRawUnsafe(
        `SELECT RELEASE_LOCK(?)`,
        lockName,
      );
    }
  }
}
