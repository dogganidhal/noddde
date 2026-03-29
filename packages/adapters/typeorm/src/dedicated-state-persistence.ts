/* eslint-disable no-unused-vars */
import type { DataSource, EntityManager } from "typeorm";
import {
  ConcurrencyError,
  type StateStoredAggregatePersistence,
} from "@noddde/core";
import type { TypeORMTransactionStore } from "./unit-of-work";
import type { TypeORMStateTableColumnMap } from "./builder";

/**
 * TypeORM-backed state-stored aggregate persistence bound to a
 * dedicated per-aggregate entity. Unlike the shared persistence,
 * this class ignores the `aggregateName` parameter — the entity
 * table itself is the namespace.
 *
 * Supports custom column mappings for entities where property names
 * differ from the noddde convention.
 */
export class TypeORMDedicatedStateStoredPersistence
  implements StateStoredAggregatePersistence
{
  constructor(
    private readonly dataSource: DataSource,
    private readonly txStore: TypeORMTransactionStore,
    private readonly entity: Function,
    private readonly columns: TypeORMStateTableColumnMap,
  ) {}

  private getManager(): EntityManager {
    return this.txStore.current ?? this.dataSource.manager;
  }

  async save(
    _aggregateName: string,
    aggregateId: string,
    state: any,
    expectedVersion: number,
  ): Promise<void> {
    const manager = this.getManager();
    const repo = manager.getRepository(this.entity);
    const serialized = JSON.stringify(state);

    const existing = await repo.findOne({
      where: { [this.columns.aggregateId]: aggregateId } as any,
    });

    if (existing) {
      if ((existing as any)[this.columns.version] !== expectedVersion) {
        throw new ConcurrencyError(
          _aggregateName,
          aggregateId,
          expectedVersion,
          (existing as any)[this.columns.version],
        );
      }
      (existing as any)[this.columns.state] = serialized;
      (existing as any)[this.columns.version] = expectedVersion + 1;
      await repo.save(existing);
    } else {
      if (expectedVersion !== 0) {
        throw new ConcurrencyError(
          _aggregateName,
          aggregateId,
          expectedVersion,
          0,
        );
      }
      const entity: any = repo.create();
      entity[this.columns.aggregateId] = aggregateId;
      entity[this.columns.state] = serialized;
      entity[this.columns.version] = 1;
      await repo.save(entity);
    }
  }

  async load(
    _aggregateName: string,
    aggregateId: string,
  ): Promise<{ state: any; version: number } | null> {
    const manager = this.getManager();
    const repo = manager.getRepository(this.entity);

    const row = await repo.findOne({
      where: { [this.columns.aggregateId]: aggregateId } as any,
    });

    if (!row) return null;

    const stateValue = (row as any)[this.columns.state];
    const versionValue = (row as any)[this.columns.version];

    return {
      state:
        typeof stateValue === "string" ? JSON.parse(stateValue) : stateValue,
      version: versionValue,
    };
  }
}
