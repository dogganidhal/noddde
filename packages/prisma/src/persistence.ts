/* eslint-disable no-unused-vars */
import type { PrismaClient } from "@prisma/client";
import type {
  Event,
  EventSourcedAggregatePersistence,
  StateStoredAggregatePersistence,
  SagaPersistence,
} from "@noddde/core";
import type { PrismaTransactionStore } from "./unit-of-work";

type PrismaExecutor = PrismaClient | Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

/**
 * Prisma-backed event-sourced aggregate persistence.
 */
export class PrismaEventSourcedAggregatePersistence
  implements EventSourcedAggregatePersistence
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
  ): Promise<void> {
    if (events.length === 0) return;

    const executor = this.getExecutor() as any;

    // Get current max sequence number
    const maxResult = await executor.nodddeEvent.aggregate({
      _max: { sequenceNumber: true },
      where: { aggregateName, aggregateId },
    });

    const maxSeq = maxResult._max.sequenceNumber ?? 0;

    await executor.nodddeEvent.createMany({
      data: events.map((event, index) => ({
        aggregateName,
        aggregateId,
        sequenceNumber: maxSeq + index + 1,
        eventName: event.name,
        payload: JSON.stringify(event.payload),
      })),
    });
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
  ): Promise<void> {
    const executor = this.getExecutor() as any;
    const serialized = JSON.stringify(state);

    const existing = await executor.nodddeAggregateState.findUnique({
      where: { aggregateName_aggregateId: { aggregateName, aggregateId } },
    });

    if (existing) {
      await executor.nodddeAggregateState.update({
        where: { aggregateName_aggregateId: { aggregateName, aggregateId } },
        data: { state: serialized },
      });
    } else {
      await executor.nodddeAggregateState.create({
        data: { aggregateName, aggregateId, state: serialized },
      });
    }
  }

  async load(aggregateName: string, aggregateId: string): Promise<any> {
    const executor = this.getExecutor() as any;

    const row = await executor.nodddeAggregateState.findUnique({
      where: { aggregateName_aggregateId: { aggregateName, aggregateId } },
    });

    if (!row) return undefined;
    return JSON.parse(row.state);
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
