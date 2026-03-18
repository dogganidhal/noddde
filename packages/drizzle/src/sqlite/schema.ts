import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

/**
 * SQLite table definition for event-sourced aggregate persistence.
 * Stores domain events as an append-only stream per aggregate instance.
 */
export const events = sqliteTable("noddde_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  aggregateName: text("aggregate_name").notNull(),
  aggregateId: text("aggregate_id").notNull(),
  sequenceNumber: integer("sequence_number").notNull(),
  eventName: text("event_name").notNull(),
  payload: text("payload").notNull(),
});

/**
 * SQLite table definition for state-stored aggregate persistence.
 * Stores the latest state snapshot per aggregate instance.
 */
export const aggregateStates = sqliteTable("noddde_aggregate_states", {
  aggregateName: text("aggregate_name").notNull(),
  aggregateId: text("aggregate_id").notNull(),
  state: text("state").notNull(),
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
