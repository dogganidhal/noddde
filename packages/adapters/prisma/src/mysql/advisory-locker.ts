/* eslint-disable no-unused-vars */
import type { PrismaClient } from "@prisma/client";
import type { AggregateLocker } from "@noddde/core";
import { LockTimeoutError } from "@noddde/core";

/**
 * MySQL / MariaDB advisory lock implementation for Prisma.
 *
 * Uses `GET_LOCK` / `RELEASE_LOCK` via Prisma's `$queryRawUnsafe`.
 * The lock name is the first 64 characters of `aggregateName:aggregateId`
 * (MySQL's named-lock limit).
 *
 * @internal Used by {@link PrismaAdvisoryLocker}. Not part of the public API.
 */
export class MySQLLocker implements AggregateLocker {
  /**
   * Lock names this locker instance believes it currently holds. Used to
   * distinguish an idempotent double-`release()` (name absent → no-op) from a
   * release that landed on a different pool connection than the acquire
   * (name present but `RELEASE_LOCK` returns `0`/`NULL` → multiplexing bug).
   */
  private readonly _held = new Set<string>();

  constructor(private readonly prisma: PrismaClient) {}

  async acquire(
    aggregateName: string,
    aggregateId: string,
    timeoutMs?: number,
  ): Promise<void> {
    const lockName = `${aggregateName}:${aggregateId}`.slice(0, 64);
    const timeoutSec = timeoutMs ? Math.ceil(timeoutMs / 1000) : -1;
    const result: any[] = await (this.prisma as any).$queryRawUnsafe(
      `SELECT GET_LOCK(?, ?) AS acquired`,
      lockName,
      timeoutSec,
    );
    const acquired = result[0]?.acquired;
    if (acquired !== 1n && acquired !== 1)
      throw new LockTimeoutError(aggregateName, aggregateId, timeoutMs ?? 0);
    this._held.add(lockName);
  }

  async release(aggregateName: string, aggregateId: string): Promise<void> {
    const lockName = `${aggregateName}:${aggregateId}`.slice(0, 64);
    const believedHeld = this._held.has(lockName);

    const result: any[] = await (this.prisma as any).$queryRawUnsafe(
      `SELECT RELEASE_LOCK(?) AS released`,
      lockName,
    );

    // `RELEASE_LOCK` returns 1 when released by this session, 0 when the lock
    // is held by a *different* session, and NULL when the lock does not exist.
    const released = result[0]?.released;
    const ok = released === 1n || released === 1;

    // Only clear the name on a *successful* release. If it failed while we
    // believed we held the lock (multiplexing), keep the name in `_held` so a
    // retried release() still detects the bug instead of being silently treated
    // as a double-release. A genuine double-release (name absent) stays a no-op.
    if (ok) {
      this._held.delete(lockName);
    } else if (believedHeld) {
      throw new Error(
        `PrismaAdvisoryLocker: RELEASE_LOCK reported the lock for ` +
          `"${aggregateName}:${aggregateId}" was not held on this connection, so it ` +
          `was NOT released and will leak. This means acquire() and release() ran on ` +
          `different pool connections — Prisma multiplexes queries over its connection ` +
          `pool. Construct the locker with PrismaAdvisoryLocker.fromUrl(url, "mysql") ` +
          `(recommended) or pass a PrismaClient pinned to connection_limit=1.`,
      );
    }
  }
}
