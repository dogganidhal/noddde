import { Infrastructure } from "../infrastructure";
import { Event } from "../edd";
import { Query, QueryHandler } from "../cqrs";

// ---- Types bundle ----

/**
 * A bundle of the four type parameters that define a projection's type universe.
 * Instead of threading 4 positional generics through every type, users declare
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
};

// ---- Internal handler maps ----

type ReducerMap<T extends ProjectionTypes> = {
  [EventName in T["events"]["name"]]: (
    event: Extract<T["events"], { name: EventName }>,
    view: T["view"],
  ) => Promise<T["view"]> | T["view"];
};

type QueryHandlerMap<T extends ProjectionTypes> = {
  [QueryName in T["queries"]["name"]]?: QueryHandler<
    T["infrastructure"],
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
 *   queryHandlers: {
 *     GetAccountById: (payload, infra) => infra.repo.getById(payload.id),
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
   */
  queryHandlers: QueryHandlerMap<T>;
}

/**
 * Identity function that creates a projection definition with full type inference
 * across the event/query/view/infrastructure boundaries. This is the
 * recommended way to define projections.
 *
 * @typeParam T - Inferred {@link ProjectionTypes} bundle.
 * @param config - The projection configuration (reducers, queryHandlers).
 * @returns The same configuration object, fully typed.
 *
 * @example
 * ```ts
 * const BankAccountProjection = defineProjection<BankAccountProjectionDef>({
 *   reducers: {
 *     AccountCreated: (event, view) => ({ ...view, id: event.payload.id }),
 *   },
 *   queryHandlers: {
 *     GetAccountById: (payload, infra) => infra.repo.getById(payload.id),
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
