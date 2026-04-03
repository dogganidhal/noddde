/* eslint-disable no-unused-vars */
import type { ID } from "../id";
import { Infrastructure } from "../infrastructure";
import { Event } from "../edd";
import { Query, QueryHandler } from "../cqrs";
import type { ViewStore } from "../persistence/view-store";

// ---- Types bundle ----

/**
 * A bundle of the type parameters that define a projection's type universe.
 * Instead of threading positional generics through every type, users declare
 * a single named `ProjectionTypes` that the framework destructures internally.
 *
 * Mirrors the {@link AggregateTypes} pattern used for aggregates.
 *
 * @example
 * ```ts
 * type BankAccountProjectionDef = {
 *   events: BankAccountEvent;
 *   queries: BankAccountQuery;
 *   view: BankAccountView;
 *   infrastructure: BankingInfrastructure;
 *   viewStore: BankAccountViewStore; // optional — type hint for { views } injection
 * };
 * ```
 */
export type ProjectionTypes = {
  /** The discriminated union of events this projection handles. */
  events: Event;
  /** The discriminated union of queries this projection can answer. */
  queries: Query<any>;
  /** The read-optimized view model this projection builds. */
  view: any;
  /** The external dependencies available to query handlers. */
  infrastructure: Infrastructure;
  /**
   * Optional typed view store for this projection. When present, enables
   * typed `{ views }` injection into query handlers via `ProjectionQueryInfra<T>`.
   * This is a type-level hint only — the actual view store is provided via
   * `DomainWiring.projections` in {@link wireDomain}.
   */
  viewStore?: ViewStore;
};

// ---- Event handler types ----

/**
 * A single event handler entry within a projection's `on` map.
 * Bundles the identity extractor and reducer for one event type.
 *
 * @typeParam TEvent - The narrowed event type for this handler.
 * @typeParam TView - The projection's view model type.
 */
export type ProjectionEventHandler<TEvent extends Event, TView> = {
  /**
   * Extracts the view instance ID from the event.
   * Optional per-entry at the type level. Required by the engine when
   * a view store is configured for auto-persistence.
   */
  id?: (event: TEvent) => ID;

  /**
   * Transforms the current view based on the event, returning the updated view.
   * Receives the full event object (not just payload).
   * May be sync or async.
   */
  reduce: (event: TEvent, view: TView) => TView | Promise<TView>;
};

/**
 * Maps event names to their projection handlers. Each entry bundles
 * an identity extractor and a reducer. This map is **partial** — only
 * events the projection cares about need entries. Unhandled events
 * are silently ignored at runtime.
 *
 * @typeParam T - The {@link ProjectionTypes} bundle.
 */
type ProjectionOnMap<T extends ProjectionTypes> = {
  [EventName in T["events"]["name"]]?: ProjectionEventHandler<
    Extract<T["events"], { name: EventName }>,
    T["view"]
  >;
};

// ---- Internal handler maps ----

/**
 * Conditionally injects the view store into query handler infrastructure.
 * When T has a viewStore field extending ViewStore, query handlers receive
 * `T["infrastructure"] & { views: T["viewStore"] }`.
 * Otherwise, they receive just `T["infrastructure"]` (backward compatible).
 */
type ProjectionQueryInfra<T extends ProjectionTypes> = T extends {
  viewStore: infer VS extends ViewStore;
}
  ? T["infrastructure"] & { views: VS }
  : T["infrastructure"];

type QueryHandlerMap<T extends ProjectionTypes> = {
  [QueryName in T["queries"]["name"]]?: QueryHandler<
    ProjectionQueryInfra<T>,
    Extract<T["queries"], { name: QueryName }>
  >;
};

/**
 * Factory function that resolves a view store from user infrastructure.
 * When `T` has a typed `viewStore` field in its `ProjectionTypes`, the
 * factory returns that specific view store type. Otherwise, it returns
 * a generic `ViewStore<T["view"]>`.
 */
type ViewStoreFactory<T extends ProjectionTypes> = T extends {
  viewStore: infer VS extends ViewStore;
}
  ? (infrastructure: T["infrastructure"]) => VS
  : (infrastructure: T["infrastructure"]) => ViewStore<T["view"]>;

// ---- Projection definition ----

