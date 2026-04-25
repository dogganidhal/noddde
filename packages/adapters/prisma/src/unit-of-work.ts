/* eslint-disable no-unused-vars */
import type { PrismaClient } from "@prisma/client";
import type { Event, UnitOfWork, UnitOfWorkFactory } from "@noddde/core";

/**
 * Shared store for propagating the active Prisma transaction client
 * to persistence implementations.
 */
export interface PrismaTransactionStore {
  current: any | null;
}

/**
 * Prisma-backed {@link UnitOfWork} implementation.
 *
 * On {@link commit}, uses Prisma's interactive `$transaction()` to
 * wrap all enlisted operations in a real database transaction.
 */
export class PrismaUnitOfWork implements UnitOfWork {
  private operations: Array<() => Promise<void>> = [];
  private pendingEvents: Event[] = [];
  private completed = false;
  private _context: unknown = undefined;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly txStore: PrismaTransactionStore,
  ) {}

  /**
   * The Prisma {@link Prisma.TransactionClient} bound to this unit of
   * work, while `commit()` is inside its `$transaction()` callback.
   * Outside that window — before commit, after commit, after rollback —
   * `context` is `undefined`. Cross-cutting consumers (e.g. a
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

    const ops = this.operations;
    const txStore = this.txStore;

    await this.prisma.$transaction(async (tx) => {
      txStore.current = tx;
      this._context = tx;
      try {
        for (const op of ops) {
          await op();
        }
      } finally {
        txStore.current = null;
        this._context = undefined;
      }
    });

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
 * Creates a {@link UnitOfWorkFactory} backed by Prisma transactions.
 */
export function createPrismaUnitOfWorkFactory(
  prisma: PrismaClient,
  txStore: PrismaTransactionStore,
): UnitOfWorkFactory {
  return () => new PrismaUnitOfWork(prisma, txStore);
}
