/* eslint-disable no-unused-vars */
import { AsyncLocalStorage } from "node:async_hooks";
import type {
  Aggregate,
  AggregateCommand,
  Command,
  CQRSInfrastructure,
  Event,
  EventBus,
  EventSourcedAggregatePersistence,
  Infrastructure,
  PersistenceConfiguration,
  Projection,
  Query,
  QueryHandler,
  QueryResult,
  Saga,
  SagaPersistence,
  StandaloneCommandHandler,
  StateStoredAggregatePersistence,
  UnitOfWork,
  UnitOfWorkFactory,
} from "@noddde/core";
import type { AggregateLocker } from "@noddde/core";
import { InMemoryCommandBus } from "./implementations/in-memory-command-bus";
import { EventEmitterEventBus } from "./implementations/ee-event-bus";
import { InMemoryQueryBus } from "./implementations/in-memory-query-bus";
import { InMemoryEventSourcedAggregatePersistence } from "./implementations/in-memory-aggregate-persistence";
import { InMemorySagaPersistence } from "./implementations/in-memory-saga-persistence";
import { createInMemoryUnitOfWork } from "./implementations/in-memory-unit-of-work";
import type { ConcurrencyStrategy } from "./concurrency-strategy";
import {
  OptimisticConcurrencyStrategy,
  PessimisticConcurrencyStrategy,
} from "./concurrency-strategy";

type AggregateMap = Record<string | symbol, Aggregate<any>>;

type ProjectionMap = Record<string | symbol, Projection<any>>;