/**
 * A projection that transforms domain events into a read-optimized view and
 * co-locates query handlers for serving that view. Projections are the read
 * side of CQRS — they subscribe to events and maintain denormalized views
 * tailored for specific query needs.
 *
 * The `on` map defines which events the projection handles. Each entry
 * bundles an identity extractor (`id`) and a reducer (`reduce`). Only
 * events the projection cares about need entries — unhandled events are
 * silently ignored.
 *
 * View store configuration lives in `DomainWiring.projections` via
 * {@link wireDomain}. The `viewStore` field in `ProjectionTypes` is a
 * type-level hint only — it enables typed `{ views }` injection into
 * query handlers.
 *
 * Use {@link defineProjection} to create a projection with full type inference.
 *
 * @typeParam T - The {@link ProjectionTypes} bundle for this projection.
 *
 * @example
 * ```ts
 * const RevenueProjection = defineProjection<RevenueProjectionDef>({
 *   initialView: { date: "", totalRevenue: 0, bookingCount: 0 },
 *   on: {
 *     PaymentCompleted: {
 *       id: (event) => day(event.payload.completedAt),
 *       reduce: (event, view) => ({
 *         date: day(event.payload.completedAt),
 *         totalRevenue: view.totalRevenue + event.payload.amount,
 *         bookingCount: view.bookingCount + 1,
 *       }),
 *     },
 *   },
 *   queryHandlers: {
 *     GetDailyRevenue: (query, { views }) => views.load(query.date),
 *   },
 * });
 * ```
 */
export interface Projection<T extends ProjectionTypes = ProjectionTypes> {
  /**
   * A partial map of event handlers keyed by event name. Each handler bundles
   * an `id` function (extracts view instance ID) and a `reduce` function
   * (transforms the view). Only events the projection cares about need
   * entries — this map is partial over the event union.
   */
  on: ProjectionOnMap<T>;

  /**
   * A map of query handlers keyed by query name. Handlers serve the view
   * built by the reducers. All handlers are optional — a projection may
   * handle events without directly serving queries.
   *
   * When `T` has a `viewStore` field, handlers receive `{ views }` merged
   * into their infrastructure parameter.
   */
  queryHandlers: QueryHandlerMap<T>;

  /**
   * Optional default view state for new view instances. When
   * `viewStore.load()` returns `undefined`/`null` for a new entity,
   * `initialView` is used as the starting state for the reducer.
   */
  initialView?: T["view"];

  /**
   * Optional factory that resolves the view store from user infrastructure.
   * Can be provided here for convenience, or via `DomainWiring.projections`
   * in {@link wireDomain} (which takes priority if both are set).
   */
  viewStore?: ViewStoreFactory<T>;

  /**
   * Consistency mode for view persistence:
   * - `"eventual"` (default): Views updated asynchronously via event bus
   *   after the command's UoW is committed and events are dispatched.
   * - `"strong"`: Views updated within the same UoW as the originating
   *   command. Provides atomic consistency — if the command fails, the
   *   view update is rolled back.
   */
  consistency?: "eventual" | "strong";
}

/**
 * Identity function that creates a projection definition with full type inference
 * across the event/query/view/infrastructure boundaries. This is the
 * recommended way to define projections.
 *
 * @typeParam T - Inferred {@link ProjectionTypes} bundle.
 * @param config - The projection configuration (`on` map, `queryHandlers`,
 *   and optional `initialView`, `consistency`).
 * @returns The same configuration object, fully typed.
 *
 * @example
 * ```ts
 * const RevenueProjection = defineProjection<RevenueProjectionDef>({
 *   on: {
 *     PaymentCompleted: {
 *       id: (event) => day(event.payload.completedAt),
 *       reduce: (event, view) => ({ ...view, count: view.count + 1 }),
 *     },
 *   },
 *   queryHandlers: {
 *     GetDailyRevenue: (query, { views }) => views.load(query.date),
 *   },
 * });
 * ```
 */
export function defineProjection<T extends ProjectionTypes>(
  config: Projection<T>,
): Projection<T> {
  return config;
}

// ---- Type inference helpers ----

/**
 * Extracts the view type from a {@link Projection} definition.
 *
 * @example
 * ```ts
 * type View = InferProjectionView<typeof BankAccountProjection>; // BankAccountView
 * ```
 */
export type InferProjectionView<T extends Projection> =
  T extends Projection<infer U> ? U["view"] : never;

/**
 * Extracts the event union type from a {@link Projection} definition.
 *
 * @example
 * ```ts
 * type Events = InferProjectionEvents<typeof BankAccountProjection>; // BankAccountEvent
 * ```
 */
export type InferProjectionEvents<T extends Projection> =
  T extends Projection<infer U> ? U["events"] : never;

/**
 * Extracts the query union type from a {@link Projection} definition.
 *
 * @example
 * ```ts
 * type Queries = InferProjectionQueries<typeof BankAccountProjection>; // BankAccountQuery
 * ```
 */
export type InferProjectionQueries<T extends Projection> =
  T extends Projection<infer U> ? U["queries"] : never;

