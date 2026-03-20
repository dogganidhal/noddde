/* eslint-disable no-unused-vars */
import type { DataSource, EntityManager } from "typeorm";
import { MoreThan } from "typeorm";
import type {
  Event,
  EventMetadata,
  EventSourcedAggregatePersistence,
  PartialEventLoad,
  Snapshot,
  SnapshotStore,
  StateStoredAggregatePersistence,
  SagaPersistence,
} from "@noddde/core";
import { ConcurrencyError } from "@noddde/core";
import {
  NodddeEventEntity,
  NodddeAggregateStateEntity,
  NodddeSagaStateEntity,
  NodddeSnapshotEntity,
} from "./entities";
import type { TypeORMTransactionStore } from "./unit-of-work";

/**
 * TypeORM-backed event-sourced aggregate persistence.
 */
export class TypeORMEventSourcedAggregatePersistence
  implements EventSourcedAggregatePersistence, PartialEventLoad
{
  constructor(
    private readonly dataSource: DataSource,
    private readonly txStore: TypeORMTransactionStore,
  ) {}

  private getManager(): EntityManager {
    return this.txStore.current ?? this.dataSource.manager;
  }

  async save(
    aggregateName: string,
    aggregateId: string,
    events: Event[],
    expectedVersion: number,
  ): Promise<void> {
    if (events.length === 0) return;

    const manager = this.getManager();
    const repo = manager.getRepository(NodddeEventEntity);

    const entities = events.map((event, index) => {
      const entity = new NodddeEventEntity();
      entity.aggregateName = aggregateName;
      entity.aggregateId = aggregateId;
      entity.sequenceNumber = expectedVersion + index + 1;
      entity.eventName = event.name;
      entity.payload = JSON.stringify(event.payload);
      entity.metadata = event.metadata ? JSON.stringify(event.metadata) : null;
      return entity;
    });

    try {
      await repo.save(entities);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (/UNIQUE|duplicate|unique/i.test(message)) {
        throw new ConcurrencyError(
          aggregateName,
          aggregateId,
          expectedVersion,
          -1,
        );
      }
      throw error;
    }
  }

  async load(aggregateName: string, aggregateId: string): Promise<Event[]> {
    const manager = this.getManager();
    const repo = manager.getRepository(NodddeEventEntity);

    const rows = await repo.find({
      where: { aggregateName, aggregateId },
      order: { sequenceNumber: "ASC" },
    });

    return rows.map((row) => ({
      name: row.eventName,
      payload: JSON.parse(row.payload),
      ...(row.metadata
        ? { metadata: JSON.parse(row.metadata) as EventMetadata }
        : {}),
    }));
  }

  async loadAfterVersion(
    aggregateName: string,
    aggregateId: string,
    afterVersion: number,
  ): Promise<Event[]> {
    const manager = this.getManager();
    const repo = manager.getRepository(NodddeEventEntity);

    const rows = await repo.find({
      where: {
        aggregateName,
        aggregateId,
        sequenceNumber: MoreThan(afterVersion),
      },
      order: { sequenceNumber: "ASC" },
    });

    return rows.map((row) => ({
      name: row.eventName,
      payload: JSON.parse(row.payload),
      ...(row.metadata
        ? { metadata: JSON.parse(row.metadata) as EventMetadata }
        : {}),
    }));
  }
}

/**
 * TypeORM-backed state-stored aggregate persistence.
 */
