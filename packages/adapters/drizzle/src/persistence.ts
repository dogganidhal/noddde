/* eslint-disable no-unused-vars */
import { eq, and, asc, gt } from "drizzle-orm";
import {
  ConcurrencyError,
  type Event,
  type EventSourcedAggregatePersistence,
  type PartialEventLoad,
  type Snapshot,
  type SnapshotStore,
  type StateStoredAggregatePersistence,
  type SagaPersistence,
} from "@noddde/core";
import type { DrizzleTransactionStore, DrizzleNodddeSchema } from "./index";

/**
 * Drizzle-backed event-sourced aggregate persistence.
 * Appends events to the events table and loads them
 * ordered by sequence number. Dialect-agnostic — accepts
 * schema tables as constructor parameters.
 */
export class DrizzleEventSourcedAggregatePersistence
  implements EventSourcedAggregatePersistence, PartialEventLoad
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
    expectedVersion: number,
  ): Promise<void> {
    if (events.length === 0) return;

    const executor = this.getExecutor();
    const eventsTable = this.schema.events;

    try {
      await executor.insert(eventsTable).values(
        events.map((event, index) => ({
          aggregateName,
          aggregateId,
          sequenceNumber: expectedVersion + index + 1,
          eventName: event.name,
          payload: JSON.stringify(event.payload),
          metadata: JSON.stringify(event.metadata ?? null),
        })),
      );
    } catch (error: any) {
      // Detect unique constraint violation across dialects
      const message = error?.message ?? "";
      if (
        message.includes("UNIQUE constraint failed") || // SQLite
        message.includes("unique constraint") || // PostgreSQL
        message.includes("Duplicate entry") || // MySQL
        message.includes("duplicate key") // PostgreSQL variant
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

    return rows.map((row: any) => deserializeEvent(row));
  }

  async loadAfterVersion(
    aggregateName: string,
    aggregateId: string,
    afterVersion: number,
  ): Promise<Event[]> {
    const executor = this.getExecutor();
    const eventsTable = this.schema.events;

    const rows = await executor
      .select()
      .from(eventsTable)
      .where(
        and(
          eq(eventsTable.aggregateName, aggregateName),
          eq(eventsTable.aggregateId, aggregateId),
          gt(eventsTable.sequenceNumber, afterVersion),
        ),
      )
      .orderBy(asc(eventsTable.sequenceNumber));

    return rows.map((row: any) => deserializeEvent(row));
  }
}

/** Deserializes a raw DB row into an Event, parsing JSON payload and metadata. */
function deserializeEvent(row: any): Event {
  const event: Event = {
    name: row.eventName,
    payload:
      typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload,
  };
  if (row.metadata != null) {
    const meta =
      typeof row.metadata === "string"
        ? JSON.parse(row.metadata)
        : row.metadata;
    if (meta != null) {
      event.metadata = meta;
    }
  }
  return event;
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
    expectedVersion: number,
  ): Promise<void> {
    const executor = this.getExecutor();
    const table = this.schema.aggregateStates;
    const serialized = JSON.stringify(state);

    if (expectedVersion === 0) {
      // Insert path: new aggregate
      try {
        await executor.insert(table).values({
          aggregateName,
          aggregateId,
          state: serialized,
          version: 1,
        });
      } catch (error: any) {
        const message = error?.message ?? "";
        if (
          message.includes("UNIQUE constraint failed") || // SQLite
          message.includes("unique constraint") || // PostgreSQL
          message.includes("Duplicate entry") || // MySQL
          message.includes("duplicate key") // PostgreSQL variant
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
    } else {
      // Update path: optimistic concurrency check via version match
      const result = await executor
        .update(table)
        .set({ state: serialized, version: expectedVersion + 1 })
        .where(
          and(
            eq(table.aggregateName, aggregateName),
            eq(table.aggregateId, aggregateId),
            eq(table.version, expectedVersion),
          ),
        );

      // Check if no rows were updated (concurrency conflict)
      const rowsAffected =
        result?.rowsAffected ?? result?.changes ?? result?.rowCount ?? 0;
      if (rowsAffected === 0) {
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

    if (rows.length === 0) return null;
    const row = rows[0]!;
    return { state: JSON.parse(row.state), version: row.version };
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

/**
 * Drizzle-backed snapshot store for event-sourced aggregates.
 * Stores and retrieves state snapshots to avoid full event stream
 * replay. Dialect-agnostic — accepts schema tables as constructor parameters.
 */
export class DrizzleSnapshotStore implements SnapshotStore {
  constructor(
    private readonly db: any,
    private readonly txStore: DrizzleTransactionStore,
    private readonly schema: DrizzleNodddeSchema,
  ) {}

  private getExecutor() {
    return this.txStore.current ?? this.db;
  }

  async load(
    aggregateName: string,
    aggregateId: string,
  ): Promise<Snapshot | null> {
    const executor = this.getExecutor();
    const table = this.schema.snapshots;
    if (!table) return null;

    const rows = await executor
      .select()
      .from(table)
      .where(
        and(
          eq(table.aggregateName, aggregateName),
          eq(table.aggregateId, aggregateId),
        ),
      );

    if (rows.length === 0) return null;
    const row = rows[0]!;
    const state =
      typeof row.state === "string" ? JSON.parse(row.state) : row.state;
    return { state, version: row.version };
  }

  async save(
    aggregateName: string,
    aggregateId: string,
    snapshot: Snapshot,
  ): Promise<void> {
    const executor = this.getExecutor();
    const table = this.schema.snapshots;
    if (!table) return;

    const serialized =
      typeof snapshot.state === "string"
        ? snapshot.state
        : JSON.stringify(snapshot.state);

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
        .set({ state: serialized, version: snapshot.version })
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
        version: snapshot.version,
      });
    }
  }
}
