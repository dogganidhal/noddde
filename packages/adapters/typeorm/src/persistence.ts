/* eslint-disable no-unused-vars */
import type {
  DataSource,
  EntityManager,
  Repository,
  ObjectLiteral,
} from "typeorm";
import { MoreThan, IsNull, In, Not, LessThan } from "typeorm";
import type {
  Event,
  EventMetadata,
  EventSourcedAggregatePersistence,
  PartialEventLoad,
  Snapshot,
  SnapshotStore,
  StateStoredAggregatePersistence,
  SagaPersistence,
  OutboxStore,
  OutboxEntry,
} from "@noddde/core";
import { ConcurrencyError } from "@noddde/core";
import type {
  NodddeEventEntity,
  NodddeAggregateStateEntity,
  NodddeSagaStateEntity,
  NodddeSnapshotEntity,
  NodddeOutboxEntryEntity,
} from "./entities";
import type { TypeORMTransactionStore } from "./unit-of-work";

/** Table names of the built-in noddde stores. */
const TABLE = {
  events: "noddde_events",
  aggregateStates: "noddde_aggregate_states",
  sagaStates: "noddde_saga_states",
  snapshots: "noddde_snapshots",
  outbox: "noddde_outbox",
} as const;

/**
 * Resolves the repository for a built-in store by its table name rather than
 * by a fixed entity class. This lets the adapter work with whichever entity
 * variant the caller registered on the DataSource — the default classes or the
 * dialect-specific ones from {@link createNodddeEntities} (e.g. the MSSQL
 * `nvarchar(max)` variant) — since both map to the same table names.
 */
function getRepo<T extends ObjectLiteral>(
  manager: EntityManager,
  tableName: string,
): Repository<T> {
  const meta = manager.connection.entityMetadatas.find(
    (m) => m.tableName === tableName,
  );
  if (!meta) {
    throw new Error(
      `@noddde/typeorm: no entity is registered for table "${tableName}" on ` +
        `this DataSource. Register the noddde entities, e.g. ` +
        `entities: Object.values(createNodddeEntities(dataSource.options.type)).`,
    );
  }
  return manager.getRepository<T>(meta.target as new () => T);
}

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
    const repo = getRepo<NodddeEventEntity>(manager, TABLE.events);

    const entities = events.map((event, index) => ({
      aggregateName,
      aggregateId,
      sequenceNumber: expectedVersion + index + 1,
      eventName: event.name,
      payload: JSON.stringify(event.payload),
      metadata: event.metadata ? JSON.stringify(event.metadata) : null,
      createdAt: event.metadata?.timestamp
        ? new Date(event.metadata.timestamp)
        : new Date(),
    }));

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
    const repo = getRepo<NodddeEventEntity>(manager, TABLE.events);

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
    const repo = getRepo<NodddeEventEntity>(manager, TABLE.events);

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
    const repo = getRepo<NodddeAggregateStateEntity>(
      manager,
      TABLE.aggregateStates,
    );
    const serialized = JSON.stringify(state);

    const existing = await repo.findOne({
      where: { aggregateName, aggregateId },
    });

    try {
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
        await repo.save({
          aggregateName,
          aggregateId,
          state: serialized,
          version: 1,
        });
      }
    } catch (error: unknown) {
      if (error instanceof ConcurrencyError) throw error;
      // The `findOne`-then-insert path has a TOCTOU window: two racing
      // saves for a brand-new aggregate both see no existing row and both
      // INSERT, violating the primary key. Map that to a ConcurrencyError
      // so concurrent creators get the same contract as a stale version.
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

  async load(
    aggregateName: string,
    aggregateId: string,
  ): Promise<{ state: any; version: number } | null> {
    const manager = this.getManager();
    const repo = getRepo<NodddeAggregateStateEntity>(
      manager,
      TABLE.aggregateStates,
    );

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
    const repo = getRepo<NodddeSagaStateEntity>(manager, TABLE.sagaStates);
    const serialized = JSON.stringify(state);

    const existing = await repo.findOne({
      where: { sagaName, sagaId },
    });

    if (existing) {
      existing.state = serialized;
      await repo.save(existing);
    } else {
      await repo.save({ sagaName, sagaId, state: serialized });
    }
  }

  async load(
    sagaName: string,
    sagaId: string,
  ): Promise<any | undefined | null> {
    const manager = this.getManager();
    const repo = getRepo<NodddeSagaStateEntity>(manager, TABLE.sagaStates);

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
    const repo = getRepo<NodddeSnapshotEntity>(manager, TABLE.snapshots);

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
    const repo = getRepo<NodddeSnapshotEntity>(manager, TABLE.snapshots);
    const serialized = JSON.stringify(snapshot.state);

    const existing = await repo.findOne({
      where: { aggregateName, aggregateId },
    });

    if (existing) {
      existing.state = serialized;
      existing.version = snapshot.version;
      await repo.save(existing);
    } else {
      await repo.save({
        aggregateName,
        aggregateId,
        state: serialized,
        version: snapshot.version,
      });
    }
  }
}

