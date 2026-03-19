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

  constructor(
    private readonly prisma: PrismaClient,
    private readonly txStore: PrismaTransactionStore,
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

    const ops = this.operations;
    const txStore = this.txStore;

    await this.prisma.$transaction(async (tx) => {
      txStore.current = tx;
      try {
        for (const op of ops) {
          await op();
        }
      } finally {
        txStore.current = null;
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
