import type { ID, ViewStore } from "@noddde/core";

/**
 * In-memory {@link ViewStore} implementation that stores projection views
 * in a `Map`. State is lost when the process exits.
 *
 * Views are keyed by `String(viewId)` for consistent key comparison
 * across all {@link ID} types (`string`, `number`, `bigint`).
 *
 * Includes convenience methods `findAll()` and `find(predicate)` for
 * development and testing — these are not part of the base `ViewStore`
 * interface.
 *
 * Suitable for development, testing, and prototyping.
 * For production, use a durable store (TypeORM, Prisma, Drizzle adapters).
 */
export class InMemoryViewStore<TView> implements ViewStore<TView> {
  private readonly store = new Map<string, TView>();

  /**
   * Persists a view instance, replacing any previously stored view
   * for the given viewId.
   *
   * @param viewId - The unique identifier of the view instance.
   * @param view - The view to persist.
   */
  public async save(viewId: ID, view: TView): Promise<void> {
    this.store.set(String(viewId), view);
  }

  /**
   * Loads a view instance by ID.
   * Returns `undefined` if no view exists for the given viewId.
   *
   * @param viewId - The unique identifier of the view instance.
   * @returns The stored view, or `undefined` if not found.
   */
  public async load(viewId: ID): Promise<TView | undefined> {
    return this.store.get(String(viewId));
  }

  /**
   * Returns all stored views. Order is not guaranteed.
   * Convenience method for development and testing — not part of
   * the base `ViewStore` interface.
   *
   * @returns An array of all stored view values.
   */
  public async findAll(): Promise<TView[]> {
    return [...this.store.values()];
  }

  /**
   * Returns all stored views matching the given predicate.
   * Convenience method for development and testing — not part of
   * the base `ViewStore` interface.
   *
   * @param predicate - A function that returns `true` for views to include.
   * @returns An array of matching views.
   */
  public async find(predicate: (view: TView) => boolean): Promise<TView[]> {
    return [...this.store.values()].filter(predicate);
  }
}
