/* eslint-disable no-unused-vars */
import { AsyncLocalStorage } from "node:async_hooks";
import type {
  Aggregate,
  AggregateCommand,
  Command,
  CQRSInfrastructure,
  Event,
  EventBus,
  EventHandler,
  FrameworkInfrastructure,
  ID,
  Infrastructure,
  InferAggregateMapCommands,
  InferAggregateMapInfrastructure,
  InferProjectionMapInfrastructure,
  InferProjectionMapQueries,
  InferSagaMapInfrastructure,
  Logger,
  PersistenceConfiguration,
  PersistenceAdapter,
  Projection,
  Query,
  QueryHandler,
  QueryResult,
  Saga,
  SagaPersistence,
  SnapshotStore,
  SnapshotStrategy,
  StandaloneCommandHandler,
  UnitOfWork,
  UnitOfWorkFactory,
  IdempotencyStore,
  ViewStore,
  OutboxStore,
  OutboxEntry,
} from "@noddde/core";
import type { AggregateLocker, Closeable } from "@noddde/core";
import { isCloseable } from "@noddde/core";
import { OutboxRelay } from "./outbox-relay";
import type { OutboxRelayOptions } from "./outbox-relay";
import { uuidv7 } from "./uuid";
import { detectOTel, Instrumentation } from "./tracing";

/**
 * Error thrown when a command or query is dispatched after
 * {@link Domain.shutdown} has been called.
 */
export class DomainShutdownError extends Error {
  override readonly name = "DomainShutdownError" as const;
  constructor() {
    super("Domain is shutting down and no longer accepts commands or queries");
  }
}

/**
 * Configuration options for {@link Domain.shutdown}.
 */
export interface ShutdownOptions {
  /**
   * Maximum time in milliseconds to wait for in-flight operations
   * and background processes to complete. After this timeout,
   * shutdown proceeds to resource cleanup regardless.
   *
   * @default 30_000 (30 seconds)
   */
  timeoutMs?: number;
}

/**
 * Context for metadata propagation. Values from `withMetadataContext`
 * override values from the configured `metadataProvider`.
 */
export interface MetadataContext {
  correlationId?: string;
  causationId?: string;
  userId?: ID;
}

/**
 * Optional function that provides metadata context for every command dispatch.
 * Called on each command execution.
 */
export type MetadataProvider = () => MetadataContext;
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
  PerAggregateConcurrencyStrategy,
} from "./concurrency-strategy";
import { MetadataEnricher } from "./executors/metadata-enricher";
import { CommandLifecycleExecutor } from "./executors/command-lifecycle-executor";
import { SagaExecutor } from "./executors/saga-executor";
import { NodddeLogger } from "./logger";
import {
  GlobalAggregatePersistenceResolver,
  PerAggregatePersistenceResolver,
} from "./aggregate-persistence-resolver";
import type { AggregatePersistenceResolver } from "./aggregate-persistence-resolver";

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
 * Maps event names to standalone event handlers. Each handler receives the
 * full event and infrastructure. Follows the same pattern as
 * StandaloneCommandHandlerMap and StandaloneQueryHandlerMap.
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
 * Factory function returning a persistence configuration, either synchronously
 * or as a promise.
 */
type PersistenceFactory = () =>
  | PersistenceConfiguration
  | Promise<PersistenceConfiguration>;

// ---- New API: defineDomain + wireDomain ----

/**
 * Shorthand string for persistence strategy. Resolved from the adapter.
 * - `'event-sourced'` → adapter.eventSourcedPersistence
 * - `'state-stored'` → adapter.stateStoredPersistence
 */
type PersistenceShorthand = "event-sourced" | "state-stored";

/**
 * Resolves a persistence value from the various forms it can take:
 * - string shorthand → resolved from adapter
 * - function → factory, called to get config
 * - object with save/load → PersistenceConfiguration, used directly
 * - undefined → default from adapter (stateStoredPersistence)
 * @internal
 */
async function resolveAggregatePersistence(
  aggregateName: string,
  persistence:
    | PersistenceFactory
    | PersistenceShorthand
    | PersistenceConfiguration
    | undefined,
  adapter: PersistenceAdapter | undefined,
): Promise<PersistenceConfiguration | undefined> {
  if (persistence === undefined) {
    // Default: use adapter's stateStoredPersistence if available
    if (adapter?.stateStoredPersistence) {
      return adapter.stateStoredPersistence;
    }
    // No adapter or adapter doesn't provide stateStoredPersistence — return undefined for in-memory fallback
    return undefined;
  }

  if (typeof persistence === "string") {
    // Shorthand — requires adapter
    if (!adapter) {
      throw new Error(
        `Aggregate "${aggregateName}": persistence shorthand '${persistence}' requires a persistenceAdapter in DomainWiring.`,
      );
    }
    if (persistence === "event-sourced") {
      if (!adapter.eventSourcedPersistence) {
        throw new Error(
          `Aggregate "${aggregateName}": persistence '${persistence}' requested but the adapter does not provide eventSourcedPersistence.`,
        );
      }
      return adapter.eventSourcedPersistence;
    }
    if (persistence === "state-stored") {
      if (!adapter.stateStoredPersistence) {
        throw new Error(
          `Aggregate "${aggregateName}": persistence '${persistence}' requested but the adapter does not provide stateStoredPersistence.`,
        );
      }
      return adapter.stateStoredPersistence;
    }
    throw new Error(
      `Aggregate "${aggregateName}": unknown persistence shorthand '${persistence}'.`,
    );
  }

  if (typeof persistence === "function") {
    // Factory function — call it
    return await persistence();
  }

  // Object — PersistenceConfiguration, used directly
  return persistence;
}

/**
 * Per-aggregate runtime configuration. Groups persistence, concurrency,
 * and snapshot settings.
 *
 * When a `persistenceAdapter` is provided in `DomainWiring`:
 * - `persistence` defaults to `adapter.stateStoredPersistence` if omitted
 * - `persistence` accepts string shorthands (`'event-sourced'`, `'state-stored'`)
 * - `persistence` accepts a `PersistenceConfiguration` object directly (e.g., from `adapter.stateStored(table)`)
 * - `concurrency` accepts string shorthands (`'pessimistic'`, `'optimistic'`)
 * - `snapshots.store` is inferred from `adapter.snapshotStore` when omitted
 */
