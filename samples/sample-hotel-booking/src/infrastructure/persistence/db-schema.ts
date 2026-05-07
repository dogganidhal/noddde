import { pgTable, text, jsonb, primaryKey } from "drizzle-orm/pg-core";

// Re-export the noddde framework tables for convenience
export {
  events,
  aggregateStates,
  sagaStates,
  snapshots,
} from "@noddde/drizzle/pg";

// Re-export the dedicated Room aggregate table and its state mapper
export { roomsTable } from "./rooms-table";
export { roomStateMapper } from "./room-state-mapper";

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
