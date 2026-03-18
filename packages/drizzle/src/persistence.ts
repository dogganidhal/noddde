/* eslint-disable no-unused-vars */
import { eq, and, asc, sql } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type {
  Event,
  EventSourcedAggregatePersistence,
  StateStoredAggregatePersistence,
  SagaPersistence,
} from "@noddde/core";
import {
  nodddeEvents,
  nodddeAggregateStates,
  nodddeSagaStates,
} from "./schema";
import type { DrizzleTransactionStore } from "./unit-of-work";

/**
 * Drizzle-backed event-sourced aggregate persistence.
 * Appends events to the `noddde_events` table and loads them
 * ordered by sequence number.
 */
export class DrizzleEventSourcedAggregatePersistence
  implements EventSourcedAggregatePersistence
{
  constructor(
    private readonly db: BaseSQLiteDatabase<any, any>,
    private readonly txStore: DrizzleTransactionStore,
  ) {}

  private getExecutor() {
    return this.txStore.current ?? this.db;
  }

  async save(
    aggregateName: string,
    aggregateId: string,
    events: Event[],
  ): Promise<void> {
    if (events.length === 0) return;

    const executor = this.getExecutor();

    // Get current max sequence number
    const result = await executor
      .select({ maxSeq: sql<number>`COALESCE(MAX(${nodddeEvents.sequenceNumber}), 0)` })
      .from(nodddeEvents)
      .where(
        and(
          eq(nodddeEvents.aggregateName, aggregateName),
          eq(nodddeEvents.aggregateId, aggregateId),
        ),
      );

    const maxSeq = result[0]?.maxSeq ?? 0;

    await executor.insert(nodddeEvents).values(
      events.map((event, index) => ({
        aggregateName,
        aggregateId,
        sequenceNumber: maxSeq + index + 1,
        eventName: event.name,
        payload: JSON.stringify(event.payload),
      })),
    );
  }

  async load(aggregateName: string, aggregateId: string): Promise<Event[]> {
    const executor = this.getExecutor();

    const rows = await executor
      .select()
      .from(nodddeEvents)
      .where(
        and(
          eq(nodddeEvents.aggregateName, aggregateName),
          eq(nodddeEvents.aggregateId, aggregateId),
        ),
      )
      .orderBy(asc(nodddeEvents.sequenceNumber));

    return rows.map((row) => ({
      name: row.eventName,
      payload: JSON.parse(row.payload),
    }));
  }
}

/**
 * Drizzle-backed state-stored aggregate persistence.
 * Upserts the full state snapshot into `noddde_aggregate_states`.
 */
export class DrizzleStateStoredAggregatePersistence
  implements StateStoredAggregatePersistence
{
  constructor(
    private readonly db: BaseSQLiteDatabase<any, any>,
    private readonly txStore: DrizzleTransactionStore,
  ) {}

  private getExecutor() {
    return this.txStore.current ?? this.db;
  }

  async save(
    aggregateName: string,
    aggregateId: string,
    state: any,
  ): Promise<void> {
    const executor = this.getExecutor();
    const serialized = JSON.stringify(state);

    // Upsert: insert or replace on conflict
    const existing = await executor
      .select()
      .from(nodddeAggregateStates)
      .where(
        and(
          eq(nodddeAggregateStates.aggregateName, aggregateName),
          eq(nodddeAggregateStates.aggregateId, aggregateId),
        ),
      );

    if (existing.length > 0) {
      await executor
        .update(nodddeAggregateStates)
        .set({ state: serialized })
        .where(
          and(
            eq(nodddeAggregateStates.aggregateName, aggregateName),
            eq(nodddeAggregateStates.aggregateId, aggregateId),
          ),
        );
    } else {
      await executor.insert(nodddeAggregateStates).values({
        aggregateName,
        aggregateId,
        state: serialized,
      });
    }
  }

  async load(aggregateName: string, aggregateId: string): Promise<any> {
    const executor = this.getExecutor();

    const rows = await executor
      .select()
      .from(nodddeAggregateStates)
      .where(
        and(
          eq(nodddeAggregateStates.aggregateName, aggregateName),
          eq(nodddeAggregateStates.aggregateId, aggregateId),
        ),
      );

    if (rows.length === 0) return undefined;
    return JSON.parse(rows[0]!.state);
  }
}

/**
 * Drizzle-backed saga persistence.
 * Upserts saga instance state into `noddde_saga_states`.
 */
export class DrizzleSagaPersistence implements SagaPersistence {
  constructor(
    private readonly db: BaseSQLiteDatabase<any, any>,
    private readonly txStore: DrizzleTransactionStore,
  ) {}

  private getExecutor() {
    return this.txStore.current ?? this.db;
  }

  async save(sagaName: string, sagaId: string, state: any): Promise<void> {
    const executor = this.getExecutor();
    const serialized = JSON.stringify(state);

    const existing = await executor
      .select()
      .from(nodddeSagaStates)
      .where(
        and(
          eq(nodddeSagaStates.sagaName, sagaName),
          eq(nodddeSagaStates.sagaId, sagaId),
        ),
      );

    if (existing.length > 0) {
      await executor
        .update(nodddeSagaStates)
        .set({ state: serialized })
        .where(
          and(
            eq(nodddeSagaStates.sagaName, sagaName),
            eq(nodddeSagaStates.sagaId, sagaId),
          ),
        );
    } else {
      await executor.insert(nodddeSagaStates).values({
        sagaName,
        sagaId,
        state: serialized,
      });
    }
  }

  async load(
    sagaName: string,
    sagaId: string,
  ): Promise<any | undefined | null> {
    const executor = this.getExecutor();

    const rows = await executor
      .select()
      .from(nodddeSagaStates)
      .where(
        and(
          eq(nodddeSagaStates.sagaName, sagaName),
          eq(nodddeSagaStates.sagaId, sagaId),
        ),
      );

    if (rows.length === 0) return undefined;
    return JSON.parse(rows[0]!.state);
  }
}
