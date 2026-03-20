import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * SQLite table definition for event-sourced aggregate persistence.
 * Stores domain events as an append-only stream per aggregate instance.
 */
export const events = sqliteTable(
  "noddde_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    aggregateName: text("aggregate_name").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    sequenceNumber: integer("sequence_number").notNull(),
    eventName: text("event_name").notNull(),
    payload: text("payload").notNull(),
    metadata: text("metadata"),
  },
  (table) => ({
    streamVersionIdx: uniqueIndex("noddde_events_stream_version_idx").on(
      table.aggregateName,
      table.aggregateId,
      table.sequenceNumber,
    ),
  }),
);

/**
 * SQLite table definition for state-stored aggregate persistence.
 * Stores the latest state snapshot per aggregate instance.
 */
export const aggregateStates = sqliteTable("noddde_aggregate_states", {
  aggregateName: text("aggregate_name").notNull(),
  aggregateId: text("aggregate_id").notNull(),
  state: text("state").notNull(),
  version: integer("version").notNull().default(0),
});

/**
 * SQLite table definition for saga persistence.
 * Stores the current workflow state per saga instance.
 */
export const sagaStates = sqliteTable("noddde_saga_states", {
  sagaName: text("saga_name").notNull(),
  sagaId: text("saga_id").notNull(),
  state: text("state").notNull(),
});

/**
 * SQLite table definition for aggregate state snapshots.
 * Stores the latest snapshot per aggregate instance for
 * optimized event-sourced aggregate loading.
 */
export const snapshots = sqliteTable("noddde_snapshots", {
  aggregateName: text("aggregate_name").notNull(),
  aggregateId: text("aggregate_id").notNull(),
  state: text("state").notNull(),
  version: integer("version").notNull(),
});
