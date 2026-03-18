import { sql } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type { Event, UnitOfWork, UnitOfWorkFactory } from "@noddde/core";

/**
 * Shared transaction store used to propagate the active Drizzle
 * transaction context to persistence implementations. The UoW sets
 * `current` before executing enlisted operations; persistence
 * classes read it to run queries inside the transaction.
 */
export interface DrizzleTransactionStore {
  current: BaseSQLiteDatabase<any, any> | null;
}

/**
 * Drizzle-backed {@link UnitOfWork} implementation.
 *
 * On {@link commit}, wraps all enlisted operations in a database
 * transaction using explicit `BEGIN`/`COMMIT`/`ROLLBACK` statements.
 * This approach works across all Drizzle dialects (including
 * synchronous `better-sqlite3` where `db.transaction()` does not
 * accept async callbacks).
 *
 * On {@link rollback}, discards all operations without touching
 * the database.
 */
export class DrizzleUnitOfWork implements UnitOfWork {
  private operations: Array<() => Promise<void>> = [];
  private pendingEvents: Event[] = [];
  private completed = false;

  constructor(
    private readonly db: BaseSQLiteDatabase<any, any>,
    private readonly txStore: DrizzleTransactionStore,
  ) {}

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

  async rollback(): Promise<void> {
    this.assertNotCompleted();
    this.completed = true;
    this.operations = [];
    this.pendingEvents = [];
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
 * @param db - The Drizzle database instance.
 * @param txStore - The shared transaction store (same instance used by persistence classes).
 * @returns A factory function creating new {@link DrizzleUnitOfWork} instances.
 */
export function createDrizzleUnitOfWorkFactory(
  db: BaseSQLiteDatabase<any, any>,
  txStore: DrizzleTransactionStore,
): UnitOfWorkFactory {
  return () => new DrizzleUnitOfWork(db, txStore);
}
