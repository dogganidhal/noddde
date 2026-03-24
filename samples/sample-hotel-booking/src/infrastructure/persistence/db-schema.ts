import { sqliteTable, text, primaryKey } from "drizzle-orm/sqlite-core";

// Re-export the noddde framework tables for convenience
export {
  events,
  aggregateStates,
  sagaStates,
  snapshots,
} from "@noddde/drizzle/sqlite";

/**
 * SQLite table for projection view storage (generic key-value store).
 * Each row stores one view instance identified by type + id.
 */
export const hotelViews = sqliteTable(
  "hotel_views",
  {
    viewType: text("view_type").notNull(),
    viewId: text("view_id").notNull(),
    data: text("data").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.viewType, table.viewId] }),
  }),
);
