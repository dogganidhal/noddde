/* eslint-disable no-unused-vars */
import type { DataSource, EntityManager } from "typeorm";
import type {
  Event,
  EventSourcedAggregatePersistence,
  StateStoredAggregatePersistence,
  SagaPersistence,
} from "@noddde/core";
import {
  NodddeEventEntity,
  NodddeAggregateStateEntity,
  NodddeSagaStateEntity,
} from "./entities";
import type { TypeORMTransactionStore } from "./unit-of-work";

/**
 * TypeORM-backed event-sourced aggregate persistence.
 */
export class TypeORMEventSourcedAggregatePersistence
  implements EventSourcedAggregatePersistence
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
  ): Promise<void> {
    if (events.length === 0) return;

    const manager = this.getManager();
    const repo = manager.getRepository(NodddeEventEntity);

    // Get current max sequence number
    const result = await repo
      .createQueryBuilder("e")
      .select("COALESCE(MAX(e.sequence_number), 0)", "maxSeq")
      .where("e.aggregate_name = :aggregateName AND e.aggregate_id = :aggregateId", {
        aggregateName,
        aggregateId,
      })
      .getRawOne();

    const maxSeq = result?.maxSeq ?? 0;

    const entities = events.map((event, index) => {
      const entity = new NodddeEventEntity();
      entity.aggregateName = aggregateName;
      entity.aggregateId = aggregateId;
      entity.sequenceNumber = maxSeq + index + 1;
      entity.eventName = event.name;
      entity.payload = JSON.stringify(event.payload);
      return entity;
    });

    await repo.save(entities);
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
  ): Promise<void> {
    const manager = this.getManager();
    const repo = manager.getRepository(NodddeAggregateStateEntity);
    const serialized = JSON.stringify(state);

    const existing = await repo.findOne({
      where: { aggregateName, aggregateId },
    });

    if (existing) {
      existing.state = serialized;
      await repo.save(existing);
    } else {
      const entity = new NodddeAggregateStateEntity();
      entity.aggregateName = aggregateName;
      entity.aggregateId = aggregateId;
      entity.state = serialized;
      await repo.save(entity);
    }
  }

  async load(aggregateName: string, aggregateId: string): Promise<any> {
    const manager = this.getManager();
    const repo = manager.getRepository(NodddeAggregateStateEntity);

    const row = await repo.findOne({
      where: { aggregateName, aggregateId },
    });

    if (!row) return undefined;
    return JSON.parse(row.state);
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
