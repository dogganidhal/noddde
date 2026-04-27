/* eslint-disable no-unused-vars */
import type { DataSource, EntityManager } from "typeorm";
import type { Event, UnitOfWork, UnitOfWorkFactory } from "@noddde/core";

/**
 * Shared store for propagating the active TypeORM EntityManager
 * (transaction-scoped) to persistence implementations.
 */
export interface TypeORMTransactionStore {
  current: EntityManager | null;
}

/**
 * TypeORM-backed {@link UnitOfWork} implementation.
 *
 * On {@link commit}, uses `dataSource.manager.transaction()` to wrap
 * all enlisted operations in a real database transaction.
 */
export class TypeORMUnitOfWork implements UnitOfWork {
  private operations: Array<() => Promise<void>> = [];
  private pendingEvents: Event[] = [];
  private completed = false;
  private _context: unknown = undefined;

  constructor(
    private readonly dataSource: DataSource,
    private readonly txStore: TypeORMTransactionStore,
  ) {}

  /**
   * The transactional `EntityManager` bound to this unit of work, while
   * `commit()` is inside its `dataSource.manager.transaction()`
   * callback. Outside that window, `context` is `undefined`.
   * Cross-cutting consumers (e.g. a `ViewStoreFactory.getForContext`)
   * read this to participate in the same transaction as aggregate
   * persistence.
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

    const ops = this.operations;
    const txStore = this.txStore;

    await this.dataSource.manager.transaction(
      async (transactionalEntityManager) => {
        txStore.current = transactionalEntityManager;
        this._context = transactionalEntityManager;
        try {
          for (const op of ops) {
            await op();
          }
        } finally {
          txStore.current = null;
          this._context = undefined;
        }
      },
    );

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
 * Creates a {@link UnitOfWorkFactory} backed by TypeORM transactions.
 */
export function createTypeORMUnitOfWorkFactory(
  dataSource: DataSource,
  txStore: TypeORMTransactionStore,
): UnitOfWorkFactory {
  return () => new TypeORMUnitOfWork(dataSource, txStore);
}
