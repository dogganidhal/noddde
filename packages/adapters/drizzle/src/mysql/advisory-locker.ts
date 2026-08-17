import { sql } from "drizzle-orm";
import type { AggregateLocker } from "@noddde/core";
import { LockTimeoutError } from "@noddde/core";

/**
 * MySQL advisory lock implementation for Drizzle ORM.
 *
 * Uses `GET_LOCK` / `RELEASE_LOCK`. The lock name is the first 64 characters
 * of `aggregateName:aggregateId` (MySQL's named-lock limit).
 *
 * @internal Used by {@link DrizzleAdvisoryLocker}. Not part of the public API.
 */
export class MySQLLocker implements AggregateLocker {
  constructor(private readonly db: any) {}

  async acquire(
    aggregateName: string,
    aggregateId: string,
    timeoutMs?: number,
  ): Promise<void> {
    const lockName = `${aggregateName}:${aggregateId}`.slice(0, 64);
    const timeoutSec = timeoutMs ? Math.ceil(timeoutMs / 1000) : -1;
    const result = await this.db.execute(
      sql`SELECT GET_LOCK(${lockName}, ${timeoutSec}) AS acquired`,
    );
    // mysql2 returns `[rows, fields]`; drizzle's pg-style result uses `.rows`;
    // older drivers expose the row array directly. Probe all three shapes so
    // the locker stays portable across drizzle dialects.
    const acquired =
      result.rows?.[0]?.acquired ??
      result[0]?.[0]?.acquired ??
      result[0]?.acquired;
    // GET_LOCK returns 1 (success), 0 (timeout), or NULL (error). mysql2 may
    // surface the value as a JS `number` or a `string` ("1" / "0") depending
    // on `typeCast` config — coerce defensively.
    if (Number(acquired) !== 1)
      throw new LockTimeoutError(aggregateName, aggregateId, timeoutMs ?? 0);
  }

  async release(aggregateName: string, aggregateId: string): Promise<void> {
    const lockName = `${aggregateName}:${aggregateId}`.slice(0, 64);
    await this.db.execute(sql`SELECT RELEASE_LOCK(${lockName})`);
  }
}