export class TypeORMStateStoredAggregatePersistence
  implements StateStoredAggregatePersistence
{
  constructor(
    private readonly dataSource: DataSource,
    private readonly txStore: TypeORMTransactionStore,
  ) {}

  private getManager(): EntityManager {
    return this.txStore.current ?? this.dataSource.manager;
  }

  async save(
    aggregateName: string,
    aggregateId: string,
    state: any,
    expectedVersion: number,
  ): Promise<void> {
    const manager = this.getManager();
    const repo = manager.getRepository(NodddeAggregateStateEntity);
    const serialized = JSON.stringify(state);

    const existing = await repo.findOne({
      where: { aggregateName, aggregateId },
    });

    if (existing) {
      if (existing.version !== expectedVersion) {
        throw new ConcurrencyError(
          aggregateName,
          aggregateId,
          expectedVersion,
          existing.version,
        );
      }
      existing.state = serialized;
      existing.version = expectedVersion + 1;
      await repo.save(existing);
    } else {
      if (expectedVersion !== 0) {
        throw new ConcurrencyError(
          aggregateName,
          aggregateId,
          expectedVersion,
          0,
        );
      }
      const entity = new NodddeAggregateStateEntity();
      entity.aggregateName = aggregateName;
      entity.aggregateId = aggregateId;
      entity.state = serialized;
      entity.version = 1;
      await repo.save(entity);
    }
  }

  async load(
    aggregateName: string,
    aggregateId: string,
  ): Promise<{ state: any; version: number } | null> {
    const manager = this.getManager();
    const repo = manager.getRepository(NodddeAggregateStateEntity);

    const row = await repo.findOne({
      where: { aggregateName, aggregateId },
    });

    if (!row) return null;
    return { state: JSON.parse(row.state), version: row.version };
  }
}

/**
 * TypeORM-backed saga persistence.
 */
export class TypeORMSagaPersistence implements SagaPersistence {
  constructor(
    private readonly dataSource: DataSource,
    private readonly txStore: TypeORMTransactionStore,
  ) {}

  private getManager(): EntityManager {
    return this.txStore.current ?? this.dataSource.manager;
  }

  async save(sagaName: string, sagaId: string, state: any): Promise<void> {
    const manager = this.getManager();
    const repo = manager.getRepository(NodddeSagaStateEntity);
    const serialized = JSON.stringify(state);

    const existing = await repo.findOne({
      where: { sagaName, sagaId },
    });

    if (existing) {
      existing.state = serialized;
      await repo.save(existing);
    } else {
      const entity = new NodddeSagaStateEntity();
      entity.sagaName = sagaName;
      entity.sagaId = sagaId;
      entity.state = serialized;
      await repo.save(entity);
    }
  }

  async load(
    sagaName: string,
    sagaId: string,
  ): Promise<any | undefined | null> {
    const manager = this.getManager();
    const repo = manager.getRepository(NodddeSagaStateEntity);

    const row = await repo.findOne({
      where: { sagaName, sagaId },
    });

    if (!row) return undefined;
    return JSON.parse(row.state);
  }
}

/**
 * TypeORM-backed snapshot store for aggregate state snapshots.
 */
export class TypeORMSnapshotStore implements SnapshotStore {
  constructor(
    private readonly dataSource: DataSource,
    private readonly txStore: TypeORMTransactionStore,
  ) {}

  private getManager(): EntityManager {
    return this.txStore.current ?? this.dataSource.manager;
  }

  async load(
    aggregateName: string,
    aggregateId: string,
  ): Promise<Snapshot | null> {
    const manager = this.getManager();
    const repo = manager.getRepository(NodddeSnapshotEntity);

    const row = await repo.findOne({
      where: { aggregateName, aggregateId },
    });

    if (!row) return null;
    return { state: JSON.parse(row.state), version: row.version };
  }

  async save(
    aggregateName: string,
    aggregateId: string,
    snapshot: Snapshot,
  ): Promise<void> {
    const manager = this.getManager();
    const repo = manager.getRepository(NodddeSnapshotEntity);
    const serialized = JSON.stringify(snapshot.state);

    const existing = await repo.findOne({
      where: { aggregateName, aggregateId },
    });

    if (existing) {
      existing.state = serialized;
      existing.version = snapshot.version;
      await repo.save(existing);
    } else {
      const entity = new NodddeSnapshotEntity();
      entity.aggregateName = aggregateName;
      entity.aggregateId = aggregateId;
      entity.state = serialized;
      entity.version = snapshot.version;
      await repo.save(entity);
    }
  }
}
