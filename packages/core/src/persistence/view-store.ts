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

/**
 * Singleton factory that mints {@link ViewStore} instances scoped to a
 * transactional context.
 *
 * The framework calls `getForContext(uow.context)` per strong-consistency
 * read-modify-write so that the developer's view store — including any
 * custom methods declared on an extended `ViewStore` interface — uses the
 * active transaction client. For non-transactional paths (eventual-
 * consistency projections, query handlers), the framework calls
 * `getForContext(undefined)` once and caches the result.
 *
 * Implementations typically hold shared resources (DB client, connection
 * pool) as member fields and return per-call store instances. For
 * in-memory stores, returning the same shared instance regardless of
 * `ctx` is appropriate.
 *
 * @typeParam TView - The view model type the minted stores persist.
 *
 * @example
 * ```ts
 * // Class-based factory
 * class PrismaItemViewStoreFactory implements ViewStoreFactory<Item> {
 *   constructor(private readonly prisma: PrismaClient) {}
 *   getForContext(ctx?: unknown): ViewStore<Item> {
 *     const exec = (ctx as Prisma.TransactionClient | undefined) ?? this.prisma;
 *     return new PrismaItemViewStore(exec);
 *   }
 * }
 *
 * // Plain-object factory
 * const factory: ViewStoreFactory<Item> = {
 *   getForContext: (ctx) => new MyStore(ctx ?? defaultClient),
 * };
 * ```
 */
export interface ViewStoreFactory<TView = any> {
  /**
   * Returns a {@link ViewStore} scoped to the given transactional context.
   *
   * @param ctx - The {@link UnitOfWork.context} of the active unit of work,
   *   or `undefined` when called outside a transactional region (eventual-
   *   consistency projections, query handlers, in-memory paths).
   *   Implementations narrow this to their adapter's transaction type.
   * @returns A `ViewStore<TView>` whose `save`, `load`, and any custom
   *   methods participate in the given transaction (when `ctx` is
   *   defined) or use the base, non-transactional client (when `ctx`
   *   is `undefined`).
   */
  getForContext(ctx?: unknown): ViewStore<TView>;
}

/**
 * Convenience helper that wraps a builder function as a
 * {@link ViewStoreFactory}. Useful when declaring a dedicated factory
 * class would add noise.
 *
 * @example
 * ```ts
 * const factory = createViewStoreFactory<Item>((ctx) =>
 *   new PrismaItemViewStore(
 *     (ctx as Prisma.TransactionClient | undefined) ?? prisma,
 *   ),
 * );
 * ```
 */
export function createViewStoreFactory<TView>(
  build: (ctx?: unknown) => ViewStore<TView>,
): ViewStoreFactory<TView> {
  return { getForContext: build };
}
