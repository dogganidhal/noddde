/* eslint-disable no-unused-vars */
import type { ID } from "../id";

/**
 * Base persistence and query interface for projection views.
 * Each projection can extend this with custom query methods
 * (findByX, listByY, aggregate queries).
 *
 * The framework calls `save()`, `load()`, and `delete()` for automatic view
 * persistence when the projection has `id` functions in its `on` map and a
 * `viewStore` is configured in the domain configuration. Reducers signal
 * deletion by returning the `DeleteView` sentinel; the engine routes that to
 * `delete()` instead of `save()`.
 *
 * @typeParam TView - The view model type this store persists and retrieves.
 *   Defaults to `any` for use in non-generic contexts (e.g., the runtime engine).
 *
 * @example
 * ```ts
 * // Base usage
 * const store: ViewStore<BankAccountView> = new InMemoryViewStore();
 *
 * // Extended with custom query methods
 * interface BankAccountViewStore extends ViewStore<BankAccountView> {
 *   findByBalanceRange(min: number, max: number): Promise<BankAccountView[]>;
 * }
 * ```
 */
export interface ViewStore<TView = any> {
  /**
   * Persists a view instance, replacing any previously stored view
   * for the given viewId.
   *
   * @param viewId - The unique identifier of the view instance.
   * @param view - The view to persist.
   */
  save(viewId: ID, view: TView): Promise<void>;

  /**
   * Loads a view instance by ID.
   * Returns `undefined` or `null` if no view exists for the given viewId.
   *
   * @param viewId - The unique identifier of the view instance.
   * @returns The stored view, or `undefined`/`null` if not found.
   */
  load(viewId: ID): Promise<TView | undefined | null>;

  /**
   * Deletes a view instance by ID. Idempotent — deleting a non-existent
   * view is a no-op and resolves successfully without error.
   *
   * @param viewId - The unique identifier of the view instance to delete.
   */
  delete(viewId: ID): Promise<void>;
}
