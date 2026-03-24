import {
  mysqlTable,
  varchar,
  int,
  text,
  json,
  uniqueIndex,
} from "drizzle-orm/mysql-core";

/**
 * MySQL table definition for event-sourced aggregate persistence.
 * Stores domain events as an append-only stream per aggregate instance.
 * Uses `int` with auto-increment for PK, `varchar(255)` for name columns,
 * and `json` for payload storage.
 */
export const events = mysqlTable(
  "noddde_events",
  {
    id: int("id").primaryKey().autoincrement(),
    aggregateName: varchar("aggregate_name", { length: 255 }).notNull(),
    aggregateId: varchar("aggregate_id", { length: 255 }).notNull(),
    sequenceNumber: int("sequence_number").notNull(),
    eventName: varchar("event_name", { length: 255 }).notNull(),
    payload: json("payload").notNull(),
    metadata: json("metadata"),
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
 * MySQL table definition for state-stored aggregate persistence.
 * Stores the latest state snapshot per aggregate instance.
 */
export const aggregateStates = mysqlTable("noddde_aggregate_states", {
  aggregateName: varchar("aggregate_name", { length: 255 }).notNull(),
  aggregateId: varchar("aggregate_id", { length: 255 }).notNull(),
  state: text("state").notNull(),
  version: int("version").notNull().default(0),
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

/**
 * MySQL table definition for aggregate state snapshots.
 * Stores the latest snapshot per aggregate instance for
 * optimized event-sourced aggregate loading.
 */
export const snapshots = mysqlTable("noddde_snapshots", {
  aggregateName: varchar("aggregate_name", { length: 255 }).notNull(),
  aggregateId: varchar("aggregate_id", { length: 255 }).notNull(),
  state: text("state").notNull(),
  version: int("version").notNull(),
});

/**
 * MySQL table definition for the transactional outbox.
 * Stores domain events pending publication.
 * Uses `json` for native JSON storage of the event payload.
 */
export const outbox = mysqlTable("noddde_outbox", {
  id: varchar("id", { length: 255 }).primaryKey(),
  event: json("event").notNull(),
  aggregateName: varchar("aggregate_name", { length: 255 }),
  aggregateId: varchar("aggregate_id", { length: 255 }),
  createdAt: varchar("created_at", { length: 255 }).notNull(),
  publishedAt: varchar("published_at", { length: 255 }),
});
