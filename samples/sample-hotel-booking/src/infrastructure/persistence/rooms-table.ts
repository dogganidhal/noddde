/**
 * Dedicated Drizzle table for the Room aggregate's typed-column state storage.
 *
 * Each row maps one-to-one with a Room aggregate instance. The framework
 * writes `aggregate_id` and `version` itself; all other columns are state
 * fields controlled by {@link roomStateMapper}.
 *
 * This table is used in place of the shared `noddde_aggregate_states` table
 * for the Room aggregate, demonstrating the bi-directional
 * {@link DrizzleStateMapper} feature.
 */

import { pgTable, text, integer, real } from "drizzle-orm/pg-core";

/**
 * PostgreSQL table for Room aggregate state. Each column corresponds to a
 * field in {@link RoomState} (from `domain/write-model/aggregates/room/state`).
 *
 * Columns:
 * - `aggregate_id` — Room aggregate identity (primary key).
 * - `version` — Optimistic concurrency version, managed by the framework.
 * - `room_number` — Physical room number (null until `RoomCreated`).
 * - `type` — Room type: `"single"`, `"double"`, or `"suite"`.
 * - `floor` — Floor number within the building.
 * - `price_per_night` — Nightly rate in the domain's currency unit.
 * - `status` — Room lifecycle status.
 * - `current_booking_id` — Active booking id, null when unoccupied.
 * - `current_guest_id` — Active guest id, null when unoccupied.
 */
export const roomsTable = pgTable("rooms", {
  /** Aggregate identity — primary key. Managed by the framework. */
  aggregateId: text("aggregate_id").primaryKey(),
  /** Optimistic concurrency version. Managed by the framework. */
  version: integer("version").notNull().default(0),
  /** Physical room number (null before the first `RoomCreated` event). */
  roomNumber: text("room_number"),
  /** Room type classification. */
  type: text("type").$type<"single" | "double" | "suite">(),
  /** Floor within the building. */
  floor: integer("floor").notNull().default(0),
  /** Nightly rate in the domain's currency unit. */
  pricePerNight: real("price_per_night").notNull().default(0),
  /** Room lifecycle status. */
  status: text("status")
    .$type<"created" | "available" | "reserved" | "occupied" | "maintenance">()
    .notNull()
    .default("created"),
  /** Id of the currently active booking, null when the room is free. */
  currentBookingId: text("current_booking_id"),
  /** Id of the currently checked-in guest, null when the room is free. */
  currentGuestId: text("current_guest_id"),
});
