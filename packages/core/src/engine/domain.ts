import { CQRSInfrastructure, Infrastructure } from "../infrastructure";
import { Aggregate, Projection, Saga } from "../ddd";
import {
  AggregateCommand,
  Command,
  Query,
  QueryHandler,
  StandaloneCommandHandler,
} from "../cqrs";
import { Event } from "../edd";

type AggregateMap = Record<string | symbol, Aggregate<any>>;

type ProjectionMap = Record<string | symbol, Projection<any>>;

type SagaMap = Record<string | symbol, Saga<any, any>>;

/**
 * Persistence strategy that stores the current aggregate state directly.
 * On load, the latest snapshot is returned. On save, the full state is overwritten.
 *
 * Simpler than event sourcing but does not preserve event history.
 *
 * @see {@link EventSourcedAggregatePersistence} for the event-sourcing alternative.
 * @see {@link InMemoryStateStoredAggregatePersistence} for the built-in in-memory implementation.
 */
export interface StateStoredAggregatePersistence {
  /**
   * Persists the current state snapshot for an aggregate instance.
   *
   * @param aggregateName - The aggregate type name (used as a namespace).
   * @param aggregateId - The unique identifier of the aggregate instance.
   * @param state - The full aggregate state to persist.
   */
  save(aggregateName: string, aggregateId: string, state: any): Promise<void>;

  /**
   * Loads the latest state snapshot for an aggregate instance.
   * Returns `undefined` or `null` if the aggregate does not exist.
   *
   * @param aggregateName - The aggregate type name (used as a namespace).
   * @param aggregateId - The unique identifier of the aggregate instance.
   */
  load(aggregateName: string, aggregateId: string): Promise<any>;
}

/**
 * Persistence strategy that stores domain events as the source of truth.
 * On load, the full event stream for an aggregate is returned. On save,
 * new events are appended to the stream.
 *
 * @see {@link StateStoredAggregatePersistence} for the state-snapshot alternative.
 * @see {@link InMemoryEventSourcedAggregatePersistence} for the built-in in-memory implementation.
 */
export interface EventSourcedAggregatePersistence {
  /**
   * Appends new events to the event stream of an aggregate instance.
   *
   * @param aggregateName - The aggregate type name (used as a namespace).
   * @param aggregateId - The unique identifier of the aggregate instance.
   * @param events - The new events to append.
   */
  save(
    aggregateName: string,
    aggregateId: string,
    events: Event[],
  ): Promise<void>;

  /**
   * Loads the full event stream for an aggregate instance.
   * Returns an empty array if the aggregate does not exist.
   *
   * @param aggregateName - The aggregate type name (used as a namespace).
   * @param aggregateId - The unique identifier of the aggregate instance.
   */
  load(aggregateName: string, aggregateId: string): Promise<Event[]>;
}

type PersistenceConfiguration =
  | StateStoredAggregatePersistence
  | EventSourcedAggregatePersistence;

/**
 * Persistence strategy for saga instance state. Each saga instance is
 * identified by a (sagaName, sagaId) pair, analogous to aggregate
 * persistence.
 *
 * Sagas use state-stored persistence (not event-sourced) because they
 * track workflow progress, not domain truth.
 *
 * @see {@link InMemorySagaPersistence} for the built-in in-memory implementation.
 */
export interface SagaPersistence {
  /**
   * Persists the current state of a saga instance.
   *
   * @param sagaName - The saga type name (used as a namespace).
   * @param sagaId - The unique identifier of the saga instance.
   * @param state - The full saga state to persist.
   */
  save(sagaName: string, sagaId: string, state: any): Promise<void>;

  /**
   * Loads the current state of a saga instance.
   * Returns `undefined` or `null` if no saga instance exists.
   *
   * @param sagaName - The saga type name (used as a namespace).
   * @param sagaId - The unique identifier of the saga instance.
   */
  load(sagaName: string, sagaId: string): Promise<any | undefined | null>;
}

type StandaloneCommandHandlerMap<
  TInfrastructure extends Infrastructure,
  TStandaloneCommand extends Command,
> = {
  [CommandName in TStandaloneCommand["name"]]?: StandaloneCommandHandler<
    TInfrastructure,
    Extract<TStandaloneCommand, { name: CommandName }>
  >;
};

type StandaloneQueryHandlerMap<
  TInfrastructure extends Infrastructure,
  TStandaloneQuery extends Query<any>,
> = {
  [QueryName in TStandaloneQuery["name"]]?: QueryHandler<
    TInfrastructure,
    Extract<
      TStandaloneQuery,
      {
        name: QueryName;
      }
    >
  >;
};

/**
 * The full configuration object for a domain, wiring together the write model
 * (aggregates + standalone command handlers), the read model (projections +
 * standalone query handlers), and infrastructure factories.
 *
 * Pass this to {@link configureDomain} to create a running {@link Domain} instance.
 *
 * @typeParam TInfrastructure - The custom infrastructure type for this domain.
 * @typeParam TStandaloneCommand - Union of standalone command types (inferred).
 * @typeParam TStandaloneQuery - Union of standalone query types (inferred).
 */
export type DomainConfiguration<
  TInfrastructure extends Infrastructure,
  TStandaloneCommand extends Command = Command,
  TStandaloneQuery extends Query<any> = Query<any>,
