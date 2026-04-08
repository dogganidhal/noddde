/* eslint-disable no-unused-vars */
import type { PrismaClient } from "@prisma/client";
import type {
  Event,
  EventSourcedAggregatePersistence,
  StateStoredAggregatePersistence,
  SagaPersistence,
  PartialEventLoad,
  Snapshot,
  SnapshotStore,
  OutboxStore,
  OutboxEntry,
} from "@noddde/core";
import { ConcurrencyError } from "@noddde/core";
import type { PrismaTransactionStore } from "./unit-of-work";

type PrismaExecutor =
  | PrismaClient
  | Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

/**
 * Prisma-backed event-sourced aggregate persistence.
 */
export class PrismaEventSourcedAggregatePersistence
  implements EventSourcedAggregatePersistence, PartialEventLoad
{
  constructor(
    private readonly prisma: PrismaClient,
    private readonly txStore: PrismaTransactionStore,
  ) {}

  private getExecutor(): PrismaExecutor {
    return (this.txStore.current ?? this.prisma) as PrismaExecutor;
  }

  async save(
    aggregateName: string,
    aggregateId: string,
    events: Event[],
    expectedVersion: number,
  ): Promise<void> {
    if (events.length === 0) return;

    const executor = this.getExecutor() as any;

    try {
      await executor.nodddeEvent.createMany({
        data: events.map((event, index) => ({
          aggregateName,
          aggregateId,
          sequenceNumber: expectedVersion + index + 1,
          eventName: event.name,
          payload: JSON.stringify(event.payload),
          metadata: event.metadata ? JSON.stringify(event.metadata) : null,
          createdAt: event.metadata?.timestamp
            ? new Date(event.metadata.timestamp)
            : new Date(),
        })),
      });
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as any).code === "P2002"
      ) {
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
    const executor = this.getExecutor() as any;

    const rows = await executor.nodddeEvent.findMany({
      where: { aggregateName, aggregateId },
      orderBy: { sequenceNumber: "asc" },
    });

    return rows.map((row: any) => ({
      name: row.eventName,
      payload: JSON.parse(row.payload),
      ...(row.metadata ? { metadata: JSON.parse(row.metadata) } : {}),
    }));
  }

  async loadAfterVersion(
    aggregateName: string,
    aggregateId: string,
    afterVersion: number,
  ): Promise<Event[]> {
    const executor = this.getExecutor() as any;

    const rows = await executor.nodddeEvent.findMany({
      where: {
        aggregateName,
        aggregateId,
        sequenceNumber: { gt: afterVersion },
      },
      orderBy: { sequenceNumber: "asc" },
    });

    return rows.map((row: any) => ({
      name: row.eventName,
      payload: JSON.parse(row.payload),
      ...(row.metadata ? { metadata: JSON.parse(row.metadata) } : {}),
    }));
  }
}

/**
 * Prisma-backed state-stored aggregate persistence.
 */
export class PrismaStateStoredAggregatePersistence
  implements StateStoredAggregatePersistence
{
  constructor(
    private readonly prisma: PrismaClient,
    private readonly txStore: PrismaTransactionStore,
  ) {}

  private getExecutor(): PrismaExecutor {
    return (this.txStore.current ?? this.prisma) as PrismaExecutor;
  }

  async save(
    aggregateName: string,
    aggregateId: string,
    state: any,
    expectedVersion: number,
  ): Promise<void> {
    const executor = this.getExecutor() as any;
    const serialized = JSON.stringify(state);

    if (expectedVersion === 0) {
      try {
        await executor.nodddeAggregateState.create({
          data: {
            aggregateName,
            aggregateId,
            state: serialized,
            version: 1,
          },
        });
      } catch (error: unknown) {
        if (
          error instanceof Error &&
          "code" in error &&
          (error as any).code === "P2002"
        ) {
          throw new ConcurrencyError(aggregateName, aggregateId, 0, -1);
        }
        throw error;
      }
    } else {
      const result = await executor.nodddeAggregateState.updateMany({
        where: {
          aggregateName,
          aggregateId,
          version: expectedVersion,
        },
        data: { state: serialized, version: expectedVersion + 1 },
      });

      if (result.count === 0) {
        throw new ConcurrencyError(
          aggregateName,
          aggregateId,
          expectedVersion,
          -1,
        );
      }
    }
  }

  async load(
    aggregateName: string,
    aggregateId: string,
  ): Promise<{ state: any; version: number } | null> {
    const executor = this.getExecutor() as any;

    const row = await executor.nodddeAggregateState.findUnique({
      where: { aggregateName_aggregateId: { aggregateName, aggregateId } },
    });

    if (!row) return null;
    return { state: JSON.parse(row.state), version: row.version };
  }
}