/**
 * Extracts the union of all query types from a map of projections.
 * Distributes {@link InferProjectionQueries} across each value in the map.
 *
 * @example
 * ```ts
 * const projections = { ItemProjection, OrderProjection } as const;
 * type AllQueries = InferProjectionMapQueries<typeof projections>;
 * // ItemQuery | OrderQuery
 * ```
 */
export type InferProjectionMapQueries<
  TMap extends Record<string | symbol, Projection<any>>,
> = {
  [K in keyof TMap]: TMap[K] extends Projection<infer U> ? U["queries"] : never;
}[keyof TMap];

/**
 * Extracts the infrastructure type from a {@link Projection} definition.
 *
 * @example
 * ```ts
 * type Infra = InferProjectionInfrastructure<typeof BankAccountProjection>; // BankingInfrastructure
 * ```
 */
export type InferProjectionInfrastructure<T extends Projection> =
  T extends Projection<infer U> ? U["infrastructure"] : never;

/**
 * Computes the intersection of all infrastructure types declared across
 * a map of projections. Used by `wireDomain` to infer what the
 * `wiring.infrastructure` factory must return.
 */
export type InferProjectionMapInfrastructure<
  TMap extends Record<string | symbol, Projection<any>>,
> = {
  [K in keyof TMap]: TMap[K] extends Projection<infer U>
    ? U["infrastructure"]
    : never;
}[keyof TMap];

// ---- Handler-level inference utilities ----

/**
 * Infers the fully-typed projection event handler (`{ id?, reduce }` bundle)
 * for a specific event name within a {@link ProjectionTypes} bundle. Use this
 * to type extracted projection event handlers in separate files.
 *
 * Operates on the `ProjectionTypes` bundle (not the `Projection` definition),
 * so it can be used before `defineProjection` is called.
 *
 * @typeParam T - The {@link ProjectionTypes} bundle.
 * @typeParam K - The event name literal (a member of `T["events"]["name"]`).
 *
 * @example
 * ```ts
 * // on-payment-completed.ts
 * export const onPaymentCompleted: InferProjectionEventHandler<RevenueDef, "PaymentCompleted"> = {
 *   id: (event) => day(event.payload.completedAt),
 *   reduce: (event, view) => ({
 *     ...view,
 *     totalRevenue: view.totalRevenue + event.payload.amount,
 *   }),
 * };
 * ```
 */
export type InferProjectionEventHandler<
  T extends ProjectionTypes,
  K extends T["events"]["name"],
> = ProjectionEventHandler<Extract<T["events"], { name: K }>, T["view"]>;

/**
 * Computes the full infrastructure type for a projection's query handlers.
 * When the {@link ProjectionTypes} bundle has a typed `viewStore` field,
 * query handlers receive `T["infrastructure"] & { views: T["viewStore"] }`.
 * Otherwise, they receive just `T["infrastructure"]`.
 *
 * This is the public export of the internal `ProjectionQueryInfra<T>` logic.
 *
 * @typeParam T - The {@link ProjectionTypes} bundle.
 *
 * @example
 * ```ts
 * type Infra = InferProjectionQueryInfrastructure<AccountProjectionDef>;
 * // → AccountInfra & { views: AccountViewStore }  (when viewStore is present)
 * // → AccountInfra                                 (when viewStore is absent)
 * ```
 */
export type InferProjectionQueryInfrastructure<T extends ProjectionTypes> =
  T extends {
    viewStore: infer VS extends ViewStore;
  }
    ? T["infrastructure"] & { views: VS }
    : T["infrastructure"];

/**
 * Infers the fully-typed query handler function for a specific query name
 * within a {@link ProjectionTypes} bundle. Use this to type extracted query
 * handlers in separate files. Infrastructure is automatically merged with
 * `{ views }` when the projection defines a typed `viewStore`.
 *
 * Operates on the `ProjectionTypes` bundle (not the `Projection` definition),
 * so it can be used before `defineProjection` is called.
 *
 * @typeParam T - The {@link ProjectionTypes} bundle.
 * @typeParam K - The query name literal (a member of `T["queries"]["name"]`).
 *
 * @example
 * ```ts
 * // query-daily-revenue.ts
 * export const queryDailyRevenue: InferProjectionQueryHandler<RevenueDef, "GetDailyRevenue"> = (
 *   query, { views }
 * ) => views.load(query.date);
 * ```
 */
export type InferProjectionQueryHandler<
  T extends ProjectionTypes,
  K extends T["queries"]["name"],
> = QueryHandler<
  InferProjectionQueryInfrastructure<T>,
  Extract<T["queries"], { name: K }>
>;