/**
 * TypeORM-backed outbox store for the transactional outbox pattern.
 */
export class TypeORMOutboxStore implements OutboxStore {
  constructor(
    private readonly dataSource: DataSource,
    private readonly txStore: TypeORMTransactionStore,
  ) {}

  private getManager(): EntityManager {
    return this.txStore.current ?? this.dataSource.manager;
  }

  async save(entries: OutboxEntry[]): Promise<void> {
    if (entries.length === 0) return;
    const manager = this.getManager();
    const repo = getRepo<NodddeOutboxEntryEntity>(manager, TABLE.outbox);
    const entities = entries.map((e) => ({
      id: e.id,
      event: JSON.stringify(e.event),
      aggregateName: e.aggregateName ?? null,
      aggregateId: e.aggregateId ?? null,
      createdAt: e.createdAt,
      publishedAt: e.publishedAt ?? null,
    }));
    await repo.save(entities);
  }

  async loadUnpublished(batchSize = 100): Promise<OutboxEntry[]> {
    const manager = this.getManager();
    const repo = getRepo<NodddeOutboxEntryEntity>(manager, TABLE.outbox);
    const rows = await repo.find({
      where: { publishedAt: IsNull() },
      order: { createdAt: "ASC" },
      take: batchSize,
    });
    return rows.map((row) => ({
      id: row.id,
      event: JSON.parse(row.event),
      aggregateName: row.aggregateName ?? undefined,
      aggregateId: row.aggregateId ?? undefined,
      createdAt: new Date(row.createdAt),
      publishedAt: row.publishedAt != null ? new Date(row.publishedAt) : null,
    }));
  }

  async markPublished(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const manager = this.getManager();
    const repo = getRepo<NodddeOutboxEntryEntity>(manager, TABLE.outbox);
    await repo.update({ id: In(ids) }, { publishedAt: new Date() });
  }

  async markPublishedByEventIds(eventIds: string[]): Promise<void> {
    if (eventIds.length === 0) return;
    const unpublished = await this.loadUnpublished(10000);
    const eventIdSet = new Set(eventIds);
    const matchingIds = unpublished
      .filter(
        (e) =>
          e.event?.metadata?.eventId &&
          eventIdSet.has(e.event.metadata.eventId),
      )
      .map((e) => e.id);
    if (matchingIds.length > 0) {
      await this.markPublished(matchingIds);
    }
  }

  async deletePublished(olderThan?: Date): Promise<void> {
    const manager = this.getManager();
    const repo = getRepo<NodddeOutboxEntryEntity>(manager, TABLE.outbox);
    if (olderThan) {
      await repo.delete({
        publishedAt: Not(IsNull()),
        createdAt: LessThan(olderThan),
      });
    } else {
      await repo.delete({ publishedAt: Not(IsNull()) });
    }
  }
}
