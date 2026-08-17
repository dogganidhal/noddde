import { sql } from "drizzle-orm";
import type { AggregateLocker } from "@noddde/core";
import { LockTimeoutError, fnv1a64 } from "@noddde/core";

/**
 * PostgreSQL advisory lock implementation for Drizzle ORM.
 *
 * Uses `pg_advisory_lock` (blocking) and `pg_try_advisory_lock` (with timeout polling).
 * The lock key is a 64-bit FNV-1a hash of `aggregateName:aggregateId`.
 *
 * Composes a per-process keyed mutex in front of the DB-level lock: PG
 * advisory locks are re-entrant per session, so two concurrent commands in
 * this process sharing one pinned connection (see {@link DrizzleAdvisoryLocker.fromUrl})
 * would otherwise both "acquire" successfully. The local mutex serializes
 * same-process acquires for the same key before ever reaching the DB.
 *
 * @internal Used by {@link DrizzleAdvisoryLocker}. Not part of the public API.
 */
export class PostgresLocker implements AggregateLocker {
  /**
   * Lock keys this locker instance believes it currently holds. Used to
   * distinguish an idempotent double-`release()` (key absent → no-op) from a
   * release that landed on a different connection than the acquire (key
   * present but `pg_advisory_unlock` returns `false` → multiplexing bug).
   */
  private readonly _held = new Set<string>();

  /** Per-process mutex: queues concurrent acquires for the same key. */
  private readonly localLocks = new Map<string, Promise<void>>();

  constructor(private readonly db: any) {}

  async acquire(
    aggregateName: string,
    aggregateId: string,
    timeoutMs?: number,
  ): Promise<void> {
    const key = `${aggregateName}:${aggregateId}`;
    await this.acquireLocal(key);
    try {
      await this.acquireDb(aggregateName, aggregateId, timeoutMs);
    } catch (error) {
      this.releaseLocal(key);
      throw error;
    }
  }

  async release(aggregateName: string, aggregateId: string): Promise<void> {
    const key = `${aggregateName}:${aggregateId}`;
    try {
      await this.releaseDb(aggregateName, aggregateId);
    } finally {
      this.releaseLocal(key);
    }
  }

  private async acquireLocal(key: string): Promise<void> {
    // Chain onto any pending local holder for this key so a second
    // same-process acquire() waits until the first one's release() runs,
    // even though the DB-level advisory lock is session-re-entrant.
    while (this.localLocks.has(key)) {
      await this.localLocks.get(key);
    }
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.localLocks.set(key, gate);
    (gate as any)._release = release;
  }

  private releaseLocal(key: string): void {
    const gate = this.localLocks.get(key) as any;
    this.localLocks.delete(key);
    gate?._release?.();
  }

  private async acquireDb(
    aggregateName: string,
    aggregateId: string,
    timeoutMs?: number,
  ): Promise<void> {
    const hashKey = fnv1a64(`${aggregateName}:${aggregateId}`);
    const keyStr = hashKey.toString();
    if (timeoutMs && timeoutMs > 0) {
      const deadline = Date.now() + timeoutMs;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const result = await this.db.execute(
          sql`SELECT pg_try_advisory_lock(${hashKey}::bigint) AS acquired`,
        );
        const acquired = result.rows?.[0]?.acquired ?? result[0]?.acquired;
        if (acquired === true || acquired === "t") {
          this._held.add(keyStr);
          return;
        }
        if (Date.now() >= deadline)
          throw new LockTimeoutError(aggregateName, aggregateId, timeoutMs);
        await new Promise((r) => setTimeout(r, 50));
      }
    } else {
      await this.db.execute(sql`SELECT pg_advisory_lock(${hashKey}::bigint)`);
      this._held.add(keyStr);
    }
  }

  private async releaseDb(
    aggregateName: string,
    aggregateId: string,
  ): Promise<void> {
    const hashKey = fnv1a64(`${aggregateName}:${aggregateId}`);
    const keyStr = hashKey.toString();
    const believedHeld = this._held.has(keyStr);

    const result = await this.db.execute(
      sql`SELECT pg_advisory_unlock(${hashKey}::bigint) AS released`,
    );
    const released = result.rows?.[0]?.released ?? result[0]?.released;
    const ok = released === true || released === "t";

    if (ok) {
      this._held.delete(keyStr);
    } else if (believedHeld) {
      throw new Error(
        `DrizzleAdvisoryLocker: pg_advisory_unlock reported the lock for ` +
          `"${aggregateName}:${aggregateId}" was not held on this connection, so it ` +
          `was NOT released and will leak. This means acquire() and release() ran on ` +
          `different pool connections. Construct the locker with ` +
          `DrizzleAdvisoryLocker.fromUrl(url, "pg") (recommended) or pass a db instance ` +
          `backed by a single dedicated connection (not a pool).`,
      );
    }
  }
}
