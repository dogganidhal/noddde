import type { ViewStore, ViewStoreFactory } from "@noddde/core";
import { InMemoryViewStore } from "./in-memory-view-store";

/**
 * In-memory {@link ViewStoreFactory} implementation that holds a single
 * shared {@link InMemoryViewStore} instance and returns it for every call
 * to {@link getForContext}, regardless of the supplied transaction context.
 *
 * The in-memory backing has no real transaction, so there is nothing to
 * scope per call — both the eventual-consistency / query path and the
 * strong-consistency path share the same underlying `Map<string, TView>`.
 *
 * Suitable for development, testing, and prototyping. For production,
 * provide a factory backed by a durable store (TypeORM, Prisma, Drizzle).
 *
 * @typeParam TView - The view model type the minted store persists.
 *
 * @example
 * ```ts
 * const factory = new InMemoryViewStoreFactory<RoomAvailabilityView>();
 * await wireDomain(definition, {
 *   projections: {
 *     RoomAvailability: { viewStore: factory },
 *   },
 * });
 * ```
 */
export class InMemoryViewStoreFactory<TView>
  implements ViewStoreFactory<TView>
{
  private readonly store: InMemoryViewStore<TView>;

  constructor(store?: InMemoryViewStore<TView>) {
    this.store = store ?? new InMemoryViewStore<TView>();
  }

  /**
   * Returns the shared {@link InMemoryViewStore} backing this factory.
   * The `ctx` parameter is accepted for interface conformance but
   * ignored — there is no real transaction to scope to.
   */
  getForContext(): ViewStore<TView> {
    return this.store;
  }
}
