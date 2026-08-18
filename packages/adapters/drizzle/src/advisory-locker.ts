/* eslint-disable no-unused-vars */
import type { AggregateLocker, Closeable, Logger } from "@noddde/core";
import { PostgresLocker } from "./pg/advisory-locker";
import { MySQLLocker } from "./mysql/advisory-locker";

export type DrizzleDialect = "pg" | "mysql" | "sqlite";

/** Options accepted by {@link DrizzleAdvisoryLocker.fromUrl}. */
export interface DrizzleAdvisoryLockerFromUrlOptions {
  /** Optional framework logger, forwarded for parity with the Prisma package. Currently unused. */
  logger?: Logger;
}

/**
 * Database-backed {@link AggregateLocker} using advisory locks via Drizzle ORM.
 *
 * Supports PostgreSQL (`pg_advisory_lock`) and MySQL (`GET_LOCK`).
 * SQLite does not support advisory locks — use {@link InMemoryAggregateLocker}
 * for single-process SQLite deployments.
 *
 * ## Session affinity (important)
 *
 * Advisory locks are **session-scoped**: a lock acquired on one DB connection
 * must be released on the *same* connection, or the release is a no-op and
 * the lock leaks. A `db` instance backed by a connection **pool** (the normal
 * case — `new Pool()` for `pg`, a pool from `mysql2`) may `acquire()` on one
 * connection and `release()` on another.
 *
 * Prefer {@link DrizzleAdvisoryLocker.fromUrl}, which owns a single dedicated
 * connection (never a pool) and therefore guarantees session affinity. If you
 * construct this class directly with your own `db`, it **must** be backed by
 * a single dedicated connection, not a pool — as a safety net, `release()`
 * throws loudly if it detects a lock was released on a different connection
 * than it was acquired on.
 *
 * `DrizzleAdapter` does **not** auto-wire this locker (unlike the TypeORM
 * package, which can pin a dedicated connection out of a pool via
 * `QueryRunner`) — Drizzle's generic `db` handle has no equivalent pinning
 * primitive, so construct and pass a locker explicitly.
 *
 * @example
 * ```ts
 * import { DrizzleAdvisoryLocker } from "@noddde/drizzle";
 * import { wireDomain } from "@noddde/engine";
 *
 * // Recommended: the locker owns a single dedicated connection.
 * const locker = DrizzleAdvisoryLocker.fromUrl(process.env.DATABASE_URL!, "pg");
 *
 * const domain = await wireDomain(definition, {
 *   aggregates: {
 *     concurrency: { strategy: "pessimistic", locker, lockTimeoutMs: 5000 },
 *   },
 * });
 *
 * // On shutdown (also auto-discovered by the engine via Closeable):
 * await locker.close();
 * ```
 */
export class DrizzleAdvisoryLocker implements AggregateLocker, Closeable {
  private readonly inner: AggregateLocker;
  /**
   * The raw driver connection this locker owns and must close on `close()`.
   * `null` when the locker wraps a caller-owned `db` (the caller closes it).
   */
  private ownedConnection: {
    end?(): Promise<void>;
    close?(): Promise<void>;
  } | null = null;
  private closed = false;

  /**
   * Wraps an existing Drizzle `db` instance. Advanced: `db` **must** be
   * backed by a single dedicated connection (not a pool) for advisory locks
   * to be safe. Prefer {@link DrizzleAdvisoryLocker.fromUrl}.
   */
  constructor(db: any, dialect: DrizzleDialect) {
    if (dialect === "pg") {
      this.inner = new PostgresLocker(db);
    } else if (dialect === "mysql") {
      this.inner = new MySQLLocker(db);
    } else {
      throw new Error(
        `Pessimistic locking is not supported with ${dialect}. ` +
          "Use InMemoryAggregateLocker for single-process deployments.",
      );
    }
  }

  /**
   * Recommended constructor. Opens and owns a single dedicated driver
   * connection (never a pool) — `pg.Client` for `"pg"`, a `mysql2/promise`
   * connection for `"mysql"` — guaranteeing that `acquire()` and `release()`
   * run on the same DB session. Call {@link DrizzleAdvisoryLocker.close} to
   * close the owned connection (the engine also auto-discovers it via
   * `Closeable`).
   *
   * The underlying driver packages (`pg`, `mysql2`) are resolved lazily via
   * `require()` at call time — they are not a hard dependency of this
   * package, only of callers who use this factory.
   */
  static fromUrl(
    url: string,
    dialect: "pg" | "mysql",
    _options?: DrizzleAdvisoryLockerFromUrlOptions,
  ): DrizzleAdvisoryLocker {
    if (dialect === "pg") {
      const { Client } = require("pg");
      const { drizzle } = require("drizzle-orm/node-postgres");
      const client = new Client({ connectionString: url });
      const connectPromise = client.connect();
      const db = drizzle(client);
      const locker = new DrizzleAdvisoryLocker(
        new ConnectDeferredDb(db, connectPromise),
        "pg",
      );
      locker.ownedConnection = { end: () => client.end() };
      return locker;
    } else {
      const mysql = require("mysql2/promise");
      const { drizzle } = require("drizzle-orm/mysql2");
      const connectionPromise = mysql.createConnection(url);
      const db = new LazyMysqlDb(drizzle, connectionPromise);
      const locker = new DrizzleAdvisoryLocker(db, "mysql");
      locker.ownedConnection = {
        end: async () => (await connectionPromise).end(),
      };
      return locker;
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

  /**
   * Closes the internally-owned connection. No-op when the locker was built
   * from a caller-owned `db`. Idempotent.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.ownedConnection) {
      await (this.ownedConnection.end?.() ?? this.ownedConnection.close?.());
      this.ownedConnection = null;
    }
  }
}

/**
 * A minimal `db.execute()`-only wrapper that awaits a pending `pg.Client`
 * `.connect()` before delegating, so `fromUrl` doesn't need an async
 * constructor. The locker only ever calls `db.execute(sql\`...\`)`.
 * @internal
 */
class ConnectDeferredDb {
  constructor(
    private readonly db: any,
    private readonly ready: Promise<void>,
  ) {}

  async execute(query: any): Promise<any> {
    await this.ready;
    return this.db.execute(query);
  }
}

/**
 * Same deferred-connect wrapper for the mysql2 path, where the connection
 * itself (not just `.connect()`) resolves asynchronously from
 * `mysql.createConnection(url)`.
 * @internal
 */
class LazyMysqlDb {
  private dbPromise: Promise<any> | null = null;

  constructor(
    private readonly drizzleFactory: (conn: any) => any,
    private readonly connectionPromise: Promise<any>,
  ) {}

  async execute(query: any): Promise<any> {
    if (!this.dbPromise) {
      this.dbPromise = this.connectionPromise.then((conn) =>
        this.drizzleFactory(conn),
      );
    }
    const db = await this.dbPromise;
    return db.execute(query);
  }
}
