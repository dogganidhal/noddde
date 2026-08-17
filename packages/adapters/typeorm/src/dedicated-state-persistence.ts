/* eslint-disable no-unused-vars */
import type { DataSource, EntityManager } from "typeorm";
import {
  ConcurrencyError,
  type StateStoredAggregatePersistence,
} from "@noddde/core";
import type { TypeORMTransactionStore } from "./unit-of-work";
import type { TypeORMStateMapper } from "./builder";
import { isUniqueViolation } from "./errors";

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
    return this.txStore.als.getStore() ?? this.dataSource.manager;
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
    const stateRow = this.mapper.toRow(state as TState);

    if (expectedVersion === 0) {
      // Insert path: new aggregate. No prior read — a unique-constraint
      // violation on the primary key is the concurrency signal.
      try {
        await repo.insert({
          ...stateRow,
          [aggregateIdField]: aggregateId,
          [versionField]: 1,
        } as any);
      } catch (error: unknown) {
        if (isUniqueViolation(error)) {
          throw new ConcurrencyError(
            _aggregateName,
            aggregateId,
            expectedVersion,
            -1,
          );
        }
        throw error;
      }
    } else {
      // Update path: the version predicate is enforced by the database
      // itself, not by a prior read-then-compare — closing the classic
      // lost-update race where two concurrent saves both read version N,
      // both pass an in-memory check, and the second silently overwrites.
      const result = await repo.update(
        {
          [aggregateIdField]: aggregateId,
          [versionField]: expectedVersion,
        } as any,
        { ...stateRow, [versionField]: expectedVersion + 1 } as any,
      );
      if (result.affected === 0) {
        throw new ConcurrencyError(
          _aggregateName,
          aggregateId,
          expectedVersion,
          -1,
        );
      }
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
