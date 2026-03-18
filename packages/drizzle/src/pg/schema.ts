import { pgTable, text, serial, integer, jsonb } from "drizzle-orm/pg-core";

/**
 * PostgreSQL table definition for event-sourced aggregate persistence.
 * Stores domain events as an append-only stream per aggregate instance.
 * Uses `serial` for auto-increment PK and `jsonb` for payload storage.
 */
export const events = pgTable("noddde_events", {
  id: serial("id").primaryKey(),
  aggregateName: text("aggregate_name").notNull(),
  aggregateId: text("aggregate_id").notNull(),
  sequenceNumber: integer("sequence_number").notNull(),
  eventName: text("event_name").notNull(),
  payload: jsonb("payload").notNull(),
});

/**
 * PostgreSQL table definition for state-stored aggregate persistence.
 * Stores the latest state snapshot per aggregate instance.
 * Uses `jsonb` for native JSON storage with indexing support.
 */
export const aggregateStates = pgTable("noddde_aggregate_states", {
  aggregateName: text("aggregate_name").notNull(),
  aggregateId: text("aggregate_id").notNull(),
  state: jsonb("state").notNull(),
});

/**
 * PostgreSQL table definition for saga persistence.
 * Stores the current workflow state per saga instance.
 * Uses `jsonb` for native JSON storage.
 */
export const sagaStates = pgTable("noddde_saga_states", {
  sagaName: text("saga_name").notNull(),
  sagaId: text("saga_id").notNull(),
  state: jsonb("state").notNull(),
});
