/* eslint-disable no-unused-vars */
import type { DataSource, QueryRunner } from "typeorm";
import type { AggregateLocker, Closeable } from "@noddde/core";
import { PostgresLocker } from "./pg/advisory-locker";
import { MySQLLocker } from "./mysql/advisory-locker";
import { MSSQLLocker } from "./mssql/advisory-locker";

/** Minimal query surface a pinned connection must expose to a dialect locker. */
export interface Queryable {
  query(query: string, parameters?: any[]): Promise<any>;
}

/**
 * Database-backed {@link AggregateLocker} using advisory locks via TypeORM.
 *
 * Auto-detects the dialect from `dataSource.options.type`. Supports:
 * - `postgres` — uses `pg_advisory_lock` / `pg_try_advisory_lock`
 * - `mysql` / `mariadb` — uses `GET_LOCK` / `RELEASE_LOCK`
 * - `mssql` — uses `sp_getapplock` / `sp_releaseapplock`
 *
 * SQLite and better-sqlite3 are not supported — use
 * {@link InMemoryAggregateLocker} for single-process deployments.
 *
 * ## Session affinity
 *
 * Advisory locks are session-scoped: `acquire()` and `release()` must run on
 * the same DB session, or the release is a no-op and the lock leaks. Unlike
 * Drizzle/Prisma (which need an owned single-connection client), TypeORM
 * already exposes the pinning primitive: this locker lazily obtains a single
 * dedicated `QueryRunner` from `dataSource.createQueryRunner()` on first
 * `acquire()` and keeps it open (a pinned connection, not returned to the
 * pool) for every subsequent `acquire()`/`release()`. `dataSource` itself
 * stays pooled — only this locker's own queries are pinned. Call `close()`
 * (auto-discovered by the engine via `Closeable`) to release the pinned
 * connection back to the pool on shutdown.
 *
 * @example
 * ```ts
 * import { DataSource } from "typeorm";
 * import { TypeORMAdvisoryLocker } from "@noddde/typeorm";
 * import { wireDomain } from "@noddde/engine";
 *
 * const dataSource = new DataSource({ type: "postgres", ... });
 * await dataSource.initialize();
 * const locker = new TypeORMAdvisoryLocker(dataSource);
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
export class TypeORMAdvisoryLocker implements AggregateLocker, Closeable {
  private readonly inner: AggregateLocker;
  private queryRunner: QueryRunner | null = null;
  private connecting: Promise<QueryRunner> | null = null;
  private closed = false;

  constructor(private readonly dataSource: DataSource) {
    const dbType = dataSource.options.type;
    const getQueryable = () => this.getQueryRunner();
    if (dbType === "postgres") {
      this.inner = new PostgresLocker(getQueryable);
    } else if (dbType === "mysql" || dbType === "mariadb") {
      this.inner = new MySQLLocker(getQueryable);
    } else if (dbType === "mssql") {
      this.inner = new MSSQLLocker(getQueryable);
    } else {
      throw new Error(
        `Pessimistic locking is not supported with ${dbType}. ` +
          "Use InMemoryAggregateLocker for single-process deployments.",
      );
    }
  }

  /** Lazily creates and connects a single dedicated `QueryRunner`, pinned for this locker's lifetime. */
  private async getQueryRunner(): Promise<QueryRunner> {
    if (this.queryRunner) return this.queryRunner;
    if (!this.connecting) {
      this.connecting = (async () => {
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        this.queryRunner = queryRunner;
        return queryRunner;
      })();
    }
    return this.connecting;
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

  /** Releases the pinned `QueryRunner` connection back to the pool. Idempotent. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.queryRunner) {
      await this.queryRunner.release();
      this.queryRunner = null;
    }
  }
}
