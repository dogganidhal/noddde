/* eslint-disable no-unused-vars */
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
    const acquired = result.rows?.[0]?.acquired ?? result[0]?.acquired;
    if (acquired !== 1)
      throw new LockTimeoutError(aggregateName, aggregateId, timeoutMs ?? 0);
  }

  async release(aggregateName: string, aggregateId: string): Promise<void> {
    const lockName = `${aggregateName}:${aggregateId}`.slice(0, 64);
    await this.db.execute(sql`SELECT RELEASE_LOCK(${lockName})`);
  }
}
