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
 *   viewStore: BankAccountViewStore; // optional
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
  /** Optional typed view store for this projection. */
  viewStore?: ViewStore;
};

// ---- Internal handler maps ----

type ReducerMap<T extends ProjectionTypes> = {
  [EventName in T["events"]["name"]]: (
    event: Extract<T["events"], { name: EventName }>,
    view: T["view"],
  ) => Promise<T["view"]> | T["view"];
};

/**
 * Maps each event name to a function that extracts the view instance ID.
 * Mirrors {@link SagaAssociationMap} from saga.ts. Enables the engine to
 * route events to the correct view instance for auto-persistence.
 */
type IdentityMap<T extends ProjectionTypes> = {
  [K in T["events"]["name"]]: (
    event: Extract<T["events"], { name: K }>,
  ) => ID;
};

/**
 * Conditionally injects the view store into query handler infrastructure.
 * When T has a viewStore field extending ViewStore, query handlers receive
 * `T["infrastructure"] & { views: T["viewStore"] }`.
 * Otherwise, they receive just `T["infrastructure"]` (backward compatible).
 */
type ProjectionQueryInfra<T extends ProjectionTypes> =
  T extends { viewStore: infer VS extends ViewStore }
    ? T["infrastructure"] & { views: VS }
    : T["infrastructure"];

/**
 * Factory type for creating a view store from infrastructure.
 * Enables IoC: the projection definition (domain code) delegates store
 * creation to the factory, which receives infrastructure dependencies.
 */
type ViewStoreFactory<T extends ProjectionTypes> =
  T extends { viewStore: infer VS extends ViewStore }
    ? (infrastructure: T["infrastructure"]) => VS | Promise<VS>
    : (
        infrastructure: T["infrastructure"],
      ) => ViewStore<T["view"]> | Promise<ViewStore<T["view"]>>;

type QueryHandlerMap<T extends ProjectionTypes> = {
  [QueryName in T["queries"]["name"]]?: QueryHandler<
    ProjectionQueryInfra<T>,
    Extract<T["queries"], { name: QueryName }>
  >;
};

// ---- Projection definition ----

/**
 * A projection that transforms domain events into a read-optimized view and
 * co-locates query handlers for serving that view. Projections are the read
 * side of CQRS — they subscribe to events and maintain denormalized views
 * tailored for specific query needs.
 *
 * Each reducer receives the full event (with type narrowed by event name)
 * and the current view, returning the updated view.
 *
 * Optionally, projections can declare:
 * - {@link identity} — maps events to view instance IDs for auto-persistence.
 * - {@link viewStore} — factory for the typed view store (IoC).
 * - {@link initialView} — default view state for new entities.
 * - {@link consistency} — `"eventual"` (default) or `"strong"`.
 *
 * Use {@link defineProjection} to create a projection with full type inference.
 *
 * @typeParam T - The {@link ProjectionTypes} bundle for this projection.
 *
 * @example
 * ```ts
 * const BankAccountProjection = defineProjection<BankAccountProjectionDef>({
 *   reducers: {
 *     AccountCreated: (event, view) => ({ ...view, id: event.payload.id }),
 *     DepositMade: (event, view) => ({ ...view, balance: view.balance + event.payload.amount }),
 *   },
 *   identity: {
 *     AccountCreated: (event) => event.payload.id,
 *     DepositMade: (event) => event.payload.accountId,
 *   },
 *   viewStore: (infra) => new InMemoryViewStore(),
 *   queryHandlers: {
 *     GetAccountById: (payload, { views }) => views.load(payload.id),
 *   },
 * });
 * ```
 */
export interface Projection<T extends ProjectionTypes = ProjectionTypes> {
  /**
   * A map of reducer functions keyed by event name. Each reducer receives the
   * narrowed event type and current view, returning the updated view.
   */
  reducers: ReducerMap<T>;
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
   * Maps each event name to a function that extracts the view instance ID.
   * Enables per-entity auto-persistence: `event → identity → load → reduce → save`.
   *
   * Must be exhaustive — every event in the union must have a mapping.
   * Mirrors saga {@link SagaAssociationMap | associations}.
   */
  identity?: IdentityMap<T>;

  /**
   * Factory that creates the view store from infrastructure. Enables IoC:
   * the projection definition (domain code) delegates store creation to
   * the factory, which can use infrastructure dependencies (DB connections, etc.).
   *
   * Called during `Domain.init()` with the resolved infrastructure.
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
 * @param config - The projection configuration (reducers, queryHandlers,
 *   and optional identity, viewStore, initialView, consistency).
 * @returns The same configuration object, fully typed.
 *
 * @example
 * ```ts
 * const BankAccountProjection = defineProjection<BankAccountProjectionDef>({
 *   reducers: {
 *     AccountCreated: (event, view) => ({ ...view, id: event.payload.id }),
 *   },
 *   queryHandlers: {
 *     GetAccountById: (payload, { views }) => views.load(payload.id),
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
 * Extracts the infrastructure type from a {@link Projection} definition.
 *
 * @example
 * ```ts
 * type Infra = InferProjectionInfrastructure<typeof BankAccountProjection>; // BankingInfrastructure
 * ```
 */
export type InferProjectionInfrastructure<T extends Projection> =
  T extends Projection<infer U> ? U["infrastructure"] : never;