/**
 * Prisma-backed saga persistence.
 */
export class PrismaSagaPersistence implements SagaPersistence {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly txStore: PrismaTransactionStore,
  ) {}

  private getExecutor(): PrismaExecutor {
    return (this.txStore.current ?? this.prisma) as PrismaExecutor;
  }

  async save(sagaName: string, sagaId: string, state: any): Promise<void> {
    const executor = this.getExecutor() as any;
    const serialized = JSON.stringify(state);

    const existing = await executor.nodddeSagaState.findUnique({
      where: { sagaName_sagaId: { sagaName, sagaId } },
    });

    if (existing) {
      await executor.nodddeSagaState.update({
        where: { sagaName_sagaId: { sagaName, sagaId } },
        data: { state: serialized },
      });
    } else {
      await executor.nodddeSagaState.create({
        data: { sagaName, sagaId, state: serialized },
      });
    }
  }

  async load(
    sagaName: string,
    sagaId: string,
  ): Promise<any | undefined | null> {
    const executor = this.getExecutor() as any;

    const row = await executor.nodddeSagaState.findUnique({
      where: { sagaName_sagaId: { sagaName, sagaId } },
    });

    if (!row) return undefined;
    return JSON.parse(row.state);
  }
}

/**
 * Prisma-backed snapshot store for event-sourced aggregate state snapshotting.
 */
export class PrismaSnapshotStore implements SnapshotStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly txStore: PrismaTransactionStore,
  ) {}

  private getExecutor(): PrismaExecutor {
    return (this.txStore.current ?? this.prisma) as PrismaExecutor;
  }

  async load(
    aggregateName: string,
    aggregateId: string,
  ): Promise<Snapshot | null> {
    const executor = this.getExecutor() as any;

    const row = await executor.nodddeSnapshot.findUnique({
      where: {
        aggregateName_aggregateId: { aggregateName, aggregateId },
      },
    });

    if (!row) return null;
    return { state: JSON.parse(row.state), version: row.version };
  }

  async save(
    aggregateName: string,
    aggregateId: string,
    snapshot: Snapshot,
  ): Promise<void> {
    const executor = this.getExecutor() as any;
    const serialized = JSON.stringify(snapshot.state);

    const existing = await executor.nodddeSnapshot.findUnique({
      where: {
        aggregateName_aggregateId: { aggregateName, aggregateId },
      },
    });

    if (existing) {
      await executor.nodddeSnapshot.update({
        where: {
          aggregateName_aggregateId: { aggregateName, aggregateId },
        },
        data: { state: serialized, version: snapshot.version },
      });
    } else {
      await executor.nodddeSnapshot.create({
        data: {
          aggregateName,
          aggregateId,
          state: serialized,
          version: snapshot.version,
        },
      });
    }
  }
}

/**
 * Prisma-backed outbox store for the transactional outbox pattern.
 */
export class PrismaOutboxStore implements OutboxStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly txStore: PrismaTransactionStore,
  ) {}

  private getExecutor(): PrismaExecutor {
    return (this.txStore.current ?? this.prisma) as PrismaExecutor;
  }

  async save(entries: OutboxEntry[]): Promise<void> {
    if (entries.length === 0) return;
    const executor = this.getExecutor();
    await (executor as any).nodddeOutboxEntry.createMany({
      data: entries.map((e) => ({
        id: e.id,
        event: JSON.stringify(e.event),
        aggregateName: e.aggregateName ?? null,
        aggregateId: e.aggregateId ?? null,
        createdAt: e.createdAt,
        publishedAt: e.publishedAt ?? null,
      })),
    });
  }

  async loadUnpublished(batchSize = 100): Promise<OutboxEntry[]> {
    const executor = this.getExecutor();
    const rows = await (executor as any).nodddeOutboxEntry.findMany({
      where: { publishedAt: null },
      orderBy: { createdAt: "asc" },
      take: batchSize,
    });
    return rows.map((row: any) => ({
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
    const executor = this.getExecutor();
    await (executor as any).nodddeOutboxEntry.updateMany({
      where: { id: { in: ids } },
      data: { publishedAt: new Date() },
    });
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
    const executor = this.getExecutor();
    const where: any = { publishedAt: { not: null } };
    if (olderThan) {
      where.createdAt = { lt: olderThan };
    }
    await (executor as any).nodddeOutboxEntry.deleteMany({ where });
  }
}
