/* eslint-disable no-unused-vars */
import { sql } from "drizzle-orm";
import type { AggregateLocker } from "@noddde/core";
import { LockTimeoutError, fnv1a64 } from "@noddde/core";

/**
 * PostgreSQL advisory lock implementation for Drizzle ORM.
 *
 * Uses `pg_advisory_lock` (blocking) and `pg_try_advisory_lock` (with timeout polling).
 * The lock key is a 64-bit FNV-1a hash of `aggregateName:aggregateId`.
 *
 * @internal Used by {@link DrizzleAdvisoryLocker}. Not part of the public API.
 */
export class PostgresLocker implements AggregateLocker {
  constructor(private readonly db: any) {}

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
  }

  async release(aggregateName: string, aggregateId: string): Promise<void> {
    const hashKey = fnv1a64(`${aggregateName}:${aggregateId}`);
    await this.db.execute(sql`SELECT pg_advisory_unlock(${hashKey}::bigint)`);
  }
}