export type AggregateWiring = {
  /**
   * Persistence for this aggregate. Accepts:
   * - A factory function: `() => PersistenceConfiguration`
   * - A shorthand string: `'event-sourced'` | `'state-stored'` (resolved from adapter)
   * - A `PersistenceConfiguration` object directly (e.g., from `adapter.stateStored(table)`)
   * - Omitted: defaults to `adapter.stateStoredPersistence` (when adapter present) or in-memory
   */
  persistence?:
    | PersistenceFactory
    | PersistenceShorthand
    | PersistenceConfiguration;
  /**
   * Concurrency control for this aggregate. Accepts:
   * - `'optimistic'`: default retries (0), same as omitting
   * - `'pessimistic'`: auto-resolves locker from adapter
   * - Object form for customization
   */
  concurrency?:
    | "pessimistic"
    | "optimistic"
    | { strategy?: "optimistic"; maxRetries?: number }
    | {
        strategy: "pessimistic";
        locker?: AggregateLocker;
        lockTimeoutMs?: number;
      };
  /**
   * Snapshot configuration for this aggregate (event-sourced only).
   * When `store` is omitted, it is inferred from `adapter.snapshotStore`.
   */
  snapshots?: {
    store?: () => SnapshotStore | Promise<SnapshotStore>;
    strategy: SnapshotStrategy;
  };
};

/**
 * Per-projection runtime configuration. Provides the view store factory
 * for a projection, extracted from the projection definition.
 */
export type ProjectionWiring<
  TInfrastructure extends Infrastructure = Infrastructure,
> = {
  /** Factory that resolves the view store. */
  viewStore: (infrastructure: TInfrastructure) => ViewStore;
};

/**
 * Pure structural definition of a domain. Contains aggregates, projections,
 * sagas, and handler registrations — no runtime or infrastructure concerns.
 *
 * Created via {@link defineDomain}. Pass to {@link wireDomain} along with
 * infrastructure wiring to create a running {@link Domain}.
 */
export type DomainDefinition<
  TInfrastructure extends Infrastructure = Infrastructure,
  TStandaloneCommand extends Command = Command,
  TStandaloneQuery extends Query<any> = Query<any>,
  TAggregates extends AggregateMap = AggregateMap,
  TStandaloneEvent extends Event = Event,
  TProjections extends ProjectionMap = ProjectionMap,
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
    sagas?: SagaMap;
    /** Optional map of standalone event handlers keyed by event name. */
    standaloneEventHandlers?: StandaloneEventHandlerMap<
      TInfrastructure,
      TStandaloneEvent
    >;
  };
};

/**
 * Runtime infrastructure wiring for a domain. Connects a {@link DomainDefinition}
 * to persistence, buses, concurrency, snapshots, and user-provided services.
 *
 * Pass to {@link wireDomain} along with a definition to create a running {@link Domain}.
 */
export type DomainWiring<
  TInfrastructure extends Infrastructure = Infrastructure,
  TAggregates extends AggregateMap = AggregateMap,
> = {
  /**
   * Persistence adapter providing default stores for the domain.
   * When provided, the engine resolves aggregate persistence, saga persistence,
   * unit-of-work, snapshots, outbox, idempotency, and locking from the adapter
   * when not explicitly wired. Explicit wiring always overrides adapter defaults.
   */
  persistenceAdapter?: PersistenceAdapter;
  /**
   * Factory for user-provided infrastructure services.
   * Receives the framework logger so custom services can use it.
   */
  infrastructure?: (
    logger: Logger,
  ) => TInfrastructure | Promise<TInfrastructure>;
  /** Aggregate runtime config — global {@link AggregateWiring} OR per-aggregate record. */
  aggregates?:
    | AggregateWiring
    | Record<keyof TAggregates & string, AggregateWiring>;
  /** Projection runtime config — per-projection view store wiring. */
  projections?: Record<string, ProjectionWiring<TInfrastructure>>;
  /** Saga runtime config. Required if processModel has sagas. */
  sagas?: {
    persistence?: () => SagaPersistence | Promise<SagaPersistence>;
  };
  /** Factory for CQRS buses. Receives resolved user infrastructure. */
  buses?: (
    infrastructure: TInfrastructure,
  ) => CQRSInfrastructure | Promise<CQRSInfrastructure>;
  /** Factory for the UnitOfWorkFactory. */
  unitOfWork?: () => UnitOfWorkFactory | Promise<UnitOfWorkFactory>;
  /** Factory for idempotency store. */
  idempotency?: () => IdempotencyStore | Promise<IdempotencyStore>;
  /** Transactional outbox configuration. */
  outbox?: {
    store: () => OutboxStore | Promise<OutboxStore>;
    relayOptions?: OutboxRelayOptions;
  };
  /** Metadata provider called on every command dispatch. */
  metadataProvider?: MetadataProvider;
  /** Framework logger. Defaults to NodddeLogger at 'warn' level. */
  logger?: Logger;
};

/* eslint-disable no-redeclare */
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
  TAggregates extends AggregateMap = AggregateMap,
  TStandaloneEvent extends Event = Event,
  TProjections extends ProjectionMap = ProjectionMap,
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

/**
 * Internal context passed by wireDomain to Domain, carrying pre-computed
 * per-aggregate wirings when the user provides a per-aggregate record.
 * @internal
 */
interface ResolvedWiringContext {
  perAggregateWirings?: Map<string, AggregateWiring>;
}

/**
 * The running domain instance. Created via {@link wireDomain}, it is the
 * primary entry point for dispatching commands and accessing infrastructure.
 *
 * `dispatchCommand` accepts aggregate commands (from registered aggregates)
 * and standalone commands (from registered standalone command handlers).
 * `dispatchQuery` accepts projection queries (from registered projections)
 * and standalone queries (from registered standalone query handlers).
 *
 * @typeParam TInfrastructure - The custom infrastructure type for this domain.
 * @typeParam TStandaloneCommand - Union of standalone command types.
 * @typeParam TStandaloneQuery - Union of standalone query types.
 * @typeParam TAggregateCommand - Union of all aggregate command types (computed by wireDomain).
 * @typeParam TProjectionQuery - Union of all projection query types (computed by wireDomain).
 */
