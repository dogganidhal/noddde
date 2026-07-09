/* eslint-disable no-unused-vars */
import type { PrismaClient } from "@prisma/client";
import type { AggregateLocker } from "@noddde/core";
import { LockTimeoutError, fnv1a64 } from "@noddde/core";

/**
 * PostgreSQL advisory lock implementation for Prisma.
 *
 * Uses `pg_advisory_lock` (blocking) and `pg_try_advisory_lock` (with timeout polling)
 * via Prisma's `$queryRawUnsafe`. The lock key is a 64-bit FNV-1a hash of
 * `aggregateName:aggregateId`.
 *
 * @internal Used by {@link PrismaAdvisoryLocker}. Not part of the public API.
 */
export class PostgresLocker implements AggregateLocker {
  /**
   * Lock keys this locker instance believes it currently holds. Used to
   * distinguish an idempotent double-`release()` (key absent → no-op) from a
   * release that landed on a different pool connection than the acquire
   * (key present but `pg_advisory_unlock` returns `false` → multiplexing bug).
   */
  private readonly _held = new Set<string>();

  constructor(private readonly prisma: PrismaClient) {}

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
        const result: any[] = await (this.prisma as any).$queryRawUnsafe(
          `SELECT pg_try_advisory_lock($1::bigint) AS acquired`,
          hashKey,
        );
        const acquired = result[0]?.acquired;
        if (acquired === true || acquired === "t") {
          this._held.add(hashKey.toString());
          return;
        }
        if (Date.now() >= deadline)
          throw new LockTimeoutError(aggregateName, aggregateId, timeoutMs);
        await new Promise((r) => setTimeout(r, 50));
      }
    } else {
      // `pg_advisory_lock` returns void — $queryRawUnsafe chokes trying to
      // deserialize a void column ("Failed to deserialize column of type
      // 'void'"). $executeRawUnsafe doesn't materialise a row set so it
      // works for both void- and value-returning function calls.
      await (this.prisma as any).$executeRawUnsafe(
        `SELECT pg_advisory_lock($1::bigint)`,
        hashKey,
      );
      this._held.add(hashKey.toString());
    }
  }

  async release(aggregateName: string, aggregateId: string): Promise<void> {
    const hashKey = fnv1a64(`${aggregateName}:${aggregateId}`);
    const keyStr = hashKey.toString();
    const believedHeld = this._held.has(keyStr);

    const result: any[] = await (this.prisma as any).$queryRawUnsafe(
      `SELECT pg_advisory_unlock($1::bigint) AS released`,
      hashKey,
    );

    // `pg_advisory_unlock` returns `false` both for an already-released lock
    // (legitimate idempotent double-release, which we must not turn into an
    // error) and for a release issued on a session that does not hold the lock.
    // The `_held` set separates the two.
    const released = result[0]?.released;
    const ok = released === true || released === "t";

    // Only clear the key on a *successful* unlock. If the unlock failed while
    // we believed we held the lock (multiplexing), keep the key in `_held` so a
    // retried release() still detects the bug instead of being silently treated
    // as a double-release.
    if (ok) {
      this._held.delete(keyStr);
    } else if (believedHeld) {
      throw new Error(
        `PrismaAdvisoryLocker: pg_advisory_unlock reported the lock for ` +
          `"${aggregateName}:${aggregateId}" was not held on this connection, so it ` +
          `was NOT released and will leak. This means acquire() and release() ran on ` +
          `different pool connections — Prisma multiplexes queries over its connection ` +
          `pool. Construct the locker with PrismaAdvisoryLocker.fromUrl(url, "postgresql") ` +
          `(recommended) or pass a PrismaClient pinned to connection_limit=1.`,
      );
    }
  }
}
