import { Infrastructure } from "../infrastructure";
import { Event } from "../edd";
import { Query, QueryHandler } from "../cqrs";

type QueryHandlerMap<
  TInfrastructure extends Infrastructure,
  TQuery extends Query<any>,
> = {
  [QueryName in TQuery["name"]]?: QueryHandler<
    TInfrastructure,
    Extract<TQuery, { name: QueryName }>
  >;
};

/**
 * A projection that transforms domain events into a read-optimized view and
 * co-locates query handlers for serving that view. Projections are the read
 * side of CQRS — they subscribe to events and maintain denormalized views
 * tailored for specific query needs.
 *
 * Each reducer receives the full event (with type narrowed by event name)
 * and the current view, returning the updated view.
 *
 * @typeParam TEvent - The discriminated union of events this projection handles.
 * @typeParam TQuery - The discriminated union of queries this projection can answer.
 * @typeParam TView - The read-optimized view model this projection builds.
 * @typeParam TInfrastructure - The infrastructure dependencies for query handlers.
 *
 * @example
 * ```ts
 * const BankAccountProjection: Projection<
 *   BankAccountEvent,
 *   BankAccountQuery,
 *   BankAccountView,
 *   BankingInfrastructure
 * > = {
 *   reducers: {
 *     AccountCreated: (event, view) => ({ ...view, id: event.payload.id }),
 *     DepositMade: (event, view) => ({ ...view, balance: view.balance + event.payload.amount }),
 *   },
 *   queryHandlers: {
 *     GetAccountById: (payload, infra) => infra.repo.getById(payload.id),
 *   },
 * };
 * ```
 */
export type Projection<
  TEvent extends Event,
  TQuery extends Query<any>,
  TView = any,
  TInfrastructure extends Infrastructure = Infrastructure,
> = {
  /**
   * A map of reducer functions keyed by event name. Each reducer receives the
   * narrowed event type and current view, returning the updated view.
   */
  reducers: {
    [EventName in TEvent["name"]]: (
      event: Extract<TEvent, { name: EventName }>,
      view: TView,
    ) => Promise<TView> | TView;
  };
  /**
   * A map of query handlers keyed by query name. Handlers serve the view
   * built by the reducers. All handlers are optional — a projection may
   * handle events without directly serving queries.
   */
  queryHandlers: QueryHandlerMap<TInfrastructure, TQuery>;
};
