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
 * Composes a per-process keyed mutex in front of the DB-level lock (see
 * {@link PostgresLocker} for why — MySQL named locks are re-entrant per
 * session too).
 *
 * @internal Used by {@link DrizzleAdvisoryLocker}. Not part of the public API.
 */
export class MySQLLocker implements AggregateLocker {
  private readonly _held = new Set<string>();
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
    if (Number(acquired) !== 1) {
      throw new LockTimeoutError(aggregateName, aggregateId, timeoutMs ?? 0);
    }
    this._held.add(lockName);
  }

  private async releaseDb(
    aggregateName: string,
    aggregateId: string,
  ): Promise<void> {
    const lockName = `${aggregateName}:${aggregateId}`.slice(0, 64);
    const believedHeld = this._held.has(lockName);

    const result = await this.db.execute(
      sql`SELECT RELEASE_LOCK(${lockName}) AS released`,
    );
    const released =
      result.rows?.[0]?.released ??
      result[0]?.[0]?.released ??
      result[0]?.released;
    const ok = Number(released) === 1;

    if (ok) {
      this._held.delete(lockName);
    } else if (believedHeld) {
      throw new Error(
        `DrizzleAdvisoryLocker: RELEASE_LOCK reported the lock for ` +
          `"${aggregateName}:${aggregateId}" was not held on this connection, so it ` +
          `was NOT released and will leak. This means acquire() and release() ran on ` +
          `different pool connections. Construct the locker with ` +
          `DrizzleAdvisoryLocker.fromUrl(url, "mysql") (recommended) or pass a db instance ` +
          `backed by a single dedicated connection (not a pool).`,
      );
    }
  }
}
