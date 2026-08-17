/* eslint-disable no-redeclare */
import type { Aggregate } from "./aggregate-root";
import type { Projection } from "./projection";
import type { Saga } from "./saga";
import type { Command } from "../cqrs/command/command";
import type { StandaloneCommandHandler } from "../cqrs/command/command-handler";
import type { Query } from "../cqrs/query/query";
import type { QueryHandler } from "../cqrs/query/query-handler";
import type { Event } from "../edd/event";
import type { EventHandler } from "../edd/event-handler";
import type { Infrastructure } from "../infrastructure";

/**
 * Maps command names to standalone command handlers. File-private — exposed
 * only as part of DomainDefinition's writeModel.standaloneCommandHandlers.
 */
type StandaloneCommandHandlerMap<
  TInfrastructure extends Infrastructure,
  TStandaloneCommand extends Command,
> = {
  [CommandName in TStandaloneCommand["name"]]?: StandaloneCommandHandler<
    TInfrastructure,
    Extract<TStandaloneCommand, { name: CommandName }>
  >;
};

/**
 * Maps query names to standalone query handlers. File-private — exposed
 * only as part of DomainDefinition's readModel.standaloneQueryHandlers.
 */
type StandaloneQueryHandlerMap<
  TInfrastructure extends Infrastructure,
  TStandaloneQuery extends Query<any>,
> = {
  [QueryName in TStandaloneQuery["name"]]?: QueryHandler<
    TInfrastructure,
    Extract<TStandaloneQuery, { name: QueryName }>
  >;
};

/**
 * Maps event names to standalone event handlers. File-private — exposed
 * only as part of DomainDefinition's processModel.standaloneEventHandlers.
 */
type StandaloneEventHandlerMap<
  TInfrastructure extends Infrastructure,
  TStandaloneEvent extends Event,
> = {
  [EventName in TStandaloneEvent["name"]]?: EventHandler<
    Extract<TStandaloneEvent, { name: EventName }>,
    TInfrastructure
  >;
};

/**
 * Pure structural definition of a domain. Contains aggregates, projections,
 * sagas, and handler registrations — no runtime or infrastructure concerns.
 *
 * Created via {@link defineDomain}. Pass to `wireDomain` (from `@noddde/engine`)
 * along with infrastructure wiring to create a running `Domain` instance.
 */
export type DomainDefinition<
  TInfrastructure extends Infrastructure = Infrastructure,
  TStandaloneCommand extends Command = Command,
  TStandaloneQuery extends Query<any> = Query<any>,
  TAggregates extends Record<string | symbol, Aggregate<any>> = Record<
    string | symbol,
    Aggregate<any>
  >,
  TStandaloneEvent extends Event = Event,
  TProjections extends Record<string | symbol, Projection<any>> = Record<
    string | symbol,
    Projection<any>
  >,
> = {
  /** The write side: aggregates and standalone command handlers. */
  writeModel: {
    /** A map of aggregate definitions keyed by aggregate name. */
    aggregates: TAggregates;
    /** Optional map of standalone command handlers keyed by command name. */
    standaloneCommandHandlers?: StandaloneCommandHandlerMap<
      TInfrastructure,
      TStandaloneCommand
    >;
  };
  /** The read side: projections and standalone query handlers. */
  readModel: {
    /** A map of projection definitions keyed by projection name. */
    projections: TProjections;
    /** Optional map of standalone query handlers keyed by query name. */
    standaloneQueryHandlers?: StandaloneQueryHandlerMap<
      TInfrastructure,
      TStandaloneQuery
    >;
  };
  /**
   * Process model: sagas and standalone event handlers. Optional — omit if
   * the domain has no cross-aggregate workflows or event-driven side effects.
   */
  processModel?: {
    /** A map of saga definitions keyed by saga name. Optional — omit if no sagas. */
    sagas?: Record<string | symbol, Saga<any, any>>;
    /** Optional map of standalone event handlers keyed by event name. */
    standaloneEventHandlers?: StandaloneEventHandlerMap<
      TInfrastructure,
      TStandaloneEvent
    >;
  };
};

/**
 * Creates a pure, sync domain definition with full type inference.
 * Consistent with {@link defineAggregate}, {@link defineProjection}, {@link defineSaga}.
 *
 * **Preferred usage** (no explicit generics — enables typed dispatch):
 * ```ts
 * const domain = defineDomain({
 *   writeModel: { aggregates: { Counter, Todo } },
 *   readModel: { projections: { CounterView } },
 * });
 * ```
 *
 * **Legacy usage** (explicit infrastructure generic — typed dispatch is NOT available):
 * ```ts
 * const domain = defineDomain<MyInfrastructure>({...});
 * ```
 *
 * @returns The same definition object, fully typed.
 */
export function defineDomain<
  T extends DomainDefinition<any, any, any, any, any, any>,
>(definition: T): T;
/**
 * Legacy overload: explicit infrastructure generic. Standalone handler
 * infrastructure is typed, but typed dispatch (narrowed command/query names)
 * is NOT available because TypeScript cannot infer TAggregates/TProjections
 * when explicit generics are provided.
 *
 * @deprecated Prefer calling `defineDomain({...})` without explicit generics.
 */
export function defineDomain<
  TInfrastructure extends Infrastructure,
  TStandaloneCommand extends Command = Command,
  TStandaloneQuery extends Query<any> = Query<any>,
  TAggregates extends Record<string | symbol, Aggregate<any>> = Record<
    string | symbol,
    Aggregate<any>
  >,
  TStandaloneEvent extends Event = Event,
  TProjections extends Record<string | symbol, Projection<any>> = Record<
    string | symbol,
    Projection<any>
  >,
>(
  definition: DomainDefinition<
    TInfrastructure,
    TStandaloneCommand,
    TStandaloneQuery,
    TAggregates,
    TStandaloneEvent,
    TProjections
  >,
): DomainDefinition<
  TInfrastructure,
  TStandaloneCommand,
  TStandaloneQuery,
  TAggregates,
  TStandaloneEvent,
  TProjections
>;
export function defineDomain(definition: DomainDefinition): DomainDefinition {
  return definition;
}
/* eslint-enable no-redeclare */
/* eslint-enable no-unused-vars */