> = {
  /** The write side: aggregates and standalone command handlers. */
  writeModel: {
    /** A map of aggregate definitions keyed by aggregate name. */
    aggregates: AggregateMap;
    /** Optional map of standalone command handlers keyed by command name. */
    standaloneCommandHandlers?: StandaloneCommandHandlerMap<
      TInfrastructure,
      TStandaloneCommand
    >;
  };
  /** The read side: projections and standalone query handlers. */
  readModel: {
    /** A map of projection definitions keyed by projection name. */
    projections: ProjectionMap;
    /** Optional map of standalone query handlers keyed by query name. */
    standaloneQueryHandlers?: StandaloneQueryHandlerMap<
      TInfrastructure,
      TStandaloneQuery
    >;
  };
  /**
   * Process managers (sagas) that orchestrate workflows across aggregates
   * by reacting to events and dispatching commands. Optional — omit if
   * the domain has no cross-aggregate workflows.
   */
  processModel?: {
    /** A map of saga definitions keyed by saga name. */
    sagas: SagaMap;
  };
  /** Factory functions for providing infrastructure at startup. */
  infrastructure: {
    /**
     * Factory for the aggregate persistence strategy.
     * Return either a {@link StateStoredAggregatePersistence} or
     * {@link EventSourcedAggregatePersistence}.
     */
    aggregatePersistence?: () =>
      | PersistenceConfiguration
      | Promise<PersistenceConfiguration>;
    /**
     * Factory for saga persistence. Required if `processModel` is configured.
     *
     * @see {@link InMemorySagaPersistence} for the built-in in-memory implementation.
     */
    sagaPersistence?: () => SagaPersistence | Promise<SagaPersistence>;
    /**
     * Factory for custom infrastructure dependencies (repositories,
     * clocks, API clients, etc.).
     */
    provideInfrastructure?: () => Promise<TInfrastructure> | TInfrastructure;
    /**
     * Factory for CQRS buses. Receives the custom infrastructure so that
     * bus implementations can depend on it if needed.
     */
    cqrsInfrastructure?: (
      infrastructure: TInfrastructure,
    ) => CQRSInfrastructure | Promise<CQRSInfrastructure>;
  };
};

/**
 * The running domain instance. Created via {@link configureDomain}, it is the
 * primary entry point for dispatching commands and accessing infrastructure.
 *
 * @typeParam TInfrastructure - The custom infrastructure type for this domain.
 * @typeParam TStandaloneCommand - Union of standalone command types.
 * @typeParam TStandaloneQuery - Union of standalone query types.
 */
export class Domain<
  TInfrastructure extends Infrastructure,
  TStandaloneCommand extends Command = Command,
  TStandaloneQuery extends Query<any> = Query<any>,
> {
  private _infrastructure!: TInfrastructure & CQRSInfrastructure;
  private _persistence!: PersistenceConfiguration;

  /** The fully resolved infrastructure (custom + CQRS buses). */
  public get infrastructure(): TInfrastructure & CQRSInfrastructure {
    return this._infrastructure;
  }

  constructor(
    private readonly configuration: DomainConfiguration<
      TInfrastructure,
      TStandaloneCommand,
      TStandaloneQuery
    >,
  ) {}

  /**
   * Initializes the domain by calling all infrastructure factories
   * in order: custom infrastructure, CQRS buses, persistence.
   */
  public async init(): Promise<void> {
    throw new Error("Not implemented");
  }

  /**
   * Dispatches a command to the appropriate aggregate. The full lifecycle:
   * route by name, load state, execute handler, apply events, persist, publish.
   *
   * @typeParam TCommand - The specific command type being dispatched.
   * @param command - The command to dispatch (must include `targetAggregateId`).
   * @returns The aggregate ID that handled the command.
   */
  public async dispatchCommand<TCommand extends AggregateCommand<any>>(
    command: TCommand,
  ): Promise<TCommand["targetAggregateId"]> {
    throw new Error("Not implemented");
  }
}

/**
 * Creates and initializes a {@link Domain} instance from a configuration.
 * This is the main entry point for bootstrapping a noddde application.
 *
 * @typeParam TInfrastructure - The custom infrastructure type.
 * @typeParam TStandaloneCommand - Union of standalone command types (inferred).
 * @typeParam TStandaloneQuery - Union of standalone query types (inferred).
 * @param configuration - The full domain configuration.
 * @returns A fully initialized {@link Domain} instance.
 *
 * @example
 * ```ts
 * const domain = await configureDomain<MyInfrastructure>({
 *   writeModel: { aggregates: { BankAccount } },
 *   readModel: { projections: { BankAccountProjection } },
 *   infrastructure: {
 *     provideInfrastructure: () => ({ clock: new SystemClock() }),
 *     cqrsInfrastructure: () => ({
 *       commandBus: new InMemoryCommandBus(),
 *       eventBus: new EventEmitterEventBus(),
 *       queryBus: new InMemoryQueryBus(),
 *     }),
 *   },
 * });
 * ```
 */
export const configureDomain = async <
  TInfrastructure extends Infrastructure,
  TStandaloneCommand extends Command = Command,
  TStandaloneQuery extends Query<any> = Query<any>,
>(
  configuration: DomainConfiguration<
    TInfrastructure,
    TStandaloneCommand,
    TStandaloneQuery
  >,
): Promise<Domain<TInfrastructure, TStandaloneCommand, TStandaloneQuery>> => {
  const domain = new Domain(configuration);
  await domain.init();
  return domain;
};
