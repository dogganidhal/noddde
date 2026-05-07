/* eslint-disable no-unused-vars */
import type { DataSource, EntityManager } from "typeorm";
import {
  ConcurrencyError,
  type StateStoredAggregatePersistence,
} from "@noddde/core";
import type { TypeORMTransactionStore } from "./unit-of-work";
import type { TypeORMStateMapper } from "./builder";

/**
 * TypeORM-backed state-stored aggregate persistence bound to a
 * dedicated per-aggregate entity. Unlike the shared persistence,
 * this class ignores the `aggregateName` parameter — the entity
 * table itself is the namespace.
 *
 * State serialization and deserialization are fully delegated to the
 * supplied {@link TypeORMStateMapper}. The adapter only manages the
 * aggregate id and version columns, reading their property names from
 * `mapper.aggregateIdField` and `mapper.versionField`.
 *
 * @typeParam TState  - The aggregate's state type.
 * @typeParam TEntity - The TypeORM entity instance type.
 */
export class TypeORMDedicatedStateStoredPersistence<TState, TEntity>
  implements StateStoredAggregatePersistence
{
  constructor(
    private readonly dataSource: DataSource,
    private readonly txStore: TypeORMTransactionStore,
    private readonly entity: new () => TEntity,
    private readonly mapper: TypeORMStateMapper<TState, TEntity>,
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
    const { aggregateIdField, versionField } = this.mapper;

    const existing = await repo.findOne({
      where: { [aggregateIdField]: aggregateId } as any,
    });

    if (existing) {
      const storedVersion = (existing as any)[versionField] as number;
      if (storedVersion !== expectedVersion) {
        throw new ConcurrencyError(
          _aggregateName,
          aggregateId,
          expectedVersion,
          storedVersion,
        );
      }

      // Merge mapper row into the existing entity, then set id and version.
      const stateRow = this.mapper.toRow(state as TState);
      Object.assign(existing as any, stateRow, {
        [aggregateIdField]: aggregateId,
        [versionField]: expectedVersion + 1,
      });
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

      // Create a new entity instance, spread mapper row, then set id and version.
      const newEntity = repo.create() as any;
      const stateRow = this.mapper.toRow(state as TState);
      Object.assign(newEntity, stateRow, {
        [aggregateIdField]: aggregateId,
        [versionField]: 1,
      });
      await repo.save(newEntity);
    }
  }

  async load(
    _aggregateName: string,
    aggregateId: string,
  ): Promise<{ state: any; version: number } | null> {
    const manager = this.getManager();
    const repo = manager.getRepository(this.entity);
    const { aggregateIdField, versionField } = this.mapper;

    const row = await repo.findOne({
      where: { [aggregateIdField]: aggregateId } as any,
    });

    if (!row) return null;

    const version = (row as any)[versionField] as number;

    // Strip the id and version fields before passing to fromRow.
    const stateRow = { ...(row as any) } as any;
    delete stateRow[aggregateIdField];
    delete stateRow[versionField];

    const loadedState = this.mapper.fromRow(stateRow as Partial<TEntity>);

    return { state: loadedState, version };
  }
}
