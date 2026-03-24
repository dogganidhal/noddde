import type { ID, ViewStore } from "@noddde/core";
import { eq, and, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { hotelViews } from "./db-schema";
import type {
  RoomAvailabilityView,
  RoomAvailabilityViewStore,
} from "../../domain/read-model/queries";
import type { RoomType } from "../types";

/**
 * Generic {@link ViewStore} backed by a Drizzle SQLite table.
 * Views are JSON-serialized into the `hotel_views` table, keyed
 * by `(view_type, view_id)`.
 *
 * @typeParam TView - The view model type to persist and retrieve.
 *
 * @example
 * ```ts
 * const store = new DrizzleViewStore<RoomAvailabilityView>(db, "RoomAvailability");
 * await store.save("room-101", { roomId: "room-101", status: "available", ... });
 * const view = await store.load("room-101");
 * ```
 */
export class DrizzleViewStore<TView> implements ViewStore<TView> {
  constructor(
    // eslint-disable-next-line no-unused-vars
    protected readonly db: BetterSQLite3Database,
    // eslint-disable-next-line no-unused-vars
    protected readonly viewType: string,
  ) {}

  async save(viewId: ID, view: TView): Promise<void> {
    const data = JSON.stringify(view);
    const existing = this.db
      .select()
      .from(hotelViews)
      .where(
        and(
          eq(hotelViews.viewType, this.viewType),
          eq(hotelViews.viewId, String(viewId)),
        ),
      )
      .get();

    if (existing) {
      this.db
        .update(hotelViews)
        .set({ data })
        .where(
          and(
            eq(hotelViews.viewType, this.viewType),
            eq(hotelViews.viewId, String(viewId)),
          ),
        )
        .run();
    } else {
      this.db
        .insert(hotelViews)
        .values({ viewType: this.viewType, viewId: String(viewId), data })
        .run();
    }
  }

  async load(viewId: ID): Promise<TView | undefined> {
    const row = this.db
      .select()
      .from(hotelViews)
      .where(
        and(
          eq(hotelViews.viewType, this.viewType),
          eq(hotelViews.viewId, String(viewId)),
        ),
      )
      .get();

    if (!row) return undefined;
    return JSON.parse(row.data) as TView;
  }
}

/**
 * Drizzle-backed {@link RoomAvailabilityViewStore} that pushes
 * filtering to SQLite via `json_extract` instead of loading
 * all views into memory.
 */
export class DrizzleRoomAvailabilityViewStore
  extends DrizzleViewStore<RoomAvailabilityView>
  implements RoomAvailabilityViewStore
{
  constructor(db: BetterSQLite3Database) {
    super(db, "RoomAvailability");
  }

  async findAvailable(type?: RoomType): Promise<RoomAvailabilityView[]> {
    const conditions = [
      eq(hotelViews.viewType, this.viewType),
      sql`json_extract(${hotelViews.data}, '$.status') = 'available'`,
    ];

    if (type) {
      conditions.push(
        sql`json_extract(${hotelViews.data}, '$.type') = ${type}`,
      );
    }

    const rows = this.db
      .select()
      .from(hotelViews)
      .where(and(...conditions))
      .all();

    return rows.map((row) => JSON.parse(row.data) as RoomAvailabilityView);
  }
}
