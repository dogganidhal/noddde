/**
 * Bi-directional state mapper for the Room aggregate's dedicated typed-column
 * table. Bridges between the {@link RoomState} domain type and rows in any
 * Drizzle table that has the room column shape (PG production or SQLite tests).
 *
 * The framework writes `aggregate_id` and `version` itself; `toRow` and
 * `fromRow` only handle the state-portion columns.
 */

import type { Table } from "drizzle-orm";
import type { DrizzleStateMapper } from "@noddde/drizzle";
import type { RoomState } from "../../domain/write-model/aggregates/room/state";

/**
 * Structural shape every room-state Drizzle table must satisfy: a column
 * for each piece of state plus the framework-managed identity/version
 * columns. Both `pgTable(...)` and `sqliteTable(...)` produce values that
 * fit this shape.
 */
type RoomsTableShape = Table & {
  aggregateId: Table["_"]["columns"][string];
  version: Table["_"]["columns"][string];
  roomNumber: Table["_"]["columns"][string];
  type: Table["_"]["columns"][string];
  floor: Table["_"]["columns"][string];
  pricePerNight: Table["_"]["columns"][string];
  status: Table["_"]["columns"][string];
  currentBookingId: Table["_"]["columns"][string];
  currentGuestId: Table["_"]["columns"][string];
};

/**
 * Builds a {@link DrizzleStateMapper} for the Room aggregate. Accepts any
 * Drizzle table whose JS keys match the room-state column shape — used to
 * share one mapper definition between the production PG table
 * (`roomsTable`) and the integration-test SQLite mirror.
 *
 * @example
 * ```ts
 * const adapter = createDrizzleAdapter(db, {
 *   eventStore: events,
 *   sagaStore: sagaStates,
 *   stateStore: aggregateStates,
 *   aggregateStates: {
 *     Room: { table: roomsTable, mapper: createRoomStateMapper(roomsTable) },
 *   },
 * });
 * ```
 */
export function createRoomStateMapper<TTable extends RoomsTableShape>(
  table: TTable,
): DrizzleStateMapper<RoomState, TTable> {
  return {
    aggregateIdColumn: table.aggregateId,
    versionColumn: table.version,
    toRow(state: RoomState) {
      return {
        roomNumber: state.roomNumber,
        type: state.type,
        floor: state.floor,
        pricePerNight: state.pricePerNight,
        status: state.status,
        currentBookingId: state.currentBookingId,
        currentGuestId: state.currentGuestId,
      } as Partial<TTable["$inferInsert"]>;
    },
    fromRow(row): RoomState {
      const r = row as {
        roomNumber?: string | null;
        type?: RoomState["type"];
        floor?: number;
        pricePerNight?: number;
        status?: RoomState["status"];
        currentBookingId?: string | null;
        currentGuestId?: string | null;
      };
      return {
        roomNumber: r.roomNumber ?? null,
        type: r.type ?? null,
        floor: r.floor ?? 0,
        pricePerNight: r.pricePerNight ?? 0,
        status: r.status ?? "created",
        currentBookingId: r.currentBookingId ?? null,
        currentGuestId: r.currentGuestId ?? null,
      };
    },
  };
}

// Production PostgreSQL mapper, bound to roomsTable.
import { roomsTable } from "./rooms-table";

export const roomStateMapper: DrizzleStateMapper<RoomState, typeof roomsTable> =
  createRoomStateMapper(roomsTable);
