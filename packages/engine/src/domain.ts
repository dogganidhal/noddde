/* eslint-disable no-unused-vars */
import { AsyncLocalStorage } from "node:async_hooks";
import type {
  Aggregate,
  AggregateCommand,
  Command,
  CQRSInfrastructure,
  Event,
  EventBus,
  ID,
  Infrastructure,
  PersistenceConfiguration,
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
import type { AggregateLocker } from "@noddde/core";
import { OutboxRelay } from "./outbox-relay";
import type { OutboxRelayOptions } from "./outbox-relay";
import { uuidv7 } from "./uuid";

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
import {
  GlobalAggregatePersistenceResolver,
  PerAggregatePersistenceResolver,
} from "./aggregate-persistence-resolver";
import type { AggregatePersistenceResolver } from "./aggregate-persistence-resolver";

type AggregateMap = Record<string | symbol, Aggregate<any>>;

/** A projection entry in domain config — bare projection or with viewStore. */
type ProjectionEntry =
  | Projection<any>
  | {
      projection: Projection<any>;
      viewStore: (infrastructure: any) => ViewStore;
    };

type ProjectionMap = Record<string | symbol, ProjectionEntry>;

/** Normalize a ProjectionEntry to extract the projection and optional viewStore factory. */
function resolveProjectionEntry(entry: ProjectionEntry): {
  projection: Projection<any>;
  viewStore?: (infrastructure: any) => ViewStore;
} {
  if ("projection" in entry && "viewStore" in entry) {
    return { projection: entry.projection, viewStore: entry.viewStore as any };
  }
  // Bare projection (has 'on' field)
  return { projection: entry as Projection<any> };
}

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
 * Factory function returning a persistence configuration, either synchronously
 * or as a promise.
 */
type PersistenceFactory = () =>
  | PersistenceConfiguration
  | Promise<PersistenceConfiguration>;

// ---- New API: defineDomain + wireDomain ----

/**
 * Per-aggregate runtime configuration. Groups persistence, concurrency,
 * and snapshot settings.
 */
export type AggregateWiring = {
  /** Persistence factory for this aggregate. */
  persistence?: PersistenceFactory;
  /** Concurrency control for this aggregate. */
  concurrency?:
    | { strategy?: "optimistic"; maxRetries?: number }
    | {
        strategy: "pessimistic";
        locker: AggregateLocker;
        lockTimeoutMs?: number;
      };
  /** Snapshot configuration for this aggregate (event-sourced only). */
  snapshots?: {
    store: () => SnapshotStore | Promise<SnapshotStore>;
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
    projections: ProjectionMap;
    /** Optional map of standalone query handlers keyed by query name. */
    standaloneQueryHandlers?: StandaloneQueryHandlerMap<
      TInfrastructure,
      TStandaloneQuery
    >;
  };
  /**
   * Process managers (sagas). Optional — omit if the domain has no
   * cross-aggregate workflows.
   */
  processModel?: {
    /** A map of saga definitions keyed by saga name. */
    sagas: SagaMap;
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
  /** Factory for user-provided infrastructure services. */
  infrastructure?: () => TInfrastructure | Promise<TInfrastructure>;
  /** Aggregate runtime config — global {@link AggregateWiring} OR per-aggregate record. */
  aggregates?:
    | AggregateWiring
    | Record<keyof TAggregates & string, AggregateWiring>;
  /** Projection runtime config — per-projection view store wiring. */
  projections?: Record<string, ProjectionWiring<TInfrastructure>>;
  /** Saga runtime config. Required if processModel has sagas. */
  sagas?: {
    persistence: () => SagaPersistence | Promise<SagaPersistence>;
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
};

/**
 * Creates a pure, sync domain definition with full type inference.
 * Consistent with {@link defineAggregate}, {@link defineProjection}, {@link defineSaga}.
 *
 * @returns The same definition object, fully typed.
 */
export function defineDomain<
  TInfrastructure extends Infrastructure = Infrastructure,
  TStandaloneCommand extends Command = Command,
  TStandaloneQuery extends Query<any> = Query<any>,
  TAggregates extends AggregateMap = AggregateMap,
>(
  definition: DomainDefinition<
    TInfrastructure,
    TStandaloneCommand,
    TStandaloneQuery,
    TAggregates
  >,
): DomainDefinition<
  TInfrastructure,
  TStandaloneCommand,
  TStandaloneQuery,
  TAggregates
> {
  return definition;
}

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
  private _unitOfWorkFactory!: UnitOfWorkFactory;
  private readonly _uowStorage = new AsyncLocalStorage<UnitOfWork>();
  private readonly _metadataStorage = new AsyncLocalStorage<MetadataContext>();
  private _commandExecutor!: CommandLifecycleExecutor;
  private _sagaExecutor?: SagaExecutor;
  private _outboxStore?: OutboxStore;
  private _outboxRelay?: OutboxRelay;
  /** The fully resolved infrastructure (custom + CQRS buses). */
  public get infrastructure(): TInfrastructure & CQRSInfrastructure {
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

    // Step 1: Resolve custom infrastructure
    const customInfra = wiring.infrastructure
      ? await wiring.infrastructure()
      : ({} as TInfrastructure);

    // Step 2: Resolve CQRS infrastructure
    let cqrsInfra: CQRSInfrastructure;
    if (wiring.buses) {
      cqrsInfra = await wiring.buses(customInfra);
    } else {
      console.warn(
        "[noddde] Using in-memory CQRS buses. This is not suitable for production.",
      );
      cqrsInfra = {
        commandBus: new InMemoryCommandBus(),
        eventBus: new EventEmitterEventBus(),
        queryBus: new InMemoryQueryBus(),
      };
    }

    // Step 3: Merge infrastructure
    this._infrastructure = {
      ...customInfra,
      ...cqrsInfra,
    } as TInfrastructure & CQRSInfrastructure;

    // Step 4: Resolve aggregate persistence → AggregatePersistenceResolver
    const perAggregateWirings = this._resolvedContext?.perAggregateWirings;
    let persistenceResolver: AggregatePersistenceResolver;

    if (perAggregateWirings) {
      // Per-aggregate mode: build persistence from each aggregate's wiring
      const persistenceRecord: Record<string, PersistenceFactory> = {};
      let hasPersistence = false;
      for (const [name, aw] of perAggregateWirings) {
        if (aw.persistence) {
          persistenceRecord[name] = aw.persistence;
          hasPersistence = true;
        }
      }
      if (hasPersistence) {
        // Fill in defaults for aggregates that didn't specify persistence
        for (const name of Object.keys(definition.writeModel.aggregates)) {
          if (!(name in persistenceRecord)) {
            persistenceRecord[name] = () =>
              new InMemoryEventSourcedAggregatePersistence();
          }
        }
        // Runtime validation
        const aggregateNames = new Set(
          Object.keys(definition.writeModel.aggregates),
        );
        const configNames = new Set(Object.keys(persistenceRecord));

        const missing = [...aggregateNames].filter((n) => !configNames.has(n));
        if (missing.length > 0) {
          throw new Error(
            `Per-aggregate persistence is missing entries for: ${missing.join(", ")}. ` +
              `All aggregates must have a persistence factory.`,
          );
        }
        const unknown = [...configNames].filter((n) => !aggregateNames.has(n));
        if (unknown.length > 0) {
          throw new Error(
            `Per-aggregate persistence references unknown aggregates: ${unknown.join(", ")}. ` +
              `Registered aggregates: ${[...aggregateNames].join(", ")}.`,
          );
        }

        const resolved = new Map<string, PersistenceConfiguration>();
        for (const [name, factory] of Object.entries(persistenceRecord)) {
          resolved.set(name, await factory());
        }
        persistenceResolver = new PerAggregatePersistenceResolver(resolved);
      } else {
        // Per-aggregate mode but no persistence specified — use in-memory default
        console.warn(
          "[noddde] Using in-memory aggregate persistence. This is not suitable for production.",
        );
        persistenceResolver = new GlobalAggregatePersistenceResolver(
          new InMemoryEventSourcedAggregatePersistence(),
        );
      }
    } else {
      // Global mode: use the global AggregateWiring's persistence
      const globalWiring = wiring.aggregates as AggregateWiring | undefined;
      const globalPersistence = globalWiring?.persistence;

      if (!globalPersistence) {
        // Omitted — in-memory default for all
        console.warn(
          "[noddde] Using in-memory aggregate persistence. This is not suitable for production.",
        );
        persistenceResolver = new GlobalAggregatePersistenceResolver(
          new InMemoryEventSourcedAggregatePersistence(),
        );
      } else {
        // Domain-wide factory
        persistenceResolver = new GlobalAggregatePersistenceResolver(
          await globalPersistence(),
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
          const store = await aw.snapshots.store();
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
        const snapshotStore = await snapshotConfig.store();
        snapshotResolver = () => ({
          store: snapshotStore,
          strategy: snapshotConfig.strategy,
        });
      }
    }

    // Step 5: Resolve saga persistence (only when processModel is configured)
    let sagaPersistence: SagaPersistence | undefined;
    if (definition.processModel) {
      if (wiring.sagas?.persistence) {
        sagaPersistence = await wiring.sagas.persistence();
      } else {
        console.warn(
          "[noddde] Using in-memory saga persistence. This is not suitable for production.",
        );
        sagaPersistence = new InMemorySagaPersistence();
      }
    }

    // Step 5.5: Resolve UnitOfWork factory
    this._unitOfWorkFactory = wiring.unitOfWork
      ? await wiring.unitOfWork()
      : createInMemoryUnitOfWork;

    // Step 5.6: Resolve concurrency strategy
    let concurrencyStrategy: ConcurrencyStrategy;

    if (perAggregateWirings) {
      // Per-aggregate concurrency
      const strategies = new Map<string, ConcurrencyStrategy>();
      for (const [name, aw] of perAggregateWirings) {
        if (aw.concurrency) {
          if (
            "strategy" in aw.concurrency &&
            aw.concurrency.strategy === "pessimistic"
          ) {
            strategies.set(
              name,
              new PessimisticConcurrencyStrategy(
                aw.concurrency.locker,
                aw.concurrency.lockTimeoutMs,
              ),
            );
          } else {
            strategies.set(
              name,
              new OptimisticConcurrencyStrategy(
                (aw.concurrency as { maxRetries?: number })?.maxRetries ?? 0,
              ),
            );
          }
        }
      }
      const defaultStrategy = new OptimisticConcurrencyStrategy(0);
      concurrencyStrategy =
        strategies.size > 0
          ? new PerAggregateConcurrencyStrategy(strategies, defaultStrategy)
          : defaultStrategy;
    } else {
      // Global concurrency from global AggregateWiring
      const globalWiring = wiring.aggregates as AggregateWiring | undefined;
      const concurrency = globalWiring?.concurrency;
      if (
        concurrency &&
        "strategy" in concurrency &&
        concurrency.strategy === "pessimistic"
      ) {
        concurrencyStrategy = new PessimisticConcurrencyStrategy(
          concurrency.locker,
          concurrency.lockTimeoutMs,
        );
      } else {
        concurrencyStrategy = new OptimisticConcurrencyStrategy(
          (concurrency as { maxRetries?: number } | undefined)?.maxRetries ?? 0,
        );
      }
    }

    // Step 5.7: Resolve idempotency store
    let idempotencyStore: IdempotencyStore | undefined;
    if (wiring.idempotency) {
      idempotencyStore = await wiring.idempotency();
    }

    // Step 5.8: Create metadata enricher
    const metadataEnricher = new MetadataEnricher(
      this._metadataStorage,
      wiring.metadataProvider,
    );

    // Step 5.9: Resolve view stores for projections
    const resolvedViewStores = new Map<string, ViewStore>();
    const resolvedProjections = new Map<string, Projection<any>>();
    for (const [name, projection] of Object.entries(
      definition.readModel.projections,
    )) {
      resolvedProjections.set(name, projection);
      const wiringViewStore = wiring.projections?.[name];

      if (wiringViewStore) {
        const storeInstance = wiringViewStore.viewStore(this._infrastructure);
        resolvedViewStores.set(name, storeInstance);
        // Validate: every on entry must have id when viewStore is present
        for (const [eventName, handler] of Object.entries(projection.on)) {
          if (handler && !(handler as any).id) {
            throw new Error(
              `Projection "${String(name)}" has a viewStore but the "${eventName}" handler ` +
                `in "on" is missing an "id" function. All event handlers must provide ` +
                `an identity extractor when viewStore is present.`,
            );
          }
        }
      }
    }

    // Step 5.8b: Resolve outbox store
    if (wiring.outbox) {
      this._outboxStore = await wiring.outbox.store();
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
    );

    if (sagaPersistence) {
      this._sagaExecutor = new SagaExecutor(
        this._infrastructure,
        sagaPersistence,
        this._unitOfWorkFactory,
        this._uowStorage,
        this._metadataStorage,
        onEventsDispatched,
      );
    }

    // Create outbox relay (do not start it)
    if (this._outboxStore) {
      this._outboxRelay = new OutboxRelay(
        this._outboxStore,
        this._infrastructure.eventBus,
        wiring.outbox?.relayOptions,
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
      for (const commandName of Object.keys(aggregate.commands)) {
        (commandBus as InMemoryCommandBus).register(
          commandName,
          async (command: Command) => {
            await this._commandExecutor.execute(
              aggregateName,
              aggregate,
              command as AggregateCommand,
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
        this.subscribeToEvent(eventBus, eventName, async (event: Event) => {
          const viewId = handler.id(event);
          const currentView =
            (await viewStoreInstance.load(viewId)) ?? projection.initialView;
          const newView = await handler.reduce(event, currentView);
          await viewStoreInstance.save(viewId, newView);
        });
      }
    }

    // Step 11: Register event listeners for sagas
    if (definition.processModel && this._sagaExecutor) {
      for (const [sagaName, saga] of Object.entries(
        definition.processModel.sagas,
      )) {
        for (const eventName of Object.keys(saga.handlers)) {
          this.subscribeToEvent(eventBus, eventName, async (event: Event) => {
            await this._sagaExecutor!.execute(sagaName, saga, event);
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
    handler: (event: Event) => void | Promise<void>,
  ): void {
    // The EventBus interface only exposes dispatch (publish),
    // so we use a type assertion to reach the on() method.
    (eventBus as EventEmitterEventBus).on(eventName, handler);
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
      this.definition.writeModel.aggregates,
    )) {
      if (command.name in aggregate.commands) {
        await this._commandExecutor.execute(aggregateName, aggregate, command);
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
export const wireDomain = async <
  TInfrastructure extends Infrastructure,
  TStandaloneCommand extends Command = Command,
  TStandaloneQuery extends Query<any> = Query<any>,
  TAggregates extends AggregateMap = AggregateMap,
>(
  definition: DomainDefinition<
    TInfrastructure,
    TStandaloneCommand,
    TStandaloneQuery,
    TAggregates
  >,
  wiring: DomainWiring<TInfrastructure, TAggregates> = {} as DomainWiring<
    TInfrastructure,
    TAggregates
  >,
): Promise<Domain<TInfrastructure, TStandaloneCommand, TStandaloneQuery>> => {
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

  const domain = new Domain(definition, wiring, { perAggregateWirings });
  await domain.init();
  return domain;
};
