import type { ID, ViewStore, ViewStoreFactory } from "@noddde/core";
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
 * The constructor accepts an `exec` (a `NodePgDatabase`) which can be
 * either the base connection pool or a transaction-scoped client. The
 * companion {@link DrizzleViewStoreFactory} mints these instances per
 * unit of work for strong-consistency projections, so `save` / `load`
 * (and any custom methods on subclasses) automatically participate in
 * the active transaction.
 *
 * @typeParam TView - The view model type to persist and retrieve.
 *
 * @example
 * ```ts
 * // Direct construction — non-transactional.
 * const store = new DrizzleViewStore<RoomAvailabilityView>(db, "RoomAvailability");
 * await store.save("room-101", { roomId: "room-101", status: "available", ... });
 *
 * // Factory — minted per UoW context.
 * const factory = new DrizzleViewStoreFactory<RoomAvailabilityView>(db, "RoomAvailability");
 * // engine calls: factory.getForContext(uow.context)
 * ```
 */
export class DrizzleViewStore<TView> implements ViewStore<TView> {
  constructor(
    // eslint-disable-next-line no-unused-vars
    protected readonly exec: NodePgDatabase,
    // eslint-disable-next-line no-unused-vars
    protected readonly viewType: string,
  ) {}

  async save(viewId: ID, view: TView): Promise<void> {
    const data = JSON.stringify(view);
    const existing = await this.exec
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
      await this.exec
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
      await this.exec
        .insert(hotelViews)
        .values({ viewType: this.viewType, viewId: String(viewId), data })
        .execute();
    }
  }

  async load(viewId: ID): Promise<TView | undefined> {
    const rows = await this.exec
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

  /**
   * Deletes a view instance by ID. Idempotent — if no row matches, the
   * Drizzle delete is a no-op and resolves successfully without error.
   *
   * @param viewId - The unique identifier of the view instance to delete.
   */
  async delete(viewId: ID): Promise<void> {
    await this.exec
      .delete(hotelViews)
      .where(
        and(
          eq(hotelViews.viewType, this.viewType),
          eq(hotelViews.viewId, String(viewId)),
        ),
      )
      .execute();
  }
}

/**
 * Generic {@link ViewStoreFactory} backing a Drizzle PostgreSQL table.
 * Holds the base `NodePgDatabase` and mints a fresh
 * {@link DrizzleViewStore} per call to {@link getForContext}, bound to
 * either the active transaction (when `ctx` is a Drizzle tx handle) or
 * the base client (when `ctx` is `undefined`).
 */
export class DrizzleViewStoreFactory<TView> implements ViewStoreFactory<TView> {
  constructor(
    // eslint-disable-next-line no-unused-vars
    protected readonly db: NodePgDatabase,
    // eslint-disable-next-line no-unused-vars
    protected readonly viewType: string,
  ) {}

  getForContext(ctx?: unknown): DrizzleViewStore<TView> {
    const exec = (ctx as NodePgDatabase | undefined) ?? this.db;
    return new DrizzleViewStore<TView>(exec, this.viewType);
  }
}

/**
 * Drizzle-backed {@link RoomAvailabilityViewStore} that pushes
 * filtering to PostgreSQL via JSONB operators instead of loading
 * all views into memory.
 *
 * Pair with {@link DrizzleRoomAvailabilityViewStoreFactory} in the
 * projection wiring so that strong-consistency view updates (and any
 * `findAvailable` calls invoked from within a unit of work) participate
 * in the active transaction.
 */
export class DrizzleRoomAvailabilityViewStore
  extends DrizzleViewStore<RoomAvailabilityView>
  implements RoomAvailabilityViewStore
{
  constructor(exec: NodePgDatabase) {
    super(exec, "RoomAvailability");
  }

  async findAvailable(type?: RoomType): Promise<RoomAvailabilityView[]> {
    const conditions = [
      eq(hotelViews.viewType, this.viewType),
      sql`${hotelViews.data}->>'status' = 'available'`,
    ];

    if (type) {
      conditions.push(sql`${hotelViews.data}->>'type' = ${type}`);
    }

    const rows = await this.exec
      .select()
      .from(hotelViews)
      .where(and(...conditions))
      .execute();

    return rows.map(
      (row) => JSON.parse(row.data as string) as RoomAvailabilityView,
    );
  }
}

/**
 * {@link ViewStoreFactory} that mints
 * {@link DrizzleRoomAvailabilityViewStore} instances scoped to the
 * unit of work's transaction context (when present) or to the base
 * `NodePgDatabase` connection (when called from outside a transaction
 * — eventual-consistency reads, query handlers).
 */
export class DrizzleRoomAvailabilityViewStoreFactory
  implements ViewStoreFactory<RoomAvailabilityView>
{
  // eslint-disable-next-line no-unused-vars
  constructor(private readonly db: NodePgDatabase) {}

  getForContext(ctx?: unknown): DrizzleRoomAvailabilityViewStore {
    const exec = (ctx as NodePgDatabase | undefined) ?? this.db;
    return new DrizzleRoomAvailabilityViewStore(exec);
  }
}