export class Domain<
  TInfrastructure extends Infrastructure,
  TStandaloneCommand extends Command = Command,
  TStandaloneQuery extends Query<any> = Query<any>,
  TAggregateCommand extends AggregateCommand<any> = AggregateCommand<any>,
  TProjectionQuery extends Query<any> = Query<any>,
> {
  private _infrastructure!: TInfrastructure &
    CQRSInfrastructure &
    FrameworkInfrastructure;
  private _unitOfWorkFactory!: UnitOfWorkFactory;
  private readonly _uowStorage = new AsyncLocalStorage<UnitOfWork>();
  private readonly _metadataStorage = new AsyncLocalStorage<MetadataContext>();
  private _commandExecutor!: CommandLifecycleExecutor;
  private _sagaExecutor?: SagaExecutor;
  private _outboxStore?: OutboxStore;
  private _outboxRelay?: OutboxRelay;
  private _instrumentation!: Instrumentation;
  private _shuttingDown = false;
  private _shutdownPromise: Promise<void> | null = null;
  private _activeOperations = 0;
  private _drainResolve: (() => void) | null = null;
  /** All resolved infrastructure components for auto-close discovery. */
  private _allComponents: unknown[] = [];
  /** The fully resolved infrastructure (custom + CQRS buses + framework logger). */
  public get infrastructure(): TInfrastructure &
    CQRSInfrastructure &
    FrameworkInfrastructure {
    return this._infrastructure;
  }

  constructor(
    private readonly definition: DomainDefinition<
      TInfrastructure,
      TStandaloneCommand,
      TStandaloneQuery
    >,
    private readonly wiring: DomainWiring<TInfrastructure>,
    private readonly _resolvedContext?: ResolvedWiringContext,
  ) {}

  /**
   * Initializes the domain by calling all infrastructure factories
   * in order: custom infrastructure, CQRS buses, persistence.
   * Then registers command handlers, query handlers, projection
   * event listeners, and saga event listeners.
   */
  public async init(): Promise<void> {
    const { definition, wiring } = this;

    // Step 0: Resolve logger (before everything else, so all init steps can log)
    const logger = wiring.logger ?? new NodddeLogger();
    const domainLog = logger.child("domain");

    // Step 0.5: Detect OpenTelemetry at runtime
    const otelApi = await detectOTel();
    this._instrumentation = new Instrumentation(otelApi);
    if (otelApi) {
      domainLog.info("OpenTelemetry detected. Tracing enabled.");
    } else {
      domainLog.debug("OpenTelemetry not detected. Tracing disabled.");
    }

    // Step 0.6: Initialize persistence adapter (if provided)
    const adapter = wiring.persistenceAdapter;
    if (adapter) {
      await adapter.init?.();
      domainLog.info("Persistence adapter initialized.");
    }

    // Step 1: Resolve custom infrastructure
    const customInfra = wiring.infrastructure
      ? await wiring.infrastructure(logger)
      : ({} as TInfrastructure);
    domainLog.info("Custom infrastructure resolved.");

    // Step 2: Resolve CQRS infrastructure
    let cqrsInfra: CQRSInfrastructure;
    if (wiring.buses) {
      cqrsInfra = await wiring.buses(customInfra);
    } else {
      domainLog.warn(
        "Using in-memory CQRS buses. This is not suitable for production.",
      );
      cqrsInfra = {
        commandBus: new InMemoryCommandBus(),
        eventBus: new EventEmitterEventBus(),
        queryBus: new InMemoryQueryBus(),
      };
    }

    // Step 3: Merge infrastructure (custom + CQRS buses + framework logger)
    this._infrastructure = {
      ...customInfra,
      ...cqrsInfra,
      logger,
    } as TInfrastructure & CQRSInfrastructure & FrameworkInfrastructure;

    // Step 4: Resolve aggregate persistence → AggregatePersistenceResolver
    const perAggregateWirings = this._resolvedContext?.perAggregateWirings;
    let persistenceResolver: AggregatePersistenceResolver;

    if (perAggregateWirings) {
      // Per-aggregate mode: resolve persistence from each aggregate's wiring + adapter fallback
      const resolved = new Map<string, PersistenceConfiguration>();
      const aggregateNames = new Set(
        Object.keys(definition.writeModel.aggregates),
      );

      // Validate no unknown aggregate names in wiring
      for (const name of perAggregateWirings.keys()) {
        if (!aggregateNames.has(name)) {
          throw new Error(
            `Per-aggregate wiring references unknown aggregate: ${name}. ` +
              `Registered aggregates: ${[...aggregateNames].join(", ")}.`,
          );
        }
      }

      for (const aggregateName of aggregateNames) {
        const aw = perAggregateWirings.get(aggregateName);
        const persistence = await resolveAggregatePersistence(
          aggregateName,
          aw?.persistence,
          adapter,
        );
        if (persistence) {
          resolved.set(aggregateName, persistence);
        }
      }

      if (resolved.size > 0) {
        // Ensure every aggregate has persistence resolved
        const missing = [...aggregateNames].filter((n) => !resolved.has(n));
        if (missing.length > 0 && resolved.size < aggregateNames.size) {
          // Some aggregates have persistence, some don't — inconsistent
          // For the missing ones, use in-memory fallback
          domainLog.warn(
            `Per-aggregate persistence is missing entries for: ${missing.join(", ")}. ` +
              `Using in-memory persistence for those aggregates.`,
          );
          const fallback = new InMemoryEventSourcedAggregatePersistence();
          for (const name of missing) {
            resolved.set(name, fallback);
          }
        }
        persistenceResolver = new PerAggregatePersistenceResolver(resolved);
      } else {
        // Per-aggregate mode but no persistence resolved — use in-memory default
        if (!adapter) {
          domainLog.warn(
            "Using in-memory aggregate persistence. This is not suitable for production.",
          );
        }
        persistenceResolver = new GlobalAggregatePersistenceResolver(
          new InMemoryEventSourcedAggregatePersistence(),
        );
      }
    } else {
      // Global mode: use the global AggregateWiring's persistence
      const globalWiring = wiring.aggregates as AggregateWiring | undefined;
      const globalPersistence = globalWiring?.persistence;

      const resolvedPersistence = await resolveAggregatePersistence(
        "(global)",
        globalPersistence,
        adapter,
      );

      if (!resolvedPersistence) {
        // Omitted and no adapter — in-memory default for all
        domainLog.warn(
          "Using in-memory aggregate persistence. This is not suitable for production.",
        );
        persistenceResolver = new GlobalAggregatePersistenceResolver(
          new InMemoryEventSourcedAggregatePersistence(),
        );
      } else {
        persistenceResolver = new GlobalAggregatePersistenceResolver(
          resolvedPersistence,
        );
      }
    }

    // Step 4.5: Resolve snapshot configuration
    let snapshotResolver:
      | ((
          aggregateName: string,
        ) => { store: SnapshotStore; strategy: SnapshotStrategy } | undefined)
      | undefined;

    if (perAggregateWirings) {
      // Per-aggregate snapshots
      const resolvedSnapshots = new Map<
        string,
        { store: SnapshotStore; strategy: SnapshotStrategy }
      >();
      for (const [name, aw] of perAggregateWirings) {
        if (aw.snapshots) {
          let store: SnapshotStore;
          if (aw.snapshots.store) {
            store = await aw.snapshots.store();
          } else if (adapter?.snapshotStore) {
            store = adapter.snapshotStore;
          } else {
            throw new Error(
              `Aggregate "${name}": snapshots.strategy is set but no snapshot store is available. ` +
                `Provide snapshots.store or use a persistenceAdapter with snapshotStore.`,
            );
          }
          resolvedSnapshots.set(name, {
            store,
            strategy: aw.snapshots.strategy,
          });
        }
      }
      if (resolvedSnapshots.size > 0) {
        snapshotResolver = (aggregateName) =>
          resolvedSnapshots.get(aggregateName);
      }
    } else {
      // Global snapshots from global AggregateWiring
      const globalWiring = wiring.aggregates as AggregateWiring | undefined;
      const snapshotConfig = globalWiring?.snapshots;
      if (snapshotConfig) {
        let snapshotStore: SnapshotStore;
        if (snapshotConfig.store) {
          snapshotStore = await snapshotConfig.store();
        } else if (adapter?.snapshotStore) {
          snapshotStore = adapter.snapshotStore;
        } else {
          throw new Error(
            `Global snapshots.strategy is set but no snapshot store is available. ` +
              `Provide snapshots.store or use a persistenceAdapter with snapshotStore.`,
          );
        }
        snapshotResolver = () => ({
          store: snapshotStore,
          strategy: snapshotConfig.strategy,
        });
      }
    }

    // Step 5: Resolve saga persistence (only when processModel.sagas is defined and non-empty)
    let sagaPersistence: SagaPersistence | undefined;
    const hasSagas =
      definition.processModel?.sagas &&
      Object.keys(definition.processModel.sagas).length > 0;
    if (hasSagas) {
      if (wiring.sagas?.persistence) {
        sagaPersistence = await wiring.sagas.persistence();
      } else if (adapter?.sagaPersistence) {
        sagaPersistence = adapter.sagaPersistence;
      } else {
        domainLog.warn(
          "Using in-memory saga persistence. This is not suitable for production.",
        );
        sagaPersistence = new InMemorySagaPersistence();
      }
    }

    // Step 5.5: Resolve UnitOfWork factory
    if (wiring.unitOfWork) {
      this._unitOfWorkFactory = await wiring.unitOfWork();
    } else if (adapter?.unitOfWorkFactory) {
      this._unitOfWorkFactory = adapter.unitOfWorkFactory;
    } else {
      this._unitOfWorkFactory = createInMemoryUnitOfWork;
    }

    // Step 5.6: Resolve concurrency strategy
    const concurrencyLog = logger.child("concurrency");
    let concurrencyStrategy: ConcurrencyStrategy;

    /**
     * Resolves a concurrency config (shorthand or object) into a ConcurrencyStrategy.
     */
    const resolveConcurrency = (
      aggregateName: string,
      concurrency: AggregateWiring["concurrency"],
    ): ConcurrencyStrategy => {
      if (!concurrency || concurrency === "optimistic") {
        return new OptimisticConcurrencyStrategy(0, concurrencyLog);
      }

      if (concurrency === "pessimistic") {
        // Shorthand — auto-resolve locker from adapter
        if (!adapter?.aggregateLocker) {
          throw new Error(
            `Aggregate "${aggregateName}": concurrency 'pessimistic' requires an aggregate locker. ` +
              `Provide a persistenceAdapter with aggregateLocker or use object form with explicit locker.`,
          );
        }
        return new PessimisticConcurrencyStrategy(
          adapter.aggregateLocker,
          undefined,
          concurrencyLog,
        );
      }

      // Object form
      if ("strategy" in concurrency && concurrency.strategy === "pessimistic") {
        const locker = concurrency.locker ?? adapter?.aggregateLocker;
        if (!locker) {
          throw new Error(
            `Aggregate "${aggregateName}": pessimistic concurrency requires a locker. ` +
              `Provide concurrency.locker or use a persistenceAdapter with aggregateLocker.`,
          );
        }
        return new PessimisticConcurrencyStrategy(
          locker,
          concurrency.lockTimeoutMs,
          concurrencyLog,
        );
      }

      // Optimistic with options
      return new OptimisticConcurrencyStrategy(
        (concurrency as { maxRetries?: number })?.maxRetries ?? 0,
        concurrencyLog,
      );
    };

    if (perAggregateWirings) {
      // Per-aggregate concurrency
      const strategies = new Map<string, ConcurrencyStrategy>();
      for (const [name, aw] of perAggregateWirings) {
        if (aw.concurrency) {
          strategies.set(name, resolveConcurrency(name, aw.concurrency));
        }
      }
      const defaultStrategy = new OptimisticConcurrencyStrategy(
        0,
        concurrencyLog,
      );
      concurrencyStrategy =
        strategies.size > 0
          ? new PerAggregateConcurrencyStrategy(strategies, defaultStrategy)
          : defaultStrategy;
    } else {
      // Global concurrency from global AggregateWiring
      const globalWiring = wiring.aggregates as AggregateWiring | undefined;
      concurrencyStrategy = resolveConcurrency(
        "(global)",
        globalWiring?.concurrency,
      );
    }

    // Step 5.7: Resolve idempotency store
    let idempotencyStore: IdempotencyStore | undefined;
    if (wiring.idempotency) {
      idempotencyStore = await wiring.idempotency();
    } else if (adapter?.idempotencyStore) {
      idempotencyStore = adapter.idempotencyStore;
    }

    // Step 5.8: Create metadata enricher
    const metadataEnricher = new MetadataEnricher(
      this._metadataStorage,
      wiring.metadataProvider,
      this._instrumentation,
    );

    // Step 5.9: Resolve view stores for projections
    const resolvedViewStores = new Map<string, ViewStore>();
    const resolvedProjections = new Map<string, Projection<any>>();
    for (const [name, projection] of Object.entries(
      definition.readModel.projections,
    )) {
      resolvedProjections.set(name, projection);
      const wiringViewStore = wiring.projections?.[name];

      const viewStoreFactory = wiringViewStore
        ? wiringViewStore.viewStore
        : projection.viewStore;
      if (viewStoreFactory) {
        const storeInstance = viewStoreFactory(this._infrastructure);
        resolvedViewStores.set(name, storeInstance);
        // Default missing id extractors to event.metadata.aggregateId
        for (const [eventName, handler] of Object.entries(projection.on)) {
          if (handler && !(handler as any).id) {
            domainLog.warn(
              `Projection "${String(name)}": handler "${eventName}" has no "id" function. ` +
                `Defaulting to event.metadata.aggregateId. Provide an explicit "id" ` +
                `extractor if the view key differs from the aggregate ID.`,
            );
            (handler as any).id = (event: Event) => {
              const id = event.metadata?.aggregateId;
              if (id == null) {
                throw new Error(
                  `Projection "${String(name)}": handler "${eventName}" has no "id" function ` +
                    `and the event's metadata.aggregateId is missing. Either provide an ` +
                    `explicit "id" extractor or ensure events carry aggregate metadata.`,
                );
              }
              return id;
            };
          }
        }
      }
    }

    // Step 5.8b: Resolve outbox store
    if (wiring.outbox) {
      this._outboxStore = await wiring.outbox.store();
    } else if (adapter?.outboxStore) {
      this._outboxStore = adapter.outboxStore;
    }

    // Step 5.10: Build strong-consistency callback for projections
    const strongProjections = [...resolvedProjections.entries()].filter(
      ([name, p]) => p.consistency === "strong" && resolvedViewStores.has(name),
    );

    // Compose onEventsProduced: strong-consistency projections + outbox writes
    const outboxStore = this._outboxStore;
    const hasStrongProjections = strongProjections.length > 0;
    const onEventsProduced:
      | ((events: Event[], uow: UnitOfWork) => Promise<void>)
      | undefined =
      hasStrongProjections || outboxStore
        ? async (events, uow) => {
            // Strong-consistency projection updates
            if (hasStrongProjections) {
              for (const [_projName, projection] of strongProjections) {
                const viewStoreInstance = resolvedViewStores.get(_projName)!;
                for (const event of events) {
                  const handler = (projection.on as any)[event.name];
                  if (handler?.id && handler?.reduce) {
                    const viewId = handler.id(event);
                    const currentView =
                      (await viewStoreInstance.load(viewId)) ??
                      projection.initialView;
                    const newView = await handler.reduce(event, currentView);
                    uow.enlist(() => viewStoreInstance.save(viewId, newView));
                  }
                }
              }
            }

            // Outbox writes (atomically within the same UoW)
            if (outboxStore && events.length > 0) {
              const entries: OutboxEntry[] = events.map((event) => ({
                id: uuidv7(),
                event,
                aggregateName: event.metadata?.aggregateName ?? undefined,
                aggregateId:
                  event.metadata?.aggregateId != null
                    ? String(event.metadata.aggregateId)
                    : undefined,
                createdAt: new Date().toISOString(),
                publishedAt: null,
              }));
              uow.enlist(() => outboxStore.save(entries));
            }
          }
        : undefined;

    // Build onEventsDispatched callback (best-effort outbox marking)
    const onEventsDispatched: ((events: Event[]) => Promise<void>) | undefined =
      outboxStore
        ? async (events) => {
            const eventIds = events
              .map((e) => e.metadata?.eventId)
              .filter((id): id is string => id != null);
            if (eventIds.length > 0) {
              await outboxStore.markPublishedByEventIds(eventIds);
            }
          }
        : undefined;

    // Step 5.11: Create command executor
    this._commandExecutor = new CommandLifecycleExecutor(
      persistenceResolver,
      this._infrastructure,
      this._unitOfWorkFactory,
      concurrencyStrategy,
      this._uowStorage,
      metadataEnricher,
      snapshotResolver,
      idempotencyStore,
      onEventsProduced,
      onEventsDispatched,
      logger.child("command"),
      this._instrumentation,
    );

    if (sagaPersistence) {
      this._sagaExecutor = new SagaExecutor(
        this._infrastructure,
        sagaPersistence,
        this._unitOfWorkFactory,
        this._uowStorage,
        this._metadataStorage,
        onEventsDispatched,
        logger.child("saga"),
        this._instrumentation,
      );
    }

    // Create outbox relay (do not start it)
    if (this._outboxStore) {
      this._outboxRelay = new OutboxRelay(
        this._outboxStore,
        this._infrastructure.eventBus,
        wiring.outbox?.relayOptions,
        logger.child("outbox"),
      );
    }

    // Step 5.12: Validate upcaster chains
    for (const [aggregateName, aggregate] of Object.entries(
      definition.writeModel.aggregates,
    )) {
      if (aggregate.upcasters) {
        for (const [eventName, chain] of Object.entries(aggregate.upcasters)) {
          if (
            !Array.isArray(chain) ||
            chain.some((step) => typeof step !== "function")
          ) {
            throw new Error(
              `Invalid upcaster chain for event "${eventName}" on aggregate "${aggregateName}": ` +
                `chain must be an array of functions.`,
            );
          }
        }
      }
    }

    const { commandBus, eventBus, queryBus } = this._infrastructure;

    // Step 6: Register aggregate command handlers on the command bus
    for (const [aggregateName, aggregate] of Object.entries(
      definition.writeModel.aggregates,
    )) {
      for (const commandName of Object.keys(aggregate.decide)) {
        const aggName = aggregateName;
        const agg = aggregate;
        const instr = this._instrumentation;
        (commandBus as InMemoryCommandBus).register(
          commandName,
          async (command: Command) => {
            await instr.withSpan(
              "noddde.command.dispatch",
              {
                "noddde.command.name": commandName,
                "noddde.aggregate.name": aggName,
                "noddde.aggregate.id": String(
                  (command as AggregateCommand).targetAggregateId,
                ),
              },
              async () => {
                await this._commandExecutor.execute(
                  aggName,
                  agg,
                  command as AggregateCommand,
                );
              },
            );
          },
        );
      }
    }

    // Step 7: Register standalone command handlers
    if (definition.writeModel.standaloneCommandHandlers) {
      for (const [commandName, handler] of Object.entries(
        definition.writeModel.standaloneCommandHandlers,
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
    for (const [projectionName, projection] of Object.entries(
      definition.readModel.projections,
    )) {
      if (projection.queryHandlers) {
        const viewStoreInstance = resolvedViewStores.get(projectionName);
        for (const [queryName, handler] of Object.entries(
          projection.queryHandlers,
        )) {
          if (handler) {
            (queryBus as InMemoryQueryBus).register(
              queryName,
              async (payload: any) => {
                const handlerInfra = viewStoreInstance
                  ? { ...this._infrastructure, views: viewStoreInstance }
                  : this._infrastructure;
                return await (handler as any)(payload, handlerInfra);
              },
            );
          }
        }
      }
    }

    // Step 9: Register standalone query handlers
    if (definition.readModel.standaloneQueryHandlers) {
      for (const [queryName, handler] of Object.entries(
        definition.readModel.standaloneQueryHandlers,
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
      definition.readModel.projections,
    )) {
      // Skip strong-consistency projections — they're handled via onEventsProduced
      if (projection.consistency === "strong") continue;

      const viewStoreInstance = resolvedViewStores.get(projectionName);
      if (!viewStoreInstance) continue;

      for (const eventName of Object.keys(projection.on)) {
        const handler = (projection.on as any)[eventName];
        if (!handler?.id) continue;
        const pName = projectionName;
        const instr = this._instrumentation;
        this.subscribeToEvent(eventBus, eventName, async (event: Event) => {
          const runProjection = async (): Promise<void> => {
            const viewId = handler.id(event);
            const currentView =
              (await viewStoreInstance.load(viewId)) ?? projection.initialView;
            const newView = await handler.reduce(event, currentView);
            await viewStoreInstance.save(viewId, newView);
          };

          const traceCarrier = {
            traceparent: event.metadata?.traceparent,
            tracestate: event.metadata?.tracestate,
          };

          await instr.withExtractedContext(traceCarrier, () =>
            instr.withSpan(
              "noddde.projection.handle",
              {
                "noddde.projection.name": pName,
                "noddde.event.name": event.name,
              },
              runProjection,
            ),
          );
        });
      }
    }

    // Step 11: Register event listeners for sagas
    if (definition.processModel?.sagas && this._sagaExecutor) {
      for (const [sagaName, saga] of Object.entries(
        definition.processModel.sagas,
      )) {
        for (const eventName of Object.keys(saga.on)) {
          this.subscribeToEvent(eventBus, eventName, async (event: Event) => {
            await this._sagaExecutor!.execute(sagaName, saga, event);
          });
        }
      }
    }

    // Step 12: Register standalone event handlers
    if (definition.processModel?.standaloneEventHandlers) {
      for (const [eventName, handler] of Object.entries(
        definition.processModel.standaloneEventHandlers,
      )) {
        if (!handler) continue;
        this.subscribeToEvent(eventBus, eventName, async (event: Event) => {
          await (handler as any)(event, this._infrastructure);
        });
      }
    }

    domainLog.info("Domain initialized.", {
      aggregates: Object.keys(definition.writeModel.aggregates),
      projections: Object.keys(definition.readModel.projections),
      sagas: definition.processModel?.sagas
        ? Object.keys(definition.processModel.sagas)
        : [],
    });

    // Step 13: Collect all infrastructure components for auto-close discovery
    // Persistence adapter (if provided) — close it during shutdown
    if (adapter) this._allComponents.push(adapter);
    // Custom infrastructure values come next (discovery order)
    for (const value of Object.values(customInfra as Record<string, unknown>)) {
      this._allComponents.push(value);
    }
    // CQRS buses
    this._allComponents.push(commandBus, eventBus, queryBus);
    // Persistence, stores
    if (sagaPersistence) this._allComponents.push(sagaPersistence);
    if (this._outboxStore) this._allComponents.push(this._outboxStore);
    if (idempotencyStore) this._allComponents.push(idempotencyStore);
  }

  /**
   * Subscribes to an event on the event bus. Uses the {@link EventEmitterEventBus}
   * `on` method to register an async-capable handler.
   */
  private subscribeToEvent(
    eventBus: EventBus,
    eventName: string,
    handler: (event: Event) => void | Promise<void>,
  ): void {
    // The EventBus interface only exposes dispatch (publish),
    // so we use a type assertion to reach the on() method.
    (eventBus as EventEmitterEventBus).on(eventName, handler);
  }

  private _acquireOperation(): void {
    if (this._shuttingDown) {
      throw new DomainShutdownError();
    }
    this._activeOperations++;
  }

  private _releaseOperation(): void {
    this._activeOperations--;
    if (this._activeOperations === 0 && this._drainResolve) {
      this._drainResolve();
    }
  }

  /**
   * Gracefully shuts down the domain:
   * 1. Stops accepting new commands and queries ({@link DomainShutdownError}).
   * 2. Waits for in-flight command executions and saga reactions to complete.
   * 3. Drains the outbox relay (if configured).
   * 4. Removes all event bus listeners.
   * 5. Auto-closes infrastructure implementing {@link Closeable}.
   *
   * Idempotent: calling `shutdown()` multiple times returns the same promise.
   *
   * @param options - Optional shutdown configuration.
   */
  public shutdown(options?: ShutdownOptions): Promise<void> {
    if (this._shutdownPromise) {
      return this._shutdownPromise;
    }

    this._shuttingDown = true;
    const timeoutMs = options?.timeoutMs ?? 30_000;

    this._shutdownPromise = this._performShutdown(timeoutMs);
    return this._shutdownPromise;
  }

  private async _performShutdown(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    // Phase 1: Wait for in-flight operations to drain
    if (this._activeOperations > 0) {
      const drainPromise = new Promise<void>((resolve) => {
        this._drainResolve = resolve;
      });

      const remaining = Math.max(0, deadline - Date.now());
      const timeoutRace = new Promise<void>((resolve) =>
        setTimeout(resolve, remaining),
      );
      await Promise.race([drainPromise, timeoutRace]);
    }

    // Phase 2: Drain outbox relay
    if (this._outboxRelay) {
      const remaining = Math.max(0, deadline - Date.now());
      const drainRelay = this._outboxRelay.drain();
      const timeoutRace = new Promise<void>((resolve) =>
        setTimeout(resolve, remaining),
      );
      await Promise.race([drainRelay, timeoutRace]);
    }

    // Phase 3: Remove event bus listeners
    const eventBus = this._infrastructure.eventBus;
    if ("removeAllListeners" in eventBus) {
      (eventBus as EventEmitterEventBus).removeAllListeners();
    }

    // Phase 4: Auto-close Closeable infrastructure (reverse order)
    const closeables = this._allComponents.filter(isCloseable).reverse();

    for (const closeable of closeables) {
      try {
        await closeable.close();
      } catch {
        // Best-effort: close errors are swallowed during shutdown
      }
    }
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
    this._acquireOperation();
    try {
      if (this._uowStorage.getStore()) {
        throw new Error("Nested units of work are not supported");
      }

      const uow = this._unitOfWorkFactory();

      return await this._uowStorage.run(uow, async () => {
        try {
          const result = await fn();
          const events = await uow.commit();
          for (const event of events) {
            await this._infrastructure.eventBus.dispatch(event);
          }

          // Best-effort post-dispatch outbox marking
          if (this._outboxStore && events.length > 0) {
            try {
              const eventIds = events
                .map((e) => e.metadata?.eventId)
                .filter((id): id is string => id != null);
              if (eventIds.length > 0) {
                await this._outboxStore.markPublishedByEventIds(eventIds);
              }
            } catch {
              // Best-effort: relay will catch unpublished entries
            }
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
    } finally {
      this._releaseOperation();
    }
  }

  /**
   * Executes a function within a metadata context that overrides the
   * configured {@link MetadataProvider}. Use this as an escape hatch
   * for per-request metadata (e.g., manual correlation IDs, admin overrides).
   *
   * Values provided here take precedence over the domain's `metadataProvider`.
   * Omitted fields fall back to the provider (if configured) or auto-generated defaults.
   *
   * @typeParam T - The return type of the scoped function.
   * @param context - Metadata values to override for this scope.
   * @param fn - The function to execute within the metadata context.
   * @returns The return value of `fn`.
   *
   * @example
   * ```ts
   * await domain.withMetadataContext(
   *   { userId: "admin", correlationId: "manual-fix-123" },
   *   () => domain.dispatchCommand(fixCommand),
   * );
   * ```
   */
  public async withMetadataContext<T>(
    context: MetadataContext,
    fn: () => Promise<T>,
  ): Promise<T> {
    return this._metadataStorage.run(context, fn);
  }

  /**
   * Starts the outbox relay background polling loop.
   * No-op if no outbox is configured or if already started.
   */
  public startOutboxRelay(): void {
    this._outboxRelay?.start();
  }

  /**
   * Stops the outbox relay background polling loop.
   * No-op if no outbox is configured or if not running.
   */
  public stopOutboxRelay(): void {
    this._outboxRelay?.stop();
  }

  /**
   * Processes a single batch of unpublished outbox entries.
   * Useful for testing — call this instead of starting the relay.
   *
   * @returns The number of entries dispatched, or 0 if no outbox is configured.
   */
  public async processOutboxOnce(): Promise<number> {
    if (!this._outboxRelay) return 0;
    return this._outboxRelay.processOnce();
  }

  /**
   * Dispatches a command to the appropriate aggregate or standalone handler.
   * Aggregate commands return the `targetAggregateId`, standalone commands return `void`.
   *
   * @typeParam TCommand - The specific command type being dispatched.
   * @param command - The command to dispatch.
   * @returns The aggregate ID for aggregate commands, or void for standalone commands.
   */
  public async dispatchCommand<
    TCommand extends TAggregateCommand | TStandaloneCommand,
    TResolved extends TAggregateCommand | TStandaloneCommand = Extract<
      TAggregateCommand | TStandaloneCommand,
      { name: TCommand["name"] }
    >,
  >(
    command: TCommand,
  ): Promise<
    TResolved extends AggregateCommand<any>
      ? TResolved["targetAggregateId"]
      : void
  > {
    this._acquireOperation();
    try {
      const spanAttributes: Record<string, string | number | undefined> = {
        "noddde.command.name": command.name,
      };
      if ("targetAggregateId" in command) {
        const aggCmd = command as AggregateCommand<any>;
        spanAttributes["noddde.aggregate.id"] = String(
          aggCmd.targetAggregateId,
        );
        // Find aggregate name for the span
        for (const [aggregateName, aggregate] of Object.entries(
          this.definition.writeModel.aggregates,
        )) {
          if (command.name in aggregate.decide) {
            spanAttributes["noddde.aggregate.name"] = aggregateName;
            break;
          }
        }
      }

      return await this._instrumentation.withSpan(
        "noddde.command.dispatch",
        spanAttributes,
        async () => {
          // Route: find the aggregate that handles this command
          for (const [aggregateName, aggregate] of Object.entries(
            this.definition.writeModel.aggregates,
          )) {
            if (command.name in aggregate.decide) {
              await this._commandExecutor.execute(
                aggregateName,
                aggregate,
                command as AggregateCommand<any>,
              );
              return (command as AggregateCommand<any>)
                .targetAggregateId as any;
            }
          }

          // If no aggregate handles it, try the command bus (standalone handlers)
          await this._infrastructure.commandBus.dispatch(command);
          // Standalone commands return void; aggregate commands reaching here
          // still return targetAggregateId for backward compatibility
          return (
            "targetAggregateId" in command
              ? (command as AggregateCommand<any>).targetAggregateId
              : undefined
          ) as any;
        },
      );
    } finally {
      this._releaseOperation();
    }
  }

  /**
   * Dispatches a query to the registered query handler via the query bus.
   * Returns the typed result from the handler.
   *
   * @typeParam TQuery - The specific query type being dispatched.
   * @param query - The query to dispatch (must include `name` and optional `payload`).
   * @returns The typed result from the query handler.
   */
  public async dispatchQuery<
    TName extends (TProjectionQuery | TStandaloneQuery)["name"],
  >(
    query: Extract<TProjectionQuery | TStandaloneQuery, { name: TName }>,
  ): Promise<
    QueryResult<Extract<TProjectionQuery | TStandaloneQuery, { name: TName }>>
  > {
    this._acquireOperation();
    try {
      return await this._instrumentation.withSpan(
        "noddde.query.dispatch",
        { "noddde.query.name": query.name },
        async () => {
          return (await this._infrastructure.queryBus.dispatch(query)) as any;
        },
      );
    } finally {
      this._releaseOperation();
    }
  }
}

/**
 * Wires a {@link DomainDefinition} with infrastructure to create a running
 * {@link Domain} instance. Resolves all factories, initializes persistence,
 * registers handlers, and returns the fully initialized domain.
 *
 * Type parameters propagate from the definition — no need to repeat them.
 *
 * @param definition - The domain structure from {@link defineDomain}.
 * @param wiring - The infrastructure wiring configuration.
 * @returns A fully initialized {@link Domain} instance.
 */
/**
 * Extracts TAggregates from a DomainDefinition value type.
 * @internal
 */
type ExtractAggregates<T> = T extends {
  writeModel: { aggregates: infer A extends AggregateMap };
}
  ? A
  : AggregateMap;

/**
 * Extracts TProjections from a DomainDefinition value type.
 * @internal
 */
type ExtractProjections<T> = T extends {
  readModel: { projections: infer P extends ProjectionMap };
}
  ? P
  : ProjectionMap;

/**
 * Extracts sagas map from a DomainDefinition value type.
 * @internal
 */
type ExtractSagas<T> = T extends {
  processModel?: { sagas?: infer S extends SagaMap };
}
  ? S
  : Record<string, never>;

/**
 * Converts a union type to an intersection type.
 * Uses contravariant inference: `A | B` → `A & B`.
 * @internal
 */
type UnionToIntersection<U> = (U extends any ? (x: U) => void : never) extends (
  x: infer I,
) => void
  ? I
  : never;

/**
 * Computes TInfrastructure as the intersection of all infrastructure types
 * declared across aggregates, projections, and sagas. This tells the developer
 * exactly what `wiring.infrastructure` must return.
 *
 * Each `Infer*MapInfrastructure` produces a union (one member per component).
 * `UnionToIntersection` merges them so the developer must satisfy ALL fields.
 * @internal
 */
type ExtractInfrastructureRaw<T> = UnionToIntersection<
  | InferAggregateMapInfrastructure<ExtractAggregates<T>>
  | InferProjectionMapInfrastructure<ExtractProjections<T>>
  | InferSagaMapInfrastructure<ExtractSagas<T>>
>;

type ExtractInfrastructure<T> =
  ExtractInfrastructureRaw<T> extends Infrastructure
    ? ExtractInfrastructureRaw<T>
    : Infrastructure;

/**
 * Extracts TStandaloneCommand from a DomainDefinition type.
 * Returns `never` when no standalone command handlers are defined.
 * @internal
 */
type ExtractStandaloneCommand<T> = T extends {
  writeModel: {
    standaloneCommandHandlers: StandaloneCommandHandlerMap<any, infer C>;
  };
}
  ? C
  : never;

/**
 * Extracts TStandaloneQuery from a DomainDefinition type.
 * Returns `never` when no standalone query handlers are defined.
 * @internal
 */
type ExtractStandaloneQuery<T> = T extends {
  readModel: {
    standaloneQueryHandlers: StandaloneQueryHandlerMap<any, infer Q>;
  };
}
  ? Q
  : never;

export const wireDomain = async <
  TDef extends DomainDefinition<any, any, any, any, any, any>,
  TInfrastructure extends Infrastructure = ExtractInfrastructure<TDef>,
  TStandaloneCommand extends Command = ExtractStandaloneCommand<TDef>,
  TStandaloneQuery extends Query<any> = ExtractStandaloneQuery<TDef>,
  TAggregates extends AggregateMap = ExtractAggregates<TDef>,
  TProjections extends ProjectionMap = ExtractProjections<TDef>,
>(
  definition: TDef,
  wiring: DomainWiring<
    ExtractInfrastructure<TDef>,
    TAggregates
  > = {} as DomainWiring<ExtractInfrastructure<TDef>, TAggregates>,
): Promise<
  Domain<
    TInfrastructure,
    TStandaloneCommand,
    TStandaloneQuery,
    InferAggregateMapCommands<TAggregates>,
    InferProjectionMapQueries<TProjections>
  >
> => {
  // Determine if aggregates wiring is per-aggregate or global
  const isGlobalAggregateWiring = (
    agg: AggregateWiring | Record<string, AggregateWiring> | undefined,
  ): agg is AggregateWiring => {
    if (!agg) return true; // undefined = global (defaults)
    return (
      "persistence" in agg ||
      "concurrency" in agg ||
      "snapshots" in agg ||
      Object.keys(agg).length === 0
    );
  };

  let perAggregateWirings: Map<string, AggregateWiring> | undefined;
  if (wiring.aggregates && !isGlobalAggregateWiring(wiring.aggregates)) {
    perAggregateWirings = new Map(
      Object.entries(wiring.aggregates as Record<string, AggregateWiring>),
    );
  }

  const domain = new Domain<
    TInfrastructure,
    TStandaloneCommand,
    TStandaloneQuery,
    InferAggregateMapCommands<TAggregates>,
    InferProjectionMapQueries<TProjections>
  >(
    definition as DomainDefinition<
      TInfrastructure,
      TStandaloneCommand,
      TStandaloneQuery
    >,
    wiring as DomainWiring<TInfrastructure>,
    { perAggregateWirings },
  );
  await domain.init();
  return domain;
};
