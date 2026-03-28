import type { ID, ViewStore } from "@noddde/core";
import { eq, and, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { hotelViews } from "./db-schema";
import type {
  RoomAvailabilityView,
  RoomAvailabilityViewStore,
} from "../../domain/read-model/queries";
import type { RoomType } from "../types";

/**
 * Generic {@link ViewStore} backed by a Drizzle PostgreSQL table.
 * Views are JSONB-serialized into the `hotel_views` table, keyed
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
    protected readonly db: NodePgDatabase,
    // eslint-disable-next-line no-unused-vars
    protected readonly viewType: string,
  ) {}

  async save(viewId: ID, view: TView): Promise<void> {
    const data = JSON.stringify(view);
    const existing = await this.db
      .select()
      .from(hotelViews)
      .where(
        and(
          eq(hotelViews.viewType, this.viewType),
          eq(hotelViews.viewId, String(viewId)),
        ),
      )
      .execute();

    if (existing.length > 0) {
      await this.db
        .update(hotelViews)
        .set({ data })
        .where(
          and(
            eq(hotelViews.viewType, this.viewType),
            eq(hotelViews.viewId, String(viewId)),
          ),
        )
        .execute();
    } else {
      await this.db
        .insert(hotelViews)
        .values({ viewType: this.viewType, viewId: String(viewId), data })
        .execute();
    }
  }

  async load(viewId: ID): Promise<TView | undefined> {
    const rows = await this.db
      .select()
      .from(hotelViews)
      .where(
        and(
          eq(hotelViews.viewType, this.viewType),
          eq(hotelViews.viewId, String(viewId)),
        ),
      )
      .execute();

    const row = rows[0];
    if (!row) return undefined;
    return JSON.parse(row.data as string) as TView;
  }
}

/**
 * Drizzle-backed {@link RoomAvailabilityViewStore} that pushes
 * filtering to PostgreSQL via JSONB operators instead of loading
 * all views into memory.
 */
export class DrizzleRoomAvailabilityViewStore
  extends DrizzleViewStore<RoomAvailabilityView>
  implements RoomAvailabilityViewStore
{
  constructor(db: NodePgDatabase) {
    super(db, "RoomAvailability");
  }

  async findAvailable(type?: RoomType): Promise<RoomAvailabilityView[]> {
    const conditions = [
      eq(hotelViews.viewType, this.viewType),
      sql`${hotelViews.data}->>'status' = 'available'`,
    ];

    if (type) {
      conditions.push(sql`${hotelViews.data}->>'type' = ${type}`);
    }

    const rows = await this.db
      .select()
      .from(hotelViews)
      .where(and(...conditions))
      .execute();

    return rows.map(
      (row) => JSON.parse(row.data as string) as RoomAvailabilityView,
    );
  }
}
