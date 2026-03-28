import { pgTable, text, jsonb, primaryKey } from "drizzle-orm/pg-core";

// Re-export the noddde framework tables for convenience
export {
  events,
  aggregateStates,
  sagaStates,
  snapshots,
} from "@noddde/drizzle/pg";

/**
 * PostgreSQL table for projection view storage (generic key-value store).
 * Each row stores one view instance identified by type + id.
 */
export const hotelViews = pgTable(
  "hotel_views",
  {
    viewType: text("view_type").notNull(),
    viewId: text("view_id").notNull(),
    data: jsonb("data").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.viewType, table.viewId] }),
  }),
);
