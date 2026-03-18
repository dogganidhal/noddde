/* eslint-disable no-unused-vars */
import { eq, and, asc, sql } from "drizzle-orm";
import type {
  Event,
  EventSourcedAggregatePersistence,
  StateStoredAggregatePersistence,
  SagaPersistence,
} from "@noddde/core";
import type { DrizzleTransactionStore, DrizzleNodddeSchema } from "./index";

/**
 * Drizzle-backed event-sourced aggregate persistence.
 * Appends events to the events table and loads them
 * ordered by sequence number. Dialect-agnostic — accepts
 * schema tables as constructor parameters.
 */
export class DrizzleEventSourcedAggregatePersistence
  implements EventSourcedAggregatePersistence
{
  constructor(
    private readonly db: any,
    private readonly txStore: DrizzleTransactionStore,
    private readonly schema: DrizzleNodddeSchema,
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
    const eventsTable = this.schema.events;

    // Get current max sequence number
    const result = await executor
      .select({
        maxSeq: sql<number>`COALESCE(MAX(${eventsTable.sequenceNumber}), 0)`,
      })
      .from(eventsTable)
      .where(
        and(
          eq(eventsTable.aggregateName, aggregateName),
          eq(eventsTable.aggregateId, aggregateId),
        ),
      );

    const maxSeq = result[0]?.maxSeq ?? 0;

    await executor.insert(eventsTable).values(
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
    const eventsTable = this.schema.events;

    const rows = await executor
      .select()
      .from(eventsTable)
      .where(
        and(
          eq(eventsTable.aggregateName, aggregateName),
          eq(eventsTable.aggregateId, aggregateId),
        ),
      )
      .orderBy(asc(eventsTable.sequenceNumber));

    return rows.map((row: any) => ({
      name: row.eventName,
      payload: JSON.parse(row.payload),
    }));
  }
}

/**
 * Drizzle-backed state-stored aggregate persistence.
 * Upserts the full state snapshot. Dialect-agnostic.
 */
export class DrizzleStateStoredAggregatePersistence
  implements StateStoredAggregatePersistence
{
  constructor(
    private readonly db: any,
    private readonly txStore: DrizzleTransactionStore,
    private readonly schema: DrizzleNodddeSchema,
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
    const table = this.schema.aggregateStates;
    const serialized = JSON.stringify(state);

    // Upsert: check existence, then insert or update
    const existing = await executor
      .select()
      .from(table)
      .where(
        and(
          eq(table.aggregateName, aggregateName),
          eq(table.aggregateId, aggregateId),
        ),
      );

    if (existing.length > 0) {
      await executor
        .update(table)
        .set({ state: serialized })
        .where(
          and(
            eq(table.aggregateName, aggregateName),
            eq(table.aggregateId, aggregateId),
          ),
        );
    } else {
      await executor.insert(table).values({
        aggregateName,
        aggregateId,
        state: serialized,
      });
    }
  }

  async load(aggregateName: string, aggregateId: string): Promise<any> {
    const executor = this.getExecutor();
    const table = this.schema.aggregateStates;

    const rows = await executor
      .select()
      .from(table)
      .where(
        and(
          eq(table.aggregateName, aggregateName),
          eq(table.aggregateId, aggregateId),
        ),
      );

    if (rows.length === 0) return undefined;
    return JSON.parse(rows[0]!.state);
  }
}

/**
 * Drizzle-backed saga persistence.
 * Upserts saga instance state. Dialect-agnostic.
 */
export class DrizzleSagaPersistence implements SagaPersistence {
  constructor(
    private readonly db: any,
    private readonly txStore: DrizzleTransactionStore,
    private readonly schema: DrizzleNodddeSchema,
  ) {}

  private getExecutor() {
    return this.txStore.current ?? this.db;
  }

  async save(sagaName: string, sagaId: string, state: any): Promise<void> {
    const executor = this.getExecutor();
    const table = this.schema.sagaStates;
    const serialized = JSON.stringify(state);

    const existing = await executor
      .select()
      .from(table)
      .where(and(eq(table.sagaName, sagaName), eq(table.sagaId, sagaId)));

    if (existing.length > 0) {
      await executor
        .update(table)
        .set({ state: serialized })
        .where(and(eq(table.sagaName, sagaName), eq(table.sagaId, sagaId)));
    } else {
      await executor.insert(table).values({
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
    const table = this.schema.sagaStates;

    const rows = await executor
      .select()
      .from(table)
      .where(and(eq(table.sagaName, sagaName), eq(table.sagaId, sagaId)));

    if (rows.length === 0) return undefined;
    return JSON.parse(rows[0]!.state);
  }
}
