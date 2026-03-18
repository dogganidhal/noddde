/* eslint-disable no-unused-vars */
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
  private readonly useSqlStatements: boolean;

  constructor(
    private readonly db: any,
    private readonly txStore: DrizzleTransactionStore,
  ) {
    this.useSqlStatements = isSyncSQLite(db);
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
    this.db.run(sql`BEGIN`);
    this.txStore.current = this.db;

    try {
      for (const op of this.operations) {
        await op();
      }
      this.db.run(sql`COMMIT`);
    } catch (error) {
      try {
        this.db.run(sql`ROLLBACK`);
      } catch {
        // ROLLBACK may fail if transaction was already aborted
      }
      throw error;
    } finally {
      this.txStore.current = null;
    }

    return [...this.pendingEvents];
  }

  /**
   * PostgreSQL / MySQL path: uses db.transaction() callback.
   * Ensures connection affinity in pooled environments.
   */
  private async commitWithCallback(): Promise<Event[]> {
    await this.db.transaction(async (tx: any) => {
      this.txStore.current = tx;

      try {
        for (const op of this.operations) {
          await op();
        }
      } catch (error) {
        this.txStore.current = null;
        throw error;
      }
    });

    this.txStore.current = null;
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
  return () => new DrizzleUnitOfWork(db, txStore);
}
