/* eslint-disable no-unused-vars */
import { Entity, PrimaryColumn, Column, LessThanOrEqual } from "typeorm";
import type { DataSource, EntityManager } from "typeorm";
import type { EventIdempotencyStore } from "@noddde/core";
import type { TypeORMTransactionStore } from "./unit-of-work";
import { isUniqueViolation } from "./errors";

/**
 * TypeORM entity for the event idempotency dedup table
 * (`noddde_event_idempotency`). Backs {@link TypeORMEventIdempotencyStore}.
 */
@Entity("noddde_event_idempotency")
export class NodddeEventIdempotencyEntity {
  @PrimaryColumn()
  key!: string;

  // No explicit `type` — TypeORM picks the dialect-native datetime.
  @Column({ name: "processed_at" })
  processedAt!: Date;
}

/**
 * Durable, TypeORM-backed implementation of `EventIdempotencyStore`
 * (`@noddde/core`). Backs `withIdempotency()` with a real table so dedup
 * state survives restarts and is shared across process instances, unlike
 * `InMemoryEventIdempotencyStore`.
 *
 * Follows the same constructor/Unit-of-Work-enlistment pattern as
 * `TypeORMOutboxStore` and `TypeORMSnapshotStore`: operations resolve the
 * active `EntityManager` via `txStore.als.getStore() ?? dataSource.manager`, so
 * they enlist in the current transaction when one is active.
 */
export class TypeORMEventIdempotencyStore implements EventIdempotencyStore {
  constructor(
    private readonly dataSource: DataSource,
    private readonly txStore: TypeORMTransactionStore,
    private readonly ttlMs?: number,
  ) {}

  private getManager(): EntityManager {
    return this.txStore.als.getStore() ?? this.dataSource.manager;
  }

  /**
   * Records `key` as processed by inserting a row with the current
   * timestamp. If the insert fails due to a primary-key/unique violation
   * (the key was already marked processed, e.g. by a concurrent
   * redelivery), the error is caught and treated as success — matching
   * `withIdempotency`'s idempotent contract. Any other error propagates
   * unchanged.
   */
  async markProcessed(key: string): Promise<void> {
    const manager = this.getManager();
    const repo = manager.getRepository(NodddeEventIdempotencyEntity);

    const entity = new NodddeEventIdempotencyEntity();
    entity.key = key;
    entity.processedAt = new Date();

    try {
      await repo.insert(entity);
    } catch (error: unknown) {
      if (isUniqueViolation(error)) {
        return;
      }
      throw error;
    }
  }

  /**
   * Checks whether `key` has already been recorded as processed. Returns
   * `false` if no row exists. If a row exists and the constructor `ttlMs`
   * is configured, the row is considered expired once
   * `Date.now() - processedAt > ttlMs`; an expired row is deleted (lazy
   * cleanup) and `false` is returned. If a row exists and is not expired
   * (or no `ttlMs` was configured), returns `true`.
   */
  async hasProcessed(key: string): Promise<boolean> {
    const manager = this.getManager();
    const repo = manager.getRepository(NodddeEventIdempotencyEntity);

    const row = await repo.findOne({ where: { key } });
    if (!row) return false;

    if (this.ttlMs != null) {
      const age = Date.now() - new Date(row.processedAt).getTime();
      if (age > this.ttlMs) {
        await repo.delete({ key });
        return false;
      }
    }

    return true;
  }

  /**
   * Deletes all rows whose `processedAt` is at least `ttlMs` old.
   * Independent of the constructor `ttlMs`. Intended for periodic
   * maintenance (cron/background process) since `withIdempotency` never
   * calls this automatically.
   */
  async removeExpired(ttlMs: number): Promise<void> {
    const manager = this.getManager();
    const repo = manager.getRepository(NodddeEventIdempotencyEntity);

    const threshold = new Date(Date.now() - ttlMs);
    await repo.delete({ processedAt: LessThanOrEqual(threshold) });
  }
}
