import { mysqlTable, varchar, int, text, json } from "drizzle-orm/mysql-core";

/**
 * MySQL table definition for event-sourced aggregate persistence.
 * Stores domain events as an append-only stream per aggregate instance.
 * Uses `int` with auto-increment for PK, `varchar(255)` for name columns,
 * and `json` for payload storage.
 */
export const events = mysqlTable("noddde_events", {
  id: int("id").primaryKey().autoincrement(),
  aggregateName: varchar("aggregate_name", { length: 255 }).notNull(),
  aggregateId: varchar("aggregate_id", { length: 255 }).notNull(),
  sequenceNumber: int("sequence_number").notNull(),
  eventName: varchar("event_name", { length: 255 }).notNull(),
  payload: json("payload").notNull(),
});

/**
 * MySQL table definition for state-stored aggregate persistence.
 * Stores the latest state snapshot per aggregate instance.
 */
export const aggregateStates = mysqlTable("noddde_aggregate_states", {
  aggregateName: varchar("aggregate_name", { length: 255 }).notNull(),
  aggregateId: varchar("aggregate_id", { length: 255 }).notNull(),
  state: text("state").notNull(),
});

/**
 * MySQL table definition for saga persistence.
 * Stores the current workflow state per saga instance.
 */
export const sagaStates = mysqlTable("noddde_saga_states", {
  sagaName: varchar("saga_name", { length: 255 }).notNull(),
  sagaId: varchar("saga_id", { length: 255 }).notNull(),
  state: text("state").notNull(),
});