type SagaMap = Record<string | symbol, Saga<any, any>>;

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
     * Concurrency control strategy for aggregate persistence.
     *
     * When **omitted** (the default), no concurrency control is applied.
     * The version check on `save()` still catches conflicts at the
     * database level (throwing `ConcurrencyError`), but there is no
     * retry logic and no locking — the error propagates directly to
     * the caller. This is appropriate for low-contention scenarios
     * and works with every database dialect.
     *
     * - **Optimistic**: same as the default, but with automatic retries.
     *   On `ConcurrencyError`, the full load→execute→save cycle is
     *   retried up to `maxRetries` times. Works with every dialect.
     *
     * - **Pessimistic**: acquire an exclusive advisory lock before loading
     *   the aggregate, preventing concurrent access entirely. Requires
     *   a database that supports advisory locks (PostgreSQL, MySQL/MariaDB,
     *   or MSSQL via TypeORM). SQLite is not supported — use
     *   `InMemoryAggregateLocker` for single-process deployments.
     *
     * @default undefined (no concurrency control — conflicts throw `ConcurrencyError`)
     *
     * @example
     * ```ts
     * // No concurrency control (default) — omit aggregateConcurrency entirely
     *
     * // Optimistic with 3 retries
     * aggregateConcurrency: { maxRetries: 3 }
     *
     * // Pessimistic with in-memory locker
     * aggregateConcurrency: {
     *   strategy: "pessimistic",
     *   locker: new InMemoryAggregateLocker(),
     *   lockTimeoutMs: 5000,
     * }
     * ```
     */
    aggregateConcurrency?:
      | { strategy?: "optimistic"; maxRetries?: number }
      | {
          strategy: "pessimistic";
          locker: AggregateLocker;
          lockTimeoutMs?: number;
        };
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
    /**
     * Factory for the {@link UnitOfWorkFactory}. Called once during
     * {@link Domain.init}. The returned factory is called once per
     * unit of work boundary.
     *
     * If not provided, defaults to {@link createInMemoryUnitOfWork}.
     */
    unitOfWorkFactory?: () => UnitOfWorkFactory | Promise<UnitOfWorkFactory>;
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
  private _sagaPersistence?: SagaPersistence;
  private _unitOfWorkFactory!: UnitOfWorkFactory;
  private _concurrencyStrategy!: ConcurrencyStrategy;
  private readonly _uowStorage = new AsyncLocalStorage<UnitOfWork>();
  private readonly _projectionViews = new Map<string, any>();

  /** The fully resolved infrastructure (custom + CQRS buses). */
  public get infrastructure(): TInfrastructure & CQRSInfrastructure {
    return this._infrastructure;
  }

  /**
   * Returns the current in-memory view for a named projection.
   * Useful for testing and debugging. Returns `undefined` if no events
   * have been processed by the projection yet.
   *
   * @param projectionName - The key under which the projection was registered
   *   in `readModel.projections`.
   * @returns The current view state, or `undefined` if no events were processed.
   */
  public getProjectionView<TView = any>(
    projectionName: string,
  ): TView | undefined {
    return this._projectionViews.get(projectionName);
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
   * Then registers command handlers, query handlers, projection
   * event listeners, and saga event listeners.
   */
  public async init(): Promise<void> {
    const { configuration } = this;

    // Step 1: Resolve custom infrastructure
    const customInfra = configuration.infrastructure.provideInfrastructure
      ? await configuration.infrastructure.provideInfrastructure()
      : ({} as TInfrastructure);

    // Step 2: Resolve CQRS infrastructure
    const cqrsInfra = configuration.infrastructure.cqrsInfrastructure
      ? await configuration.infrastructure.cqrsInfrastructure(customInfra)
      : {
          commandBus: new InMemoryCommandBus(),
          eventBus: new EventEmitterEventBus(),
          queryBus: new InMemoryQueryBus(),
        };

    // Step 3: Merge infrastructure
    this._infrastructure = {
      ...customInfra,
      ...cqrsInfra,
    } as TInfrastructure & CQRSInfrastructure;

    // Step 4: Resolve aggregate persistence
    this._persistence = configuration.infrastructure.aggregatePersistence
      ? await configuration.infrastructure.aggregatePersistence()
      : new InMemoryEventSourcedAggregatePersistence();

    // Step 5: Resolve saga persistence (only when processModel is configured)
    if (configuration.processModel) {
      if (configuration.infrastructure.sagaPersistence) {
        this._sagaPersistence =
          await configuration.infrastructure.sagaPersistence();
      } else {
        this._sagaPersistence = new InMemorySagaPersistence();
      }
    }

    // Step 5.5: Resolve UnitOfWork factory
    this._unitOfWorkFactory = configuration.infrastructure.unitOfWorkFactory
      ? await configuration.infrastructure.unitOfWorkFactory()
      : createInMemoryUnitOfWork;

    // Step 5.6: Resolve concurrency strategy
    const concurrency = configuration.infrastructure.aggregateConcurrency;
    if (
      concurrency &&
      "strategy" in concurrency &&
      concurrency.strategy === "pessimistic"
    ) {
      this._concurrencyStrategy = new PessimisticConcurrencyStrategy(
        concurrency.locker,
        concurrency.lockTimeoutMs,
      );
    } else {
      this._concurrencyStrategy = new OptimisticConcurrencyStrategy(
        (concurrency as { maxRetries?: number } | undefined)?.maxRetries ?? 0,
      );
    }

    const { commandBus, eventBus, queryBus } = this._infrastructure;

    // Step 6: Register aggregate command handlers on the command bus
    for (const [aggregateName, aggregate] of Object.entries(
      configuration.writeModel.aggregates,
    )) {
      for (const commandName of Object.keys(aggregate.commands)) {
        (commandBus as InMemoryCommandBus).register(
          commandName,
          async (command: Command) => {
            await this.executeAggregateCommand(
              aggregateName,
              aggregate,
              command as AggregateCommand,
            );
          },
        );
      }
    }

    // Step 7: Register standalone command handlers
    if (configuration.writeModel.standaloneCommandHandlers) {
      for (const [commandName, handler] of Object.entries(
        configuration.writeModel.standaloneCommandHandlers,
      )) {
        if (handler) {
          (commandBus as InMemoryCommandBus).register(
            commandName,
            async (command: Command) => {
              await (handler as any)(command, this._infrastructure);
            },
          );
        }
      }
    }

    // Step 8: Register projection query handlers on the query bus
    for (const [_projectionName, projection] of Object.entries(
      configuration.readModel.projections,
    )) {
      if (projection.queryHandlers) {
        for (const [queryName, handler] of Object.entries(
          projection.queryHandlers,
        )) {
          if (handler) {
            (queryBus as InMemoryQueryBus).register(
              queryName,
              async (payload: any) => {
                return await (handler as any)(payload, this._infrastructure);
              },
            );
          }
        }
      }
    }

    // Step 9: Register standalone query handlers
    if (configuration.readModel.standaloneQueryHandlers) {
      for (const [queryName, handler] of Object.entries(
        configuration.readModel.standaloneQueryHandlers,
      )) {
        if (handler) {
          (queryBus as InMemoryQueryBus).register(
            queryName,
            async (payload: any) => {
              return await (handler as any)(payload, this._infrastructure);
            },
          );
        }
      }
    }

    // Step 10: Register event listeners for projections
    for (const [projectionName, projection] of Object.entries(
      configuration.readModel.projections,
    )) {
      for (const eventName of Object.keys(projection.reducers)) {
        this.subscribeToEvent(eventBus, eventName, async (payload: any) => {
          const event: Event = { name: eventName, payload };
          const currentView = this._projectionViews.get(projectionName);
          const newView = await (projection.reducers as any)[eventName](
            event,
            currentView,
          );
          this._projectionViews.set(projectionName, newView);
        });
      }
    }

    // Step 11: Register event listeners for sagas
    if (configuration.processModel) {
      for (const [sagaName, saga] of Object.entries(
        configuration.processModel.sagas,
      )) {
        for (const eventName of Object.keys(saga.handlers)) {
          this.subscribeToEvent(eventBus, eventName, async (payload: any) => {
            await this.executeSagaHandler(sagaName, saga, {
              name: eventName,
              payload,
            });
          });
        }
      }
    }
  }

  /**
   * Subscribes to an event on the event bus. Uses the {@link EventEmitterEventBus}
   * `on` method to register an async-capable handler.
   */
  private subscribeToEvent(
    eventBus: EventBus,
    eventName: string,
    handler: (payload: any) => void | Promise<void>,
  ): void {
    // The EventBus interface only exposes dispatch (publish),
    // so we use a type assertion to reach the on() method.
    (eventBus as EventEmitterEventBus).on(eventName, handler);
  }

  /**
   * Executes the full saga event handling lifecycle:
   * derive ID, load state, bootstrap or resume, execute handler,
   * persist state, dispatch commands.
   *
   * Creates its own UoW that spans the saga state persistence and
   * all commands dispatched by the saga reaction, ensuring atomicity.
   */
  private async executeSagaHandler(
    sagaName: string,
    saga: Saga<any, any>,
    event: Event,
  ): Promise<void> {
    if (!this._sagaPersistence) {
      return;
    }

    // Step 1: Derive saga instance ID
    const associationFn = saga.associations[event.name];
    if (!associationFn) {
      return;
    }
    const sagaId = associationFn(event);

    // Step 2: Load saga state
    let currentState = await this._sagaPersistence.load(sagaName, sagaId);

    // Step 3: Bootstrap or resume
    if (currentState == null) {
      if ((saga.startedBy as string[]).includes(event.name)) {
        currentState = saga.initialState;
      } else {
        // Saga not started yet, ignore this event
        return;
      }
    }

    // Step 4: Execute handler
    const sagaHandler = saga.handlers[event.name];
    if (!sagaHandler) {
      return;
    }
    const reaction = await sagaHandler(
      event,
      currentState,
      this._infrastructure,
    );

    // Step 5: Create UoW for saga reaction (spans state + commands)
    const uow = this._unitOfWorkFactory();
    const sagaPersistence = this._sagaPersistence;

    await this._uowStorage.run(uow, async () => {
      try {
        // Enlist saga state persistence
        uow.enlist(() =>
          sagaPersistence.save(sagaName, sagaId, reaction.state),
        );

        // Step 6: Dispatch commands (within the saga's UoW)
        if (reaction.commands) {
          const commands = Array.isArray(reaction.commands)
            ? reaction.commands
            : [reaction.commands];
          for (const command of commands) {
            await this._infrastructure.commandBus.dispatch(command);
          }
        }

        // Step 7: Commit saga state + all aggregate changes atomically
        const events = await uow.commit();

        // Step 8: Publish all deferred events
        for (const deferredEvent of events) {
          await this._infrastructure.eventBus.dispatch(deferredEvent);
        }
      } catch (error) {
        try {
          await uow.rollback();
        } catch {
          // UoW may already be completed if commit failed
        }
        throw error;
      }
    });
  }

  /**
   * Executes the full aggregate command lifecycle:
   * load, execute, apply, persist, publish.
   *
   * Delegates concurrency control to {@link ConcurrencyStrategy}:
   * - **Optimistic**: retries the attempt on {@link ConcurrencyError}
   * - **Pessimistic**: acquires a lock before the attempt, releases after
   *
   * If a UnitOfWork is active (via {@link withUnitOfWork} or saga handling),
   * persistence and event publishing are deferred to the owning UoW.
   * Otherwise, an implicit UoW is created and committed immediately.
   */
  private async executeAggregateCommand(
    aggregateName: string,
    aggregate: Aggregate<any>,
    command: AggregateCommand,
  ): Promise<void> {
    const persistence = this._persistence;
    const eventBus = this._infrastructure.eventBus;

    const existingUow = this._uowStorage.getStore();
    const ownsUow = !existingUow;

    const runLifecycle = (uow: UnitOfWork) =>
      this.executeCommandLifecycle(
        aggregateName,
        aggregate,
        command,
        persistence,
        uow,
      );

    if (ownsUow) {
      // Implicit UoW — strategy wraps the full attempt (UoW create + commit)
      const events = await this._concurrencyStrategy.execute(
        aggregateName,
        command.targetAggregateId,
        async () => {
          const uow = this._unitOfWorkFactory();
          try {
            await runLifecycle(uow);
            return await uow.commit();
          } catch (error) {
            try {
              await uow.rollback();
            } catch {
              // UoW may already be completed if commit failed partway through
            }
            throw error;
          }
        },
      );
      for (const event of events) {
        await eventBus.dispatch(event);
      }
    } else {
      // Explicit UoW — strategy wraps just the lifecycle (for pessimistic locking)
      await this._concurrencyStrategy.execute(
        aggregateName,
        command.targetAggregateId,
        async () => {
          await runLifecycle(existingUow!);
          return [];
        },
      );
    }
  }

  /**
   * The core load→execute→apply→enlist→defer cycle, extracted to support
   * retry in the implicit UoW path.
   */
  private async executeCommandLifecycle(
    aggregateName: string,
    aggregate: Aggregate<any>,
    command: AggregateCommand,
    persistence: PersistenceConfiguration,
    uow: UnitOfWork,
  ): Promise<void> {
    // Step 1: Load
    const loaded = await persistence.load(
      aggregateName,
      command.targetAggregateId,
    );

    let currentState: any;
    let version: number;
    const isEventSourced = Array.isArray(loaded);

    if (isEventSourced) {
      // Event-sourced: replay events to rebuild state; version = stream length
      const events = loaded as Event[];
      version = events.length;
      currentState = events.reduce((state: any, event: Event) => {
        const applyHandler = aggregate.apply[event.name];
        return applyHandler ? applyHandler(event.payload, state) : state;
      }, aggregate.initialState);
    } else {
      // State-stored: load returns { state, version } | null
      const stateResult = loaded as {
        state: any;
        version: number;
      } | null;
      version = stateResult?.version ?? 0;
      currentState = stateResult?.state ?? aggregate.initialState;
    }

    // Step 2: Execute command handler
    const handler = aggregate.commands[command.name];
    if (!handler) {
      throw new Error(
        `No command handler found for command: ${command.name} on aggregate: ${aggregateName}`,
      );
    }
    const result = await handler(command, currentState, this._infrastructure);

    // Step 3: Normalize to array
    const newEvents: Event[] = Array.isArray(result) ? result : [result];

    // Step 4: Apply events to get new state
    let newState = currentState;
    for (const event of newEvents) {
      const applyHandler = aggregate.apply[event.name];
      if (applyHandler) {
        newState = applyHandler(event.payload, newState);
      }
    }

    // Step 5: Enlist persistence in UoW with version (deferred until commit)
    if (isEventSourced) {
      uow.enlist(() =>
        (persistence as EventSourcedAggregatePersistence).save(
          aggregateName,
          command.targetAggregateId,
          newEvents,
          version,
        ),
      );
    } else {
      uow.enlist(() =>
        (persistence as StateStoredAggregatePersistence).save(
          aggregateName,
          command.targetAggregateId,
          newState,
          version,
        ),
      );
    }

    // Step 6: Defer event publishing (published after commit)
    uow.deferPublish(...newEvents);
  }

  /**
   * Executes a function within an explicit unit of work boundary.
   * All commands dispatched inside `fn` share a single {@link UnitOfWork}.
   * Persistence is deferred until the function completes, then committed
   * atomically. Events are published only after successful commit.
   *
   * Nested units of work are not supported — calling `withUnitOfWork()`
   * inside an active unit of work throws an error.
   *
   * @typeParam T - The return type of the scoped function.
   * @param fn - The function to execute within the unit of work.
   * @returns The return value of `fn`.
   *
   * @example
   * ```ts
   * await domain.withUnitOfWork(async () => {
   *   await domain.dispatchCommand(createOrder);
   *   await domain.dispatchCommand(requestPayment);
   *   // Both persist atomically, events published together after commit
   * });
   * ```
   */
  public async withUnitOfWork<T>(fn: () => Promise<T>): Promise<T> {
    if (this._uowStorage.getStore()) {
      throw new Error("Nested units of work are not supported");
    }

    const uow = this._unitOfWorkFactory();

    return this._uowStorage.run(uow, async () => {
      try {
        const result = await fn();
        const events = await uow.commit();
        for (const event of events) {
          await this._infrastructure.eventBus.dispatch(event);
        }
        return result;
      } catch (error) {
        try {
          await uow.rollback();
        } catch {
          // UoW may already be completed if commit failed
        }
        throw error;
      }
    });
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
    // Route: find the aggregate that handles this command
    for (const [aggregateName, aggregate] of Object.entries(
      this.configuration.writeModel.aggregates,
    )) {
      if (command.name in aggregate.commands) {
        await this.executeAggregateCommand(aggregateName, aggregate, command);
        return command.targetAggregateId;
      }
    }

    // If no aggregate handles it, try the command bus (standalone handlers)
    await this._infrastructure.commandBus.dispatch(command);
    return command.targetAggregateId;
  }

  /**
   * Dispatches a query to the registered query handler via the query bus.
   * Returns the typed result from the handler.
   *
   * @typeParam TQuery - The specific query type being dispatched.
   * @param query - The query to dispatch (must include `name` and optional `payload`).
   * @returns The typed result from the query handler.
   */
  public async dispatchQuery<TQuery extends Query<any>>(
    query: TQuery,
  ): Promise<QueryResult<TQuery>> {
    return this._infrastructure.queryBus.dispatch(query);
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
