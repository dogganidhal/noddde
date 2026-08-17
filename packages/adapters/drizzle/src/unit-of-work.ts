import { sql } from "drizzle-orm";
import type { Event, UnitOfWork, UnitOfWorkFactory } from "@noddde/core";
import type { DrizzleTransactionStore } from "./index";

/**
 * Detects whether the Drizzle database instance is a sync SQLite driver
 * (like better-sqlite3) by checking for the `run` method, which is
 * unique to BaseSQLiteDatabase.
 */
function isSyncSQLite(db: any): boolean {
  return typeof db.run === "function";
}

/**
 * Serializes explicit `BEGIN`/`COMMIT`/`ROLLBACK` sequences on a single
 * synchronous (single-connection) driver like better-sqlite3.
 *
 * Unlike the pooled PG/MySQL path, a sync SQLite driver has exactly one
 * physical connection — two overlapping transactions on it are not just
 * unsafe, they're impossible: issuing a second `BEGIN` while the first is
 * still open throws `SqliteError: cannot start a transaction within a
 * transaction`, and the resulting `ROLLBACK` aborts the *other* UoW's still
 * -open transaction (issue #129 finding 1's sync-SQLite-specific failure
 * mode). AsyncLocalStorage fixes which transaction each operation resolves
 * to, but does nothing to stop two commits from physically overlapping.
 * This mutex queues concurrent `commitWithSqlStatements()` calls so they run
 * one at a time instead of racing — the only physically sound behavior for
 * a single synchronous connection, and each queued commit still gets full
 * atomicity.
 */
class SyncCommitMutex {
  private queue: Promise<void> = Promise.resolve();

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

/**
 * Drizzle-backed {@link UnitOfWork} implementation.
 *
 * Detects the dialect at construction time:
 * - **SQLite** (sync drivers): uses explicit `BEGIN`/`COMMIT`/`ROLLBACK`
 *   via `db.run(sql\`...\`)`, which works with synchronous drivers like
 *   `better-sqlite3` where `db.transaction()` does not accept async callbacks.
 * - **PostgreSQL / MySQL** (async drivers): uses `db.transaction(async (tx) => ...)`
 *   callback, which ensures connection affinity in pooled environments.
 *
 * On {@link rollback}, discards all operations without touching the database.
 */
export class DrizzleUnitOfWork implements UnitOfWork {
  private operations: Array<() => Promise<void>> = [];
  private pendingEvents: Event[] = [];
  private completed = false;
  private _context: unknown = undefined;
  private readonly useSqlStatements: boolean;

  constructor(
    private readonly db: any,
    private readonly txStore: DrizzleTransactionStore,
    private readonly syncMutex: SyncCommitMutex = new SyncCommitMutex(),
  ) {
    this.useSqlStatements = isSyncSQLite(db);
  }

  /**
   * The Drizzle transaction handle bound to this unit of work, while
   * `commit()` is inside its transactional region. For async dialects
   * (PostgreSQL / MySQL), this is the `tx` object passed by
   * `db.transaction(async tx => ...)`. For sync SQLite, this is the
   * `db` instance during the `BEGIN` / `COMMIT` window. Outside that
   * window, `context` is `undefined`. Cross-cutting consumers (e.g. a
   * `ViewStoreFactory.getForContext`) read this to participate in the
   * same transaction as aggregate persistence.
   */
  get context(): unknown {
    return this._context;
  }

  enlist(operation: () => Promise<void>): void {
    this.assertNotCompleted();
    this.operations.push(operation);
  }

  deferPublish(...events: Event[]): void {
    this.assertNotCompleted();
    this.pendingEvents.push(...events);
  }

  async commit(): Promise<Event[]> {
    this.assertNotCompleted();
    this.completed = true;

    if (this.useSqlStatements) {
      return this.commitWithSqlStatements();
    } else {
      return this.commitWithCallback();
    }
  }

  async rollback(): Promise<void> {
    this.assertNotCompleted();
    this.completed = true;
    this.operations = [];
    this.pendingEvents = [];
  }

  /**
   * SQLite path: explicit BEGIN/COMMIT/ROLLBACK via db.run().
   * Works with synchronous drivers like better-sqlite3.
   */
  private async commitWithSqlStatements(): Promise<Event[]> {
    return this.syncMutex.run(async () => {
      this.db.run(sql`BEGIN`);
      this._context = this.db;

      try {
        await this.txStore.als.run(this.db, async () => {
          for (const op of this.operations) {
            await op();
          }
        });
        this.db.run(sql`COMMIT`);
      } catch (error) {
        try {
          this.db.run(sql`ROLLBACK`);
        } catch {
          // ROLLBACK may fail if transaction was already aborted
        }
        throw error;
      } finally {
        this._context = undefined;
      }

      return [...this.pendingEvents];
    });
  }

  /**
   * PostgreSQL / MySQL path: uses db.transaction() callback.
   * Ensures connection affinity in pooled environments.
   */
  private async commitWithCallback(): Promise<Event[]> {
    await this.db.transaction(async (tx: any) => {
      this._context = tx;

      try {
        await this.txStore.als.run(tx, async () => {
          for (const op of this.operations) {
            await op();
          }
        });
      } catch (error) {
        this._context = undefined;
        throw error;
      }
    });

    this._context = undefined;
    return [...this.pendingEvents];
  }

  private assertNotCompleted(): void {
    if (this.completed) {
      throw new Error("UnitOfWork already completed");
    }
  }
}

/**
 * Creates a {@link UnitOfWorkFactory} backed by Drizzle transactions.
 *
 * @param db - The Drizzle database instance (any dialect).
 * @param txStore - The shared transaction store.
 * @returns A factory function creating new {@link DrizzleUnitOfWork} instances.
 */
export function createDrizzleUnitOfWorkFactory(
  db: any,
  txStore: DrizzleTransactionStore,
): UnitOfWorkFactory {
  // Shared across every UoW this factory creates, so concurrent
  // commitWithSqlStatements() calls on a sync-SQLite `db` queue behind one
  // another instead of racing (see SyncCommitMutex). Irrelevant for the
  // async PG/MySQL path — real pooled connections genuinely run concurrent
  // transactions and never touch this mutex.
  const syncMutex = new SyncCommitMutex();
  return () => new DrizzleUnitOfWork(db, txStore, syncMutex);
}
