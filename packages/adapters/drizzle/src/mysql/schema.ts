import {
  mysqlTable,
  varchar,
  int,
  text,
  json,
  timestamp,
  uniqueIndex,
  index,
  primaryKey,
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
    createdAt: timestamp("created_at", { mode: "string", fsp: 3 })
      .notNull()
      .defaultNow(),
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
export const aggregateStates = mysqlTable(
  "noddde_aggregate_states",
  {
    aggregateName: varchar("aggregate_name", { length: 255 }).notNull(),
    aggregateId: varchar("aggregate_id", { length: 255 }).notNull(),
    state: text("state").notNull(),
    version: int("version").notNull().default(0),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.aggregateName, table.aggregateId] }),
  }),
);

/**
 * MySQL table definition for saga persistence.
 * Stores the current workflow state per saga instance.
 */
export const sagaStates = mysqlTable(
  "noddde_saga_states",
  {
    sagaName: varchar("saga_name", { length: 255 }).notNull(),
    sagaId: varchar("saga_id", { length: 255 }).notNull(),
    state: text("state").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.sagaName, table.sagaId] }),
  }),
);

/**
 * MySQL table definition for aggregate state snapshots.
 * Stores the latest snapshot per aggregate instance for
 * optimized event-sourced aggregate loading.
 */
export const snapshots = mysqlTable(
  "noddde_snapshots",
  {
    aggregateName: varchar("aggregate_name", { length: 255 }).notNull(),
    aggregateId: varchar("aggregate_id", { length: 255 }).notNull(),
    state: text("state").notNull(),
    version: int("version").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.aggregateName, table.aggregateId] }),
  }),
);

/**
 * MySQL table definition for the transactional outbox.
 * Stores domain events pending publication.
 * Uses `json` for native JSON storage of the event payload.
 */
export const outbox = mysqlTable(
  "noddde_outbox",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    event: json("event").notNull(),
    /** Extracted from `event.metadata.eventId` at write time; indexed so
     * `markPublishedByEventIds` can look up rows directly instead of
     * scanning the unpublished backlog. Nullable — rows written before
     * this column existed have it `NULL` until backfilled. */
    eventId: varchar("event_id", { length: 255 }),
    aggregateName: varchar("aggregate_name", { length: 255 }),
    aggregateId: varchar("aggregate_id", { length: 255 }),
    createdAt: timestamp("created_at", { mode: "string", fsp: 3 })
      .notNull()
      .defaultNow(),
    publishedAt: timestamp("published_at", { mode: "string", fsp: 3 }),
  },
  (table) => ({
    eventIdIdx: index("noddde_outbox_event_id_idx").on(table.eventId),
  }),
);

/**
 * MySQL table definition for event handler idempotency tracking.
 * Records dedup keys already processed so redelivered events (Kafka,
 * RabbitMQ at-least-once semantics) can be detected and skipped.
 */
export const eventIdempotency = mysqlTable("noddde_event_idempotency", {
  key: varchar("key", { length: 255 }).primaryKey(),
  processedAt: timestamp("processed_at", { mode: "string", fsp: 3 })
    .notNull()
    .defaultNow(),
});
