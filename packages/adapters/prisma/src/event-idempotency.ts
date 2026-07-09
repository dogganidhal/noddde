/* eslint-disable no-unused-vars */
import type { PrismaClient } from "@prisma/client";
import type { EventIdempotencyStore } from "@noddde/core";
import type { PrismaTransactionStore } from "./unit-of-work";

type PrismaExecutor =
  | PrismaClient
  | Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

/**
 * Prisma-backed implementation of `EventIdempotencyStore` (`@noddde/core`).
 * Backs `withIdempotency()` with a real table (`noddde_event_idempotency`)
 * so dedup state survives restarts and is shared across process instances,
 * unlike an in-memory store.
 *
 * Enlists in the active `PrismaTransactionStore`'s transaction when one is
 * present, same as `PrismaOutboxStore`/`PrismaSnapshotStore`.
 *
 * Requires the consuming application to add the
 * `NodddeEventIdempotencyRecord` model to its own `schema.prisma` and run
 * `prisma generate`.
 */
export class PrismaEventIdempotencyStore implements EventIdempotencyStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly txStore: PrismaTransactionStore,
    private readonly ttlMs?: number,
  ) {}

  private getExecutor(): PrismaExecutor {
    return (this.txStore.current ?? this.prisma) as PrismaExecutor;
  }

  async hasProcessed(key: string): Promise<boolean> {
    const executor = this.getExecutor() as any;

    const record = await executor.nodddeEventIdempotencyRecord.findUnique({
      where: { key },
    });

    if (!record) return false;

    if (
      this.ttlMs != null &&
      Date.now() - record.processedAt.getTime() > this.ttlMs
    ) {
      // deleteMany, not delete: a concurrent hasProcessed() call or a
      // removeExpired() sweep may have already removed this row between
      // the findUnique above and here. delete() throws P2025 (record not
      // found) in that case; deleteMany() is a no-op, which is the
      // correct outcome — the record is gone either way.
      await executor.nodddeEventIdempotencyRecord.deleteMany({
        where: { key },
      });
      return false;
    }

    return true;
  }

  async markProcessed(key: string): Promise<void> {
    const executor = this.getExecutor() as any;

    try {
      await executor.nodddeEventIdempotencyRecord.create({
        data: { key, processedAt: new Date() },
      });
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as any).code === "P2002"
      ) {
        return;
      }
      throw error;
    }
  }

  async removeExpired(ttlMs: number): Promise<void> {
    const executor = this.getExecutor() as any;

    await executor.nodddeEventIdempotencyRecord.deleteMany({
      where: { processedAt: { lte: new Date(Date.now() - ttlMs) } },
    });
  }
}
