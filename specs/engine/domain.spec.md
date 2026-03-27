---
title: "Domain Definition & Wiring"
module: engine/domain
source_file: packages/engine/src/domain.ts
status: implemented
exports:
  [
    Domain,
    DomainDefinition,
    defineDomain,
    AggregateWiring,
    ProjectionWiring,
    DomainWiring,
    wireDomain,
    DomainConfiguration,
    configureDomain,
  ]
depends_on:
  - engine/implementations/ee-event-bus
  - engine/implementations/in-memory-command-bus
  - engine/implementations/in-memory-query-bus
  - engine/implementations/in-memory-aggregate-persistence
  - engine/implementations/in-memory-saga-persistence
  - engine/aggregate-persistence-resolver
  - engine/executors/command-lifecycle-executor
  - engine/executors/saga-executor
  - engine/executors/metadata-enricher
  - engine/outbox-relay
  - ddd/aggregate-root
  - ddd/projection
  - ddd/saga
  - cqrs/command/command
  - cqrs/query/query
  - edd/event
  - infrastructure
  - persistence/idempotency
  - persistence/outbox
docs:
  - domain-configuration/overview.mdx
  - domain-configuration/write-model.mdx
  - domain-configuration/read-model.mdx
  - domain-configuration/infrastructure.mdx
---

# Domain Definition & Wiring

> The domain API is split into two phases: **definition** (`defineDomain`) captures the pure domain structure (aggregates, projections, sagas, handlers) as a sync identity function, while **wiring** (`wireDomain`) connects that definition to infrastructure (persistence, buses, concurrency, snapshots) and returns a running `Domain` instance. This separation allows domain definitions to be shared, tested, and analyzed independently of runtime concerns. The `Domain` class remains the central runtime orchestrator. `DomainConfiguration` and `configureDomain` are deprecated in favor of `defineDomain` + `wireDomain`.

## Type Contract

```ts
type PersistenceFactory = () =>
  | PersistenceConfiguration
  | Promise<PersistenceConfiguration>;

type DomainConfiguration<
  TInfrastructure extends Infrastructure,
  TStandaloneCommand extends Command = Command,
  TStandaloneQuery extends Query<any> = Query<any>,
  TAggregates extends AggregateMap = AggregateMap,
> = {
  writeModel: {
    aggregates: TAggregates;
    standaloneCommandHandlers?: StandaloneCommandHandlerMap<
      TInfrastructure,
      TStandaloneCommand
    >;
  };
  readModel: {
    projections: ProjectionMap;
    standaloneQueryHandlers?: StandaloneQueryHandlerMap<
      TInfrastructure,
      TStandaloneQuery
    >;
  };
  processModel?: {
    sagas: SagaMap;
  };
  infrastructure: {
    aggregatePersistence?:
      | PersistenceFactory
      | Record<keyof TAggregates & string, PersistenceFactory>;
    aggregateConcurrency?:
      | { strategy?: "optimistic"; maxRetries?: number }
      | {
          strategy: "pessimistic";
          locker: AggregateLocker;
          lockTimeoutMs?: number;
        };
    sagaPersistence?: () => SagaPersistence | Promise<SagaPersistence>;
    snapshotStore?: () => SnapshotStore | Promise<SnapshotStore>;
    snapshotStrategy?: SnapshotStrategy;
    idempotencyStore?: () => IdempotencyStore | Promise<IdempotencyStore>;
    /**
     * Transactional outbox configuration. When configured, domain events
     * are written to the outbox store atomically with aggregate persistence,
     * providing at-least-once delivery guarantees. A background relay
     * polls for unpublished entries and dispatches them via the EventBus.
     */
    outbox?: {
      /** Factory for the outbox store. */
      store: () => OutboxStore | Promise<OutboxStore>;
      /** Options for the outbox relay background process. */
      relayOptions?: OutboxRelayOptions;
    };
    provideInfrastructure?: () => Promise<TInfrastructure> | TInfrastructure;
    cqrsInfrastructure?: (
      infrastructure: TInfrastructure,
    ) => CQRSInfrastructure | Promise<CQRSInfrastructure>;
    unitOfWorkFactory?: () => UnitOfWorkFactory | Promise<UnitOfWorkFactory>;
  };
};

class Domain<
  TInfrastructure extends Infrastructure,
  TStandaloneCommand extends Command = Command,
  TStandaloneQuery extends Query<any> = Query<any>,
> {
  get infrastructure(): TInfrastructure & CQRSInfrastructure;
  init(): Promise<void>;
  dispatchCommand<TCommand extends AggregateCommand<any>>(
    command: TCommand,
  ): Promise<TCommand["targetAggregateId"]>;
  dispatchQuery<TQuery extends Query<any>>(
    query: TQuery,
  ): Promise<QueryResult<TQuery>>;
  /** Starts the outbox relay background polling. Requires outbox configuration. */
  startOutboxRelay(): void;
  /** Stops the outbox relay background polling. */
  stopOutboxRelay(): void;
  /** Processes a single batch of unpublished outbox entries. For testing and manual recovery. */
  processOutboxOnce(): Promise<number>;
}

const configureDomain: <
  TInfrastructure,
  TStandaloneCommand,
  TStandaloneQuery,
  TAggregates extends AggregateMap = AggregateMap,
>(
  configuration: DomainConfiguration<
    TInfrastructure,
    TStandaloneCommand,
    TStandaloneQuery,
    TAggregates
  >,
) => Promise<Domain<TInfrastructure, TStandaloneCommand, TStandaloneQuery>>;
```

### New API (preferred)

```ts
/**
 * Pure structural definition of a domain. Contains aggregates, projections,
 * sagas, and handler registrations — no runtime or infrastructure concerns.
 */
type DomainDefinition<
  TInfrastructure extends Infrastructure = Infrastructure,
  TStandaloneCommand extends Command = Command,
  TStandaloneQuery extends Query<any> = Query<any>,
  TAggregates extends AggregateMap = AggregateMap,
> = {
  writeModel: {
    aggregates: TAggregates;
    standaloneCommandHandlers?: StandaloneCommandHandlerMap<
      TInfrastructure,
      TStandaloneCommand
    >;
  };
  readModel: {
    projections: ProjectionMap;
    standaloneQueryHandlers?: StandaloneQueryHandlerMap<
      TInfrastructure,
      TStandaloneQuery
    >;
  };
  processModel?: {
    sagas: SagaMap;
  };
};

/**
 * Sync identity function that creates a domain definition with full type
 * inference. Consistent with defineAggregate, defineProjection, defineSaga.
 */
const defineDomain: <
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
) => DomainDefinition<
  TInfrastructure,
  TStandaloneCommand,
  TStandaloneQuery,
  TAggregates
>;

/**
 * Per-aggregate runtime configuration. Groups persistence, concurrency,
 * and snapshot settings — the three things that can vary per aggregate.
 */
type AggregateWiring = {
  persistence?: PersistenceFactory;
  concurrency?:
    | { strategy?: "optimistic"; maxRetries?: number }
    | {
        strategy: "pessimistic";
        locker: AggregateLocker;
        lockTimeoutMs?: number;
      };
  snapshots?: {
    store: () => SnapshotStore | Promise<SnapshotStore>;
    strategy: SnapshotStrategy;
  };
};

/**
 * Per-projection runtime configuration. Extracts view store wiring from
 * the projection definition into the wiring layer.
 */
type ProjectionWiring<TInfrastructure extends Infrastructure = Infrastructure> =
  {
    viewStore: (infrastructure: TInfrastructure) => ViewStore;
  };

/**
 * Runtime infrastructure wiring. Connects a DomainDefinition to persistence,
 * buses, concurrency, snapshots, and user-provided services.
 */
type DomainWiring<
  TInfrastructure extends Infrastructure = Infrastructure,
  TAggregates extends AggregateMap = AggregateMap,
> = {
  /** Factory for user-provided infrastructure services. */
  infrastructure?: () => TInfrastructure | Promise<TInfrastructure>;
  /** Aggregate runtime — global AggregateWiring OR per-aggregate record. */
  aggregates?:
    | AggregateWiring
    | Record<keyof TAggregates & string, AggregateWiring>;
  /** Projection runtime — per-projection view store wiring. */
  projections?: Record<string, ProjectionWiring<TInfrastructure>>;
  /** Saga runtime. Required if processModel has sagas. */
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
 * Wires a DomainDefinition with infrastructure to create a running Domain.
 * When `wiring` is omitted or `{}`, all infrastructure defaults to in-memory
 * implementations with startup warnings logged to the console.
 */
const wireDomain: <
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
  wiring?: DomainWiring<TInfrastructure, TAggregates>,
) => Promise<Domain<TInfrastructure, TStandaloneCommand, TStandaloneQuery>>;
```

- `DomainDefinition` captures the pure domain structure: write model (aggregates + standalone command handlers), read model (projections + standalone query handlers), and process model (sagas). `TInfrastructure` is a type parameter only (handler signatures reference it) — no infrastructure value is present.
- `defineDomain` is a sync identity function, consistent with `defineAggregate`, `defineProjection`, `defineSaga`. It returns the input with full type inference. `TAggregates` is inferred from `writeModel.aggregates`.
- `AggregateWiring` groups per-aggregate runtime config: persistence, concurrency strategy, and snapshots. All fields optional.
- `ProjectionWiring` provides per-projection view store wiring, extracted from the `Projection.viewStore` field (which is now deprecated in favor of this).
- `DomainWiring` separates user-provided infrastructure (`infrastructure`) from framework plumbing (`aggregates`, `projections`, `sagas`, `buses`, `unitOfWork`, `idempotency`, `outbox`).
- `DomainWiring.aggregates` is a discriminated union: a single `AggregateWiring` (global — all aggregates share the same config) or a `Record<keyof TAggregates & string, AggregateWiring>` (per-aggregate — each aggregate configured independently). Runtime discrimination: `typeof aggregates.persistence === 'function'` or `typeof aggregates.concurrency !== 'undefined'` or `typeof aggregates.snapshots !== 'undefined'` → global; otherwise per-aggregate record.
- `wireDomain` accepts a `DomainDefinition` and an optional `DomainWiring`. When `wiring` is omitted or `{}`, all infrastructure defaults to in-memory implementations and startup warnings are logged. Resolves all factories, creates a `Domain` instance, calls `init()`, and returns it. Type parameters propagate from the definition — the user does not need to repeat them.

### Deprecated API (backward compatible)

- `PersistenceFactory` is a helper type alias for aggregate persistence factory functions.
- `DomainConfiguration` is fully generic over the infrastructure, standalone command, standalone query, and aggregate map types. `TAggregates` defaults to `AggregateMap` for backward compatibility and is inferred by `configureDomain` from the `writeModel.aggregates` object, enabling type-safe per-aggregate persistence keys.
- `aggregatePersistence` is a union type: a single `PersistenceFactory` (domain-wide, all aggregates share one persistence) or a `Record<keyof TAggregates & string, PersistenceFactory>` (per-aggregate, every aggregate must have an entry). When using the per-aggregate form, TypeScript enforces that all registered aggregate names have a corresponding persistence factory.
- `Domain` stores the resolved infrastructure as `TInfrastructure & CQRSInfrastructure` -- custom dependencies merged with the CQRS buses.
- `dispatchCommand` returns the `targetAggregateId` of the handled command, allowing callers to know which aggregate processed it.
- `dispatchQuery` delegates to the query bus and returns the typed result. It is a convenience method providing API symmetry with `dispatchCommand`.
- `configureDomain` is **deprecated** in favor of `defineDomain` + `wireDomain`. It internally delegates to the new API. It constructs a `Domain` and calls `init()` before returning.

## Behavioral Requirements

### Domain.init() -- Initialization Sequence

The `init()` method must execute the following steps in order:

1. **Resolve custom infrastructure** -- Call `configuration.infrastructure.provideInfrastructure()` if provided. Store the result. If not provided, use `{}` as the default infrastructure.
2. **Resolve CQRS infrastructure** -- Call `configuration.infrastructure.cqrsInfrastructure(infrastructure)` if provided, passing the resolved custom infrastructure. Store the `CommandBus`, `EventBus`, and `QueryBus`. If not provided, create default in-memory implementations (`InMemoryCommandBus`, `EventEmitterEventBus`, `InMemoryQueryBus`) and log a warning: `[noddde] Using in-memory CQRS buses. This is not suitable for production.`
3. **Merge infrastructure** -- Combine custom infrastructure and CQRS infrastructure into `this._infrastructure` as `TInfrastructure & CQRSInfrastructure`.
4. **Resolve aggregate persistence** -- Build an `AggregatePersistenceResolver` (strategy pattern, engine-internal) based on the `aggregatePersistence` configuration:
   - **Omitted** (`undefined`): Create a `GlobalAggregatePersistenceResolver` wrapping a default `InMemoryEventSourcedAggregatePersistence` and log a warning: `[noddde] Using in-memory aggregate persistence. This is not suitable for production.`
   - **Function** (`typeof aggregatePersistence === 'function'`): Call the factory, create a `GlobalAggregatePersistenceResolver` wrapping the result.
   - **Record** (per-aggregate map): Validate that every aggregate in `writeModel.aggregates` has a corresponding entry and that no unknown aggregate names are present. Throw a descriptive error on mismatch. Resolve each factory. Create a `PerAggregatePersistenceResolver` wrapping a `Map<string, PersistenceConfiguration>`.
     Pass the resolver to `CommandLifecycleExecutor`, which calls `resolver.resolve(aggregateName)` at each command dispatch to obtain the persistence for the target aggregate.
5. **Resolve snapshot store** -- Call `configuration.infrastructure.snapshotStore()` if provided. Store as `this._snapshotStore`. Store `configuration.infrastructure.snapshotStrategy` as `this._snapshotStrategy`. Both are optional.
6. **Resolve saga persistence** -- Call `configuration.infrastructure.sagaPersistence()` if provided. If omitted and `processModel` is configured, default to `InMemorySagaPersistence` and log a warning: `[noddde] Using in-memory saga persistence. This is not suitable for production.`
   6b. **Resolve outbox store** -- If `configuration.infrastructure.outbox` is provided, call `outbox.store()` to resolve the `OutboxStore`. Create an `OutboxRelay` instance (but do not start it). The outbox store is used to compose the `onEventsProduced` callback (enlisting outbox writes in the UoW) and the `onEventsDispatched` callback (marking entries published by event ID after dispatch).
7. **Register command handlers** -- For each aggregate in `writeModel.aggregates`, register a command handler on the command bus for each command name defined in `Aggregate.commands`. The registered handler encapsulates the full command lifecycle (load, execute, apply, persist, publish).
8. **Register standalone command handlers** -- For each handler in `writeModel.standaloneCommandHandlers`, register it on the command bus, wrapping it to receive the merged infrastructure.
9. **Register query handlers** -- For each projection in `readModel.projections`, register each query handler from `Projection.queryHandlers` on the query bus.
10. **Register standalone query handlers** -- For each handler in `readModel.standaloneQueryHandlers`, register it on the query bus.
11. **Register event listeners for projections** -- For each projection, subscribe to each event name in `Projection.on` on the event bus. When an event arrives, invoke the entry's `reduce` function to update the projection's view.
12. **Register event listeners for sagas** -- For each saga in `processModel.sagas`, subscribe to each event name in `Saga.handlers` on the event bus. When an event arrives, execute the saga event handling lifecycle.

### Domain.dispatchCommand() -- Command Dispatch Lifecycle

The `dispatchCommand` method executes the following lifecycle for aggregate commands:

1. **Route** -- Look up the aggregate whose `commands` map contains a handler for `command.name`. If no aggregate handles this command, check standalone command handlers.
2. **Load** -- Using the resolved persistence:
   - **Event-sourced (with snapshot)**: If a `SnapshotStore` is configured, call `snapshotStore.load(aggregateName, command.targetAggregateId)` first. If a snapshot is found and the persistence implements `PartialEventLoad`, call `persistence.loadAfterVersion(aggregateName, id, snapshot.version)` to load only post-snapshot events. If the persistence does not implement `PartialEventLoad`, call `persistence.load(aggregateName, id)` and slice the result: `events.slice(snapshot.version)`. Derive `version = snapshot.version + loadedEvents.length`. Replay only the post-snapshot events through `Aggregate.apply` handlers, starting from `snapshot.state`.
   - **Event-sourced (without snapshot)**: Call `persistence.load(aggregateName, command.targetAggregateId)` to get the full event stream. Derive `version = events.length`. Replay all events through `Aggregate.apply` handlers, starting from `Aggregate.initialState`, to rebuild the current state.
   - **State-stored**: Call `persistence.load(aggregateName, command.targetAggregateId)` to get `{ state, version }` or `null`. If `null`, use `Aggregate.initialState` with `version = 0`.
3. **Execute** -- Invoke the aggregate's command handler: `aggregate.commands[command.name](command, currentState, infrastructure)`. The handler returns one or more events.
4. **Apply** -- For each returned event, apply it to the state via `aggregate.apply[event.name](event.payload, state)` to compute the new state. This ensures the aggregate's in-memory state is consistent with the events.
5. **Persist** -- Save the results with optimistic concurrency:
   - **Event-sourced**: Call `persistence.save(aggregateName, command.targetAggregateId, newEvents, version)` to append the new events. `version` is the stream length observed at load time.
   - **State-stored**: Call `persistence.save(aggregateName, command.targetAggregateId, newState, version)` to store the updated state. `version` is the version observed at load time.
6. **Publish** -- For each new event, call `eventBus.dispatch(event)`. This triggers projections and sagas.
7. **Snapshot (best-effort)** -- After successful persistence and before returning, if both a `SnapshotStore` and `SnapshotStrategy` are configured, evaluate the strategy with `{ version: newVersion, lastSnapshotVersion, eventsSinceSnapshot }`. If the strategy returns `true`, save a snapshot with the new state and version. Snapshot saving is best-effort: failures are silently ignored and do not affect the command result.
8. **Return** -- Return `command.targetAggregateId`.

### Domain.dispatchCommand() -- Concurrency Strategy (Strategy Pattern)

The domain delegates concurrency control to a `ConcurrencyStrategy` instance, constructed during `init()` based on `aggregateConcurrency` configuration. The strategy wraps the command attempt — the Domain itself has no concurrency-specific branching.

**Strategy interface** (engine-internal, not exported):

```ts
interface ConcurrencyStrategy {
  execute(
    aggregateName: string,
    aggregateId: string,
    attempt: () => Promise<Event[]>,
  ): Promise<Event[]>;
}
```

**Optimistic strategy** (`{ strategy: "optimistic", maxRetries }` or `{ maxRetries }` without `strategy`):

1. **Retry loop** -- Executes the `attempt` callback up to `1 + maxRetries` times. On `ConcurrencyError`, retries with a fresh UoW. Non-`ConcurrencyError` exceptions propagate immediately.
2. **Max retries exhausted** -- The `ConcurrencyError` from the last attempt propagates.
3. **Handler re-execution** -- Command handlers may be called multiple times during retry. Handlers should be side-effect-free (the Decider pattern already implies this).

**Pessimistic strategy** (`{ strategy: "pessimistic", locker, lockTimeoutMs? }`):

1. **Lock acquisition** -- Before executing the attempt, acquires an exclusive lock via `locker.acquire(aggregateName, aggregateId, lockTimeoutMs)`.
2. **Single attempt** -- Executes the attempt callback once (no retry loop). The lock prevents concurrent access, so `ConcurrencyError` should not occur (the version check on `save()` remains as a safety net).
3. **Lock release** -- Always releases the lock in a `finally` block, even if the attempt throws.
4. **Lock timeout** -- If the lock cannot be acquired within `lockTimeoutMs`, throws `LockTimeoutError` (not retried).

**Both strategies apply to both UoW paths**:

- **Implicit UoW** (normal commands): The strategy wraps the full attempt including UoW creation and commit.
- **Explicit UoW** (`withUnitOfWork`): The strategy wraps just the lifecycle call (not UoW creation/commit). For optimistic, this is a pass-through since `ConcurrencyError` happens at commit time (outside the strategy). For pessimistic, the lock still serializes access to the aggregate during the load phase.

**Backward compatibility**: `aggregateConcurrency: { maxRetries: 3 }` (without `strategy` field) defaults to optimistic. Omitting `aggregateConcurrency` entirely defaults to optimistic with 0 retries.

### Domain.dispatchCommand() -- Idempotent Command Processing

When an `IdempotencyStore` is configured (via `DomainConfiguration.infrastructure.idempotencyStore`) and a command carries a `commandId`, the domain engine enforces idempotent processing:

1. **Idempotency check** (before concurrency strategy, before Load) — If `idempotencyStore` is configured AND `command.commandId != null`:
   - Call `idempotencyStore.exists(command.commandId)`.
   - If `true`: return `command.targetAggregateId` immediately. Skip all subsequent steps — no load, no execute, no persist, no publish.
   - If `false`: proceed with the normal command lifecycle.
2. **Idempotency record save** (after event persistence, within the same UoW) — If `command.commandId != null` and the command is being processed (not a duplicate):
   - Enlist `idempotencyStore.save({ commandId, aggregateName, aggregateId, processedAt })` in the UoW, after the event persistence enlistment.
   - This ensures atomicity: the idempotency record is only persisted if event persistence succeeds.
3. **Bypass conditions** — Idempotency is skipped entirely when:
   - `idempotencyStore` is not configured (no store factory in `DomainConfiguration`).
   - `command.commandId` is `undefined` or not present on the command object.

### Saga Event Handling Lifecycle

When an event arrives on the event bus for a registered saga:

1. **Derive saga instance ID** -- Call `saga.associations[event.name](event)` to get the saga instance ID.
2. **Load saga state** -- Call `sagaPersistence.load(sagaName, sagaId)`.
3. **Bootstrap or resume** -- If state is `null`/`undefined`:
   - If `event.name` is in `saga.startedBy`, use `saga.initialState` as the current state.
   - Otherwise, ignore the event (the saga has not been started yet).
4. **Execute handler** -- Call `saga.handlers[event.name](event, currentState, infrastructure)`. Returns a `SagaReaction` with new state and optional commands.
5. **Persist saga state** -- Call `sagaPersistence.save(sagaName, sagaId, reaction.state)`.
6. **Dispatch commands** -- For each command in `reaction.commands`, dispatch it through the command bus.

### Domain.dispatchQuery() -- Query Dispatch

The `dispatchQuery` method delegates query dispatch to the underlying query bus:

1. **Delegate** -- Call `this._infrastructure.queryBus.dispatch(query)`.
2. **Return** -- Return the result from the query bus.

`dispatchQuery` is a thin convenience wrapper. It performs no validation, error wrapping, or routing logic beyond delegation. Error propagation, handler lookup, and routing are the responsibility of the query bus implementation.

### Domain.startOutboxRelay() / stopOutboxRelay() / processOutboxOnce() -- Outbox Lifecycle

When `infrastructure.outbox` is configured:

1. **startOutboxRelay()** -- Starts the `OutboxRelay` background polling. Throws `Error("Outbox relay requires outbox configuration")` if outbox is not configured.
2. **stopOutboxRelay()** -- Stops the relay polling. No-op if outbox is not configured or relay is not running.
3. **processOutboxOnce()** -- Delegates to `OutboxRelay.processOnce()`. Returns the number of entries dispatched. Throws if outbox is not configured.

### Domain.withUnitOfWork() -- Outbox Post-Dispatch Marking

When outbox is configured, after the explicit UoW commits and events are dispatched, call `outboxStore.markPublishedByEventIds(eventIds)` (best-effort, errors swallowed). This marks the outbox entries written during the UoW as published, preventing the relay from re-dispatching them.

### defineDomain() -- Identity Function

1. Accept a `DomainDefinition` object.
2. Return the same object unchanged with full type inference.
3. This is a **sync** function — no async, no side effects, no factories called.
4. Consistent with `defineAggregate`, `defineProjection`, `defineSaga`.

### wireDomain() -- Factory Function

1. Accept a `DomainDefinition` and an **optional** `DomainWiring` (defaults to `{}`).
2. **Resolve aggregate wiring** — Determine global vs per-aggregate mode:
   - If `wiring.aggregates` is undefined, use defaults (in-memory event-sourced, no concurrency, no snapshots).
   - If `wiring.aggregates` has a `persistence`, `concurrency`, or `snapshots` key at the top level, it is **global mode** — apply the same config to all aggregates.
   - Otherwise, it is **per-aggregate mode** — each key is an aggregate name mapped to its `AggregateWiring`. Validate that every aggregate in `definition.writeModel.aggregates` has a corresponding entry and that no unknown aggregate names are present. Throw a descriptive error on mismatch.
3. **Resolve projection wiring** — For each projection in `definition.readModel.projections`:
   - If `wiring.projections[name]` exists, use its `viewStore` factory.
   - Otherwise, fall back to the deprecated `Projection.viewStore` field if present.
   - If neither is set and the projection has `identity`, throw an error (same as today).
4. Map the resolved wiring into the internal `Domain` constructor format.
5. Create a new `Domain` instance.
6. Call `domain.init()`.
7. Return the initialized domain.

### Domain.init() -- In-Memory Default Warnings

During `init()`, the domain must log a `console.warn` for each infrastructure component that falls back to an in-memory default. These warnings alert developers that the current configuration is not production-ready. Each warning follows the format `[noddde] Using in-memory <component>. This is not suitable for production.`

Warnings are logged for:

1. **Aggregate persistence** — When `aggregatePersistence` is omitted (global default `InMemoryEventSourcedAggregatePersistence`). Logged once, not per-aggregate.
2. **CQRS buses** — When `cqrsInfrastructure` / `buses` is omitted (default `InMemoryCommandBus`, `EventEmitterEventBus`, `InMemoryQueryBus`). Logged as a single warning covering all three buses.
3. **Saga persistence** — When `processModel` has sagas and `sagaPersistence` is omitted (default `InMemorySagaPersistence`).

Warnings are **not** logged for:

- Optional components that are simply not configured (snapshots, idempotency, outbox, unit of work) — omitting these is a valid production choice.
- User-provided infrastructure (`provideInfrastructure` / `infrastructure`) — `{}` is a valid default when aggregates don't need external services.
- Components where the user explicitly provides a factory that happens to return an in-memory implementation — the framework only warns when **it** supplies the default.

### configureDomain() -- Deprecated Factory Function

1. **@deprecated** — Use `defineDomain` + `wireDomain` instead.
2. Internally split its `DomainConfiguration` into a `DomainDefinition` (writeModel, readModel, processModel) and a `DomainWiring` (infrastructure fields mapped to the new shape).
3. Delegate to `wireDomain(definition, wiring)`.
4. Return the initialized domain.

### Per-Aggregate Concurrency Strategy

When `wiring.aggregates` is per-aggregate, each aggregate can have its own concurrency config:

1. For each aggregate, construct its `ConcurrencyStrategy` based on its `AggregateWiring.concurrency`:
   - `undefined` → default (optimistic with 0 retries)
   - `{ strategy?: "optimistic", maxRetries }` → `OptimisticConcurrencyStrategy`
   - `{ strategy: "pessimistic", locker, lockTimeoutMs? }` → `PessimisticConcurrencyStrategy`
2. Store as a `Map<string, ConcurrencyStrategy>` (or resolver pattern).
3. During command dispatch, look up the strategy for the target aggregate.

In global mode, the same strategy applies to all aggregates (existing behavior).

### Per-Aggregate Snapshots

When `wiring.aggregates` is per-aggregate, each aggregate can have its own snapshot config:

1. For each aggregate with `AggregateWiring.snapshots` configured, resolve the `snapshotStore` factory and store the `snapshotStrategy`.
2. During command dispatch, look up the snapshot config for the target aggregate.
3. Aggregates without `snapshots` configured skip snapshot logic entirely.

In global mode, the same snapshot config applies to all event-sourced aggregates (existing behavior).

## Invariants

- `Domain.infrastructure` must not be accessed before `init()` completes. The `!` non-null assertion on the private fields indicates they are set during init.
- `dispatchQuery` must not be called before `init()` completes. The `_infrastructure` field (including the query bus) is not assigned until `init()` runs.
- `init()` must be called exactly once. Calling it multiple times may re-register handlers, causing duplicate processing.
- `configureDomain` always returns an initialized domain. If `init()` throws, the promise rejects. (Deprecated — same guarantee applies to `wireDomain`.)
- `wireDomain` always returns an initialized domain. If `init()` throws, the promise rejects.
- `defineDomain` is sync, pure, and has no side effects. It returns the input unchanged.
- The command bus enforces single-handler-per-command-name. If two aggregates define handlers for the same command name, registration must fail.
- Events are published only after successful persistence. If persistence fails, events must not be published (to avoid inconsistency between the store and downstream subscribers).
- The order of event publication matches the order of events returned by the command handler.
- When idempotency is active, the idempotency record and event persistence MUST be in the same UoW transaction. If event persistence fails, the idempotency record must not be saved.
- Duplicate commands (same `commandId`, already processed) must produce zero side effects: no events persisted, no state changes, no events published.

## Edge Cases

- **No aggregates configured** -- `writeModel.aggregates` can be `{}`. The domain can still serve queries via standalone query handlers.
- **No projections configured** -- `readModel.projections` can be `{}`. The domain can still dispatch commands.
- **No sagas configured** -- `processModel` can be omitted. No saga listeners are registered.
- **No custom infrastructure** -- `provideInfrastructure` can be omitted. The domain uses `{}` as the custom infrastructure.
- **No CQRS infrastructure provided** -- `cqrsInfrastructure` can be omitted. The domain creates default in-memory buses.
- **No persistence provided** -- `aggregatePersistence` can be omitted. The domain uses a default in-memory event-sourced persistence for all aggregates via `GlobalAggregatePersistenceResolver`.
- **Per-aggregate persistence with missing aggregate** -- If the per-aggregate record is missing an entry for a registered aggregate, `init()` throws an error listing the missing aggregate names.
- **Per-aggregate persistence with unknown aggregate name** -- If the per-aggregate record contains a key that does not match any registered aggregate, `init()` throws an error listing the unknown names.
- **Per-aggregate persistence with mixed strategies** -- Some aggregates event-sourced, others state-stored. Snapshots only apply to event-sourced aggregates; the existing `isEventSourced` check in `CommandLifecycleExecutor` handles this correctly.
- **Per-aggregate factory throws during init** -- The error propagates through `configureDomain` and the domain is not usable (same as existing factory error behavior).
- **Command handler returns a single event** -- Must be normalized to an array before processing.
- **Command handler returns empty array** -- No events to apply, persist, or publish. The aggregate state remains unchanged.
- **Saga handler returns no commands** -- `reaction.commands` is `undefined` or empty. Only the saga state is persisted; no commands are dispatched.
- **init() factory throws** -- The error propagates through `configureDomain` and the domain is not usable.
- **Circular saga-command loops** -- A saga dispatches a command that produces an event that triggers the same saga. The framework does not prevent infinite loops; the saga handler must include termination logic (e.g., checking state to avoid re-dispatching).
- **No outbox configured** -- `startOutboxRelay()` and `processOutboxOnce()` throw. `stopOutboxRelay()` is a no-op. No outbox entries are created during command dispatch.
- **Outbox configured but relay not started** -- Outbox entries are still written atomically during command dispatch. They accumulate until the relay is started or `processOutboxOnce()` is called manually.
- **markPublishedByEventIds fails after dispatch** -- Error is swallowed (best-effort). The relay will eventually mark the entries as published on its next poll cycle.
- **dispatchQuery with no handler registered** -- The error from the query bus (e.g., "No handler registered for query: \<name\>") propagates unchanged through `dispatchQuery`.
- **dispatchQuery handler throws** -- The handler error propagates through `dispatchQuery` unchanged.
- **Command with `commandId` but no `idempotencyStore` configured** -- Processed normally, `commandId` is ignored.
- **Command without `commandId` with `idempotencyStore` configured** -- Processed normally, idempotency check is bypassed.
- **Concurrent duplicate commands** -- The first to commit wins. The second will either be caught by `exists()` (if the first committed before the second checks) or by persistence version check (if both proceed concurrently).
- **wireDomain with no wiring argument** -- `wireDomain(definition)` works identically to `wireDomain(definition, {})`. All infrastructure defaults to in-memory implementations with startup warnings logged.
- **wireDomain with empty wiring** -- `wireDomain(definition, {})` uses all defaults: in-memory persistence, in-memory buses, no concurrency, no snapshots, no custom infrastructure. Startup warnings are logged for defaulted components.
- **wireDomain with global aggregate config** -- All aggregates share the same persistence, concurrency, and snapshot settings.
- **wireDomain with per-aggregate config, missing aggregate** -- If the per-aggregate record is missing an entry for a registered aggregate, `wireDomain` (during `init()`) throws an error listing the missing aggregate names.
- **wireDomain with per-aggregate config, unknown aggregate** -- If the per-aggregate record contains a key that does not match any registered aggregate, `wireDomain` (during `init()`) throws an error listing the unknown names.
- **wireDomain with per-aggregate mixed concurrency** -- One aggregate optimistic, another pessimistic. Each uses its own strategy independently.
- **wireDomain with per-aggregate snapshots on state-stored aggregate** -- Snapshots are silently ignored for state-stored aggregates (existing behavior, now per-aggregate).
- **wireDomain projection viewStore overrides deprecated Projection.viewStore** -- If both `wiring.projections[name].viewStore` and `Projection.viewStore` are set, the wiring version takes priority.
- **wireDomain projection viewStore not provided for projection with identity** -- Throws an error (same as today when `Projection.viewStore` is missing for a projection with `identity`).
- **defineDomain called multiple times** -- Each call returns a fresh reference. No state is shared between calls.

## Integration Points

- **CQRS buses** -- The domain owns the command bus, query bus, and event bus. They are wired during init and exposed via `domain.infrastructure`.
- **Persistence** -- The domain resolves aggregate persistence during init from factory functions, building an `AggregatePersistenceResolver` (either `GlobalAggregatePersistenceResolver` or `PerAggregatePersistenceResolver`). The resolver is passed to `CommandLifecycleExecutor`. Saga persistence is resolved separately.
- **CommandLifecycleExecutor** -- Internal executor that handles the full aggregate command lifecycle (load, execute, apply, enrich, persist, publish). Created during `init()` and used by `dispatchCommand()` and command bus handlers.
- **SagaExecutor** -- Internal executor that handles the saga event handling lifecycle (derive ID, load state, bootstrap/resume, execute handler, dispatch commands atomically). Created during `init()` when `processModel` is configured.
- **MetadataEnricher** -- Internal helper that enriches raw events with metadata (eventId, timestamp, correlationId, causationId, userId, aggregate context). Used by `CommandLifecycleExecutor`.
- **Projections** -- The domain reads `Projection.on` and `Projection.queryHandlers` to wire event listeners and query handlers.
- **External consumers** -- Applications interact with the domain via `domain.dispatchCommand(command)` and `domain.dispatchQuery(query)`. The query bus remains accessible directly via `domain.infrastructure.queryBus` for advanced use cases.

## Test Scenarios

### configureDomain creates and initializes a domain

```ts
import { describe, it, expect } from "vitest";
import {
  configureDomain,
  Domain,
  EventEmitterEventBus,
  InMemoryCommandBus,
  InMemoryQueryBus,
} from "@noddde/core";
import type { Infrastructure, CQRSInfrastructure } from "@noddde/core";

describe("configureDomain", () => {
  it("should return an initialized Domain instance", async () => {
    const domain = await configureDomain<Infrastructure>({
      writeModel: { aggregates: {} },
      readModel: { projections: {} },
      infrastructure: {
        cqrsInfrastructure: () => ({
          commandBus: new InMemoryCommandBus(),
          eventBus: new EventEmitterEventBus(),
          queryBus: new InMemoryQueryBus(),
        }),
      },
    });

    expect(domain).toBeInstanceOf(Domain);
    expect(domain.infrastructure.commandBus).toBeInstanceOf(InMemoryCommandBus);
    expect(domain.infrastructure.eventBus).toBeInstanceOf(EventEmitterEventBus);
    expect(domain.infrastructure.queryBus).toBeInstanceOf(InMemoryQueryBus);
  });
});
```

### init resolves custom infrastructure and merges with CQRS buses

```ts
import { describe, it, expect } from "vitest";
import {
  configureDomain,
  EventEmitterEventBus,
  InMemoryCommandBus,
  InMemoryQueryBus,
} from "@noddde/core";

interface TestInfrastructure {
  clock: { now(): Date };
}

describe("Domain.init", () => {
  it("should merge custom infrastructure with CQRS infrastructure", async () => {
    const fixedDate = new Date("2025-01-01T00:00:00Z");

    const domain = await configureDomain<TestInfrastructure>({
      writeModel: { aggregates: {} },
      readModel: { projections: {} },
      infrastructure: {
        provideInfrastructure: () => ({
          clock: { now: () => fixedDate },
        }),
        cqrsInfrastructure: () => ({
          commandBus: new InMemoryCommandBus(),
          eventBus: new EventEmitterEventBus(),
          queryBus: new InMemoryQueryBus(),
        }),
      },
    });

    expect(domain.infrastructure.clock.now()).toBe(fixedDate);
    expect(domain.infrastructure.commandBus).toBeDefined();
    expect(domain.infrastructure.eventBus).toBeDefined();
    expect(domain.infrastructure.queryBus).toBeDefined();
  });
});
```

### dispatchCommand executes the full aggregate lifecycle

```ts
import { describe, it, expect, vi } from "vitest";
import {
  configureDomain,
  defineAggregate,
  EventEmitterEventBus,
  InMemoryCommandBus,
  InMemoryQueryBus,
  InMemoryEventSourcedAggregatePersistence,
} from "@noddde/core";
import type {
  DefineCommands,
  DefineEvents,
  AggregateTypes,
  Infrastructure,
} from "@noddde/core";

type CounterState = { count: number };

type CounterEvent = DefineEvents<{
  CounterCreated: { id: string };
  Incremented: { by: number };
}>;

type CounterCommand = DefineCommands<{
  CreateCounter: void;
  Increment: { by: number };
}>;

type CounterTypes = AggregateTypes & {
  state: CounterState;
  events: CounterEvent;
  commands: CounterCommand;
  infrastructure: Infrastructure;
};

const Counter = defineAggregate<CounterTypes>({
  initialState: { count: 0 },
  commands: {
    CreateCounter: (command) => ({
      name: "CounterCreated",
      payload: { id: command.targetAggregateId },
    }),
    Increment: (command) => ({
      name: "Incremented",
      payload: { by: command.payload.by },
    }),
  },
  apply: {
    CounterCreated: (_payload, state) => state,
    Incremented: (payload, state) => ({ count: state.count + payload.by }),
  },
});

describe("Domain.dispatchCommand", () => {
  it("should load, execute, apply, persist, and publish", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();
    const eventBus = new EventEmitterEventBus();
    const publishedEvents: any[] = [];

    // @ts-expect-error -- accessing private for test observation
    eventBus.underlying.on("CounterCreated", (payload: any) => {
      publishedEvents.push({ name: "CounterCreated", payload });
    });
    // @ts-expect-error -- accessing private for test observation
    eventBus.underlying.on("Incremented", (payload: any) => {
      publishedEvents.push({ name: "Incremented", payload });
    });

    const domain = await configureDomain<Infrastructure>({
      writeModel: {
        aggregates: { Counter },
      },
      readModel: { projections: {} },
      infrastructure: {
        aggregatePersistence: () => persistence,
        cqrsInfrastructure: () => ({
          commandBus: new InMemoryCommandBus(),
          eventBus,
          queryBus: new InMemoryQueryBus(),
        }),
      },
    });

    // Create the counter
    const id = await domain.dispatchCommand({
      name: "CreateCounter",
      targetAggregateId: "counter-1",
    });
    expect(id).toBe("counter-1");

    // Increment it
    await domain.dispatchCommand({
      name: "Increment",
      targetAggregateId: "counter-1",
      payload: { by: 5 },
    });

    // Verify events were persisted
    const events = await persistence.load("Counter", "counter-1");
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({
      name: "CounterCreated",
      payload: { id: "counter-1" },
    });
    expect(events[1]).toEqual({
      name: "Incremented",
      payload: { by: 5 },
    });

    // Verify events were published
    expect(publishedEvents).toHaveLength(2);
  });
});
```

### dispatchCommand rebuilds state from event stream before executing

```ts
import { describe, it, expect } from "vitest";
import {
  configureDomain,
  defineAggregate,
  EventEmitterEventBus,
  InMemoryCommandBus,
  InMemoryQueryBus,
  InMemoryEventSourcedAggregatePersistence,
} from "@noddde/core";
import type {
  DefineCommands,
  DefineEvents,
  AggregateTypes,
  Infrastructure,
} from "@noddde/core";

type BalanceState = { balance: number };

type BalanceEvent = DefineEvents<{
  AccountOpened: { id: string };
  DepositMade: { amount: number };
}>;

type BalanceCommand = DefineCommands<{
  OpenAccount: void;
  Deposit: { amount: number };
}>;

type BalanceTypes = AggregateTypes & {
  state: BalanceState;
  events: BalanceEvent;
  commands: BalanceCommand;
  infrastructure: Infrastructure;
};

const BankAccount = defineAggregate<BalanceTypes>({
  initialState: { balance: 0 },
  commands: {
    OpenAccount: (cmd) => ({
      name: "AccountOpened",
      payload: { id: cmd.targetAggregateId },
    }),
    Deposit: (cmd, state) => {
      // This proves state was rebuilt: the handler can read current balance
      return {
        name: "DepositMade",
        payload: { amount: cmd.payload.amount },
      };
    },
  },
  apply: {
    AccountOpened: (_p, state) => state,
    DepositMade: (payload, state) => ({
      balance: state.balance + payload.amount,
    }),
  },
});

describe("Domain.dispatchCommand", () => {
  it("should replay events to rebuild state before executing a command", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();

    const domain = await configureDomain<Infrastructure>({
      writeModel: { aggregates: { BankAccount } },
      readModel: { projections: {} },
      infrastructure: {
        aggregatePersistence: () => persistence,
        cqrsInfrastructure: () => ({
          commandBus: new InMemoryCommandBus(),
          eventBus: new EventEmitterEventBus(),
          queryBus: new InMemoryQueryBus(),
        }),
      },
    });

    await domain.dispatchCommand({
      name: "OpenAccount",
      targetAggregateId: "acc-1",
    });
    await domain.dispatchCommand({
      name: "Deposit",
      targetAggregateId: "acc-1",
      payload: { amount: 100 },
    });
    await domain.dispatchCommand({
      name: "Deposit",
      targetAggregateId: "acc-1",
      payload: { amount: 50 },
    });

    // After three commands, there should be three events
    const events = await persistence.load("BankAccount", "acc-1");
    expect(events).toHaveLength(3);

    // The state was rebuilt correctly before each Deposit command:
    // After first deposit: balance = 100
    // After second deposit: balance = 150 (rebuilt from replaying all prior events)
    expect(events[2]).toEqual({
      name: "DepositMade",
      payload: { amount: 50 },
    });
  });
});
```

### projection query handlers are wired to the query bus

```ts
import { describe, it, expect, vi } from "vitest";
import {
  configureDomain,
  defineProjection,
  EventEmitterEventBus,
  InMemoryCommandBus,
  InMemoryQueryBus,
} from "@noddde/core";
import type {
  DefineEvents,
  DefineQueries,
  ProjectionTypes,
  Infrastructure,
  Query,
} from "@noddde/core";

type ItemEvent = DefineEvents<{
  ItemAdded: { id: string; name: string };
}>;

type ItemQuery = DefineQueries<{
  GetItemById: {
    payload: { id: string };
    result: { id: string; name: string } | null;
  };
}>;

type ItemProjectionTypes = ProjectionTypes & {
  events: ItemEvent;
  queries: ItemQuery;
  view: Map<string, { id: string; name: string }>;
  infrastructure: Infrastructure;
};

const ItemProjection = defineProjection<ItemProjectionTypes>({
  on: {
    ItemAdded: {
      reduce: (event, view) => {
        view.set(event.payload.id, event.payload);
        return view;
      },
    },
  },
  queryHandlers: {
    GetItemById: (payload) => {
      // In a real implementation, this would read from a repository
      return payload?.id === "item-1" ? { id: "item-1", name: "Widget" } : null;
    },
  },
});

describe("Domain.init - projection query handler registration", () => {
  it("should wire projection query handlers to the query bus", async () => {
    const domain = await configureDomain<Infrastructure>({
      writeModel: { aggregates: {} },
      readModel: { projections: { ItemProjection } },
      infrastructure: {
        cqrsInfrastructure: () => ({
          commandBus: new InMemoryCommandBus(),
          eventBus: new EventEmitterEventBus(),
          queryBus: new InMemoryQueryBus(),
        }),
      },
    });

    const result = await domain.infrastructure.queryBus.dispatch({
      name: "GetItemById",
      payload: { id: "item-1" },
    } as ItemQuery);

    expect(result).toEqual({ id: "item-1", name: "Widget" });
  });
});
```

### saga reacts to events and dispatches commands

```ts
import { describe, it, expect, vi } from "vitest";
import {
  configureDomain,
  defineAggregate,
  defineSaga,
  EventEmitterEventBus,
  InMemoryCommandBus,
  InMemoryQueryBus,
  InMemoryEventSourcedAggregatePersistence,
  InMemorySagaPersistence,
} from "@noddde/core";
import type {
  DefineCommands,
  DefineEvents,
  AggregateTypes,
  SagaTypes,
  Infrastructure,
} from "@noddde/core";

// -- Order aggregate --
type OrderEvent = DefineEvents<{
  OrderPlaced: { orderId: string; total: number };
  OrderConfirmed: { orderId: string };
}>;
type OrderCommand = DefineCommands<{
  PlaceOrder: { total: number };
  ConfirmOrder: void;
}>;
type OrderState = { status: string; total: number };
type OrderTypes = AggregateTypes & {
  state: OrderState;
  events: OrderEvent;
  commands: OrderCommand;
  infrastructure: Infrastructure;
};

const OrderAggregate = defineAggregate<OrderTypes>({
  initialState: { status: "new", total: 0 },
  commands: {
    PlaceOrder: (cmd) => ({
      name: "OrderPlaced",
      payload: { orderId: cmd.targetAggregateId, total: cmd.payload.total },
    }),
    ConfirmOrder: (cmd) => ({
      name: "OrderConfirmed",
      payload: { orderId: cmd.targetAggregateId },
    }),
  },
  apply: {
    OrderPlaced: (payload, state) => ({
      ...state,
      status: "placed",
      total: payload.total,
    }),
    OrderConfirmed: (_payload, state) => ({
      ...state,
      status: "confirmed",
    }),
  },
});

// -- Saga that confirms orders automatically --
type FulfillmentState = { confirmed: boolean };
type FulfillmentSagaTypes = SagaTypes & {
  state: FulfillmentState;
  events: OrderEvent;
  commands: OrderCommand;
  infrastructure: Infrastructure;
};

const OrderFulfillmentSaga = defineSaga<FulfillmentSagaTypes>({
  initialState: { confirmed: false },
  startedBy: ["OrderPlaced"],
  associations: {
    OrderPlaced: (event) => event.payload.orderId,
    OrderConfirmed: (event) => event.payload.orderId,
  },
  handlers: {
    OrderPlaced: (event, state) => ({
      state: { ...state, confirmed: false },
      commands: {
        name: "ConfirmOrder",
        targetAggregateId: event.payload.orderId,
      },
    }),
    OrderConfirmed: (_event, state) => ({
      state: { ...state, confirmed: true },
    }),
  },
});

describe("Domain - saga integration", () => {
  it("should execute saga handler when aggregate events are published", async () => {
    const sagaPersistence = new InMemorySagaPersistence();
    const aggregatePersistence = new InMemoryEventSourcedAggregatePersistence();

    const domain = await configureDomain<Infrastructure>({
      writeModel: { aggregates: { OrderAggregate } },
      readModel: { projections: {} },
      processModel: { sagas: { OrderFulfillmentSaga } },
      infrastructure: {
        aggregatePersistence: () => aggregatePersistence,
        sagaPersistence: () => sagaPersistence,
        cqrsInfrastructure: () => ({
          commandBus: new InMemoryCommandBus(),
          eventBus: new EventEmitterEventBus(),
          queryBus: new InMemoryQueryBus(),
        }),
      },
    });

    // Place an order -- should trigger the saga
    await domain.dispatchCommand({
      name: "PlaceOrder",
      targetAggregateId: "order-1",
      payload: { total: 99 },
    });

    // Verify the saga persisted its state
    const sagaState = await sagaPersistence.load(
      "OrderFulfillmentSaga",
      "order-1",
    );
    expect(sagaState).toBeDefined();

    // Verify the saga dispatched the ConfirmOrder command,
    // which should have produced an OrderConfirmed event
    const events = await aggregatePersistence.load("OrderAggregate", "order-1");
    const eventNames = events.map((e) => e.name);
    expect(eventNames).toContain("OrderPlaced");
    expect(eventNames).toContain("OrderConfirmed");
  });
});
```

### init throws when a factory function fails

```ts
import { describe, it, expect } from "vitest";
import { configureDomain } from "@noddde/core";
import type { Infrastructure } from "@noddde/core";

describe("configureDomain - error handling", () => {
  it("should propagate errors from infrastructure factories", async () => {
    await expect(
      configureDomain<Infrastructure>({
        writeModel: { aggregates: {} },
        readModel: { projections: {} },
        infrastructure: {
          provideInfrastructure: () => {
            throw new Error("Database connection failed");
          },
        },
      }),
    ).rejects.toThrow("Database connection failed");
  });
});
```

### domain works with state-stored persistence

```ts
import { describe, it, expect } from "vitest";
import {
  configureDomain,
  defineAggregate,
  EventEmitterEventBus,
  InMemoryCommandBus,
  InMemoryQueryBus,
  InMemoryStateStoredAggregatePersistence,
} from "@noddde/core";
import type {
  DefineCommands,
  DefineEvents,
  AggregateTypes,
  Infrastructure,
} from "@noddde/core";

type TodoState = { items: string[] };
type TodoEvent = DefineEvents<{
  TodoAdded: { item: string };
}>;
type TodoCommand = DefineCommands<{
  AddTodo: { item: string };
}>;
type TodoTypes = AggregateTypes & {
  state: TodoState;
  events: TodoEvent;
  commands: TodoCommand;
  infrastructure: Infrastructure;
};

const TodoList = defineAggregate<TodoTypes>({
  initialState: { items: [] },
  commands: {
    AddTodo: (cmd) => ({
      name: "TodoAdded",
      payload: { item: cmd.payload.item },
    }),
  },
  apply: {
    TodoAdded: (payload, state) => ({
      items: [...state.items, payload.item],
    }),
  },
});

describe("Domain - state-stored persistence", () => {
  it("should use state-stored persistence to save aggregate snapshots", async () => {
    const persistence = new InMemoryStateStoredAggregatePersistence();

    const domain = await configureDomain<Infrastructure>({
      writeModel: { aggregates: { TodoList } },
      readModel: { projections: {} },
      infrastructure: {
        aggregatePersistence: () => persistence,
        cqrsInfrastructure: () => ({
          commandBus: new InMemoryCommandBus(),
          eventBus: new EventEmitterEventBus(),
          queryBus: new InMemoryQueryBus(),
        }),
      },
    });

    await domain.dispatchCommand({
      name: "AddTodo",
      targetAggregateId: "list-1",
      payload: { item: "Buy milk" },
    });
    await domain.dispatchCommand({
      name: "AddTodo",
      targetAggregateId: "list-1",
      payload: { item: "Walk dog" },
    });

    const state = await persistence.load("TodoList", "list-1");
    expect(state).toEqual({ items: ["Buy milk", "Walk dog"] });
  });
});
```

### standalone command handlers receive merged infrastructure

```ts
import { describe, it, expect, vi } from "vitest";
import {
  configureDomain,
  EventEmitterEventBus,
  InMemoryCommandBus,
  InMemoryQueryBus,
} from "@noddde/core";
import type { Infrastructure, CQRSInfrastructure } from "@noddde/core";

interface NotificationInfrastructure extends Infrastructure {
  notifier: { send(message: string): void };
}

type NotifyCommand = {
  name: "SendNotification";
  payload: { message: string };
};

describe("Domain - standalone command handlers", () => {
  it("should invoke standalone handler with merged infrastructure", async () => {
    const sendSpy = vi.fn();

    const domain = await configureDomain<
      NotificationInfrastructure,
      NotifyCommand
    >({
      writeModel: {
        aggregates: {},
        standaloneCommandHandlers: {
          SendNotification: (command, infra) => {
            infra.notifier.send(command.payload.message);
          },
        },
      },
      readModel: { projections: {} },
      infrastructure: {
        provideInfrastructure: () => ({
          notifier: { send: sendSpy },
        }),
        cqrsInfrastructure: () => ({
          commandBus: new InMemoryCommandBus(),
          eventBus: new EventEmitterEventBus(),
          queryBus: new InMemoryQueryBus(),
        }),
      },
    });

    await domain.infrastructure.commandBus.dispatch({
      name: "SendNotification",
      payload: { message: "Hello!" },
    });

    expect(sendSpy).toHaveBeenCalledWith("Hello!");
  });
});
```

### events are not published if persistence fails

```ts
import { describe, it, expect, vi } from "vitest";
import {
  configureDomain,
  defineAggregate,
  EventEmitterEventBus,
  InMemoryCommandBus,
  InMemoryQueryBus,
} from "@noddde/core";
import type {
  DefineCommands,
  DefineEvents,
  AggregateTypes,
  Infrastructure,
  EventSourcedAggregatePersistence,
  Event,
} from "@noddde/core";

type SimpleEvent = DefineEvents<{ ThingHappened: { id: string } }>;
type SimpleCommand = DefineCommands<{ DoThing: void }>;
type SimpleState = {};
type SimpleTypes = AggregateTypes & {
  state: SimpleState;
  events: SimpleEvent;
  commands: SimpleCommand;
  infrastructure: Infrastructure;
};

const SimpleAggregate = defineAggregate<SimpleTypes>({
  initialState: {},
  commands: {
    DoThing: (cmd) => ({
      name: "ThingHappened",
      payload: { id: cmd.targetAggregateId },
    }),
  },
  apply: {
    ThingHappened: (_p, state) => state,
  },
});

describe("Domain - persistence failure", () => {
  it("should not publish events when persistence save fails", async () => {
    const eventBus = new EventEmitterEventBus();
    const eventSpy = vi.fn();

    // @ts-expect-error -- accessing private for observation
    eventBus.underlying.on("ThingHappened", eventSpy);

    const failingPersistence: EventSourcedAggregatePersistence = {
      load: async () => [],
      save: async () => {
        throw new Error("Persistence failure");
      },
    };

    const domain = await configureDomain<Infrastructure>({
      writeModel: { aggregates: { SimpleAggregate } },
      readModel: { projections: {} },
      infrastructure: {
        aggregatePersistence: () => failingPersistence,
        cqrsInfrastructure: () => ({
          commandBus: new InMemoryCommandBus(),
          eventBus,
          queryBus: new InMemoryQueryBus(),
        }),
      },
    });

    await expect(
      domain.dispatchCommand({
        name: "DoThing",
        targetAggregateId: "x-1",
      }),
    ).rejects.toThrow("Persistence failure");

    // Events must NOT have been published
    expect(eventSpy).not.toHaveBeenCalled();
  });
});
```

### dispatchQuery delegates to query bus and returns typed result

```ts
import { describe, it, expect } from "vitest";
import {
  configureDomain,
  defineProjection,
  EventEmitterEventBus,
  InMemoryCommandBus,
  InMemoryQueryBus,
} from "@noddde/core";
import type {
  DefineEvents,
  DefineQueries,
  ProjectionTypes,
  Infrastructure,
} from "@noddde/core";

type ProductEvent = DefineEvents<{
  ProductAdded: { id: string; name: string; price: number };
}>;

type ProductQuery = DefineQueries<{
  GetProductById: {
    payload: { id: string };
    result: { id: string; name: string; price: number } | null;
  };
}>;

type ProductProjectionTypes = ProjectionTypes & {
  events: ProductEvent;
  queries: ProductQuery;
  view: Map<string, { id: string; name: string; price: number }>;
  infrastructure: Infrastructure;
};

const ProductProjection = defineProjection<ProductProjectionTypes>({
  on: {
    ProductAdded: {
      reduce: (event, view) => {
        view.set(event.payload.id, event.payload);
        return view;
      },
    },
  },
  queryHandlers: {
    GetProductById: (payload) => {
      return payload?.id === "prod-1"
        ? { id: "prod-1", name: "Laptop", price: 999 }
        : null;
    },
  },
});

describe("Domain.dispatchQuery", () => {
  it("should delegate to the query bus and return the handler result", async () => {
    const domain = await configureDomain<Infrastructure>({
      writeModel: { aggregates: {} },
      readModel: { projections: { ProductProjection } },
      infrastructure: {
        cqrsInfrastructure: () => ({
          commandBus: new InMemoryCommandBus(),
          eventBus: new EventEmitterEventBus(),
          queryBus: new InMemoryQueryBus(),
        }),
      },
    });

    const result = await domain.dispatchQuery({
      name: "GetProductById",
      payload: { id: "prod-1" },
    } as ProductQuery);

    expect(result).toEqual({ id: "prod-1", name: "Laptop", price: 999 });

    const nullResult = await domain.dispatchQuery({
      name: "GetProductById",
      payload: { id: "nonexistent" },
    } as ProductQuery);

    expect(nullResult).toBeNull();
  });
});
```

### dispatchQuery propagates errors when no handler is registered

```ts
import { describe, it, expect } from "vitest";
import {
  configureDomain,
  EventEmitterEventBus,
  InMemoryCommandBus,
  InMemoryQueryBus,
} from "@noddde/core";
import type { Infrastructure } from "@noddde/core";

describe("Domain.dispatchQuery - error propagation", () => {
  it("should propagate query bus errors when no handler is registered", async () => {
    const domain = await configureDomain<Infrastructure>({
      writeModel: { aggregates: {} },
      readModel: { projections: {} },
      infrastructure: {
        cqrsInfrastructure: () => ({
          commandBus: new InMemoryCommandBus(),
          eventBus: new EventEmitterEventBus(),
          queryBus: new InMemoryQueryBus(),
        }),
      },
    });

    await expect(
      domain.dispatchQuery({
        name: "NonExistentQuery",
        payload: {},
      }),
    ).rejects.toThrow("No handler registered for query: NonExistentQuery");
  });
});
```

### dispatchCommand retries on ConcurrencyError with maxRetries

```ts
import { describe, it, expect } from "vitest";
import {
  configureDomain,
  defineAggregate,
  EventEmitterEventBus,
  InMemoryCommandBus,
  InMemoryQueryBus,
  InMemoryEventSourcedAggregatePersistence,
  ConcurrencyError,
} from "@noddde/core";
import type {
  DefineCommands,
  DefineEvents,
  AggregateTypes,
  Infrastructure,
  EventSourcedAggregatePersistence,
  Event,
} from "@noddde/core";

type CounterState = { count: number };
type CounterEvent = DefineEvents<{ Incremented: { by: number } }>;
type CounterCommand = DefineCommands<{ Increment: { by: number } }>;
type CounterTypes = AggregateTypes & {
  state: CounterState;
  events: CounterEvent;
  commands: CounterCommand;
  infrastructure: Infrastructure;
};

const Counter = defineAggregate<CounterTypes>({
  initialState: { count: 0 },
  commands: {
    Increment: (cmd) => ({
      name: "Incremented",
      payload: { by: cmd.payload.by },
    }),
  },
  apply: {
    Incremented: (payload, state) => ({ count: state.count + payload.by }),
  },
});

describe("Domain.dispatchCommand - concurrency retry", () => {
  it("should retry on ConcurrencyError and succeed on second attempt", async () => {
    let saveCallCount = 0;

    // Persistence that fails on first save, succeeds on second
    const inner = new InMemoryEventSourcedAggregatePersistence();
    const wrappedPersistence: EventSourcedAggregatePersistence = {
      load: (name, id) => inner.load(name, id),
      save: async (name, id, events, expectedVersion) => {
        saveCallCount++;
        if (saveCallCount === 1) {
          // Simulate concurrent write by sneaking an event in
          await inner.save(
            name,
            id,
            [{ name: "Incremented", payload: { by: 1 } }],
            expectedVersion,
          );
          // Now the version is wrong for the original caller
          throw new ConcurrencyError(
            name,
            id,
            expectedVersion,
            expectedVersion + 1,
          );
        }
        return inner.save(name, id, events, expectedVersion);
      },
    };

    const domain = await configureDomain<Infrastructure>({
      writeModel: { aggregates: { Counter } },
      readModel: { projections: {} },
      infrastructure: {
        aggregatePersistence: () => wrappedPersistence,
        aggregateConcurrency: { maxRetries: 3 },
        cqrsInfrastructure: () => ({
          commandBus: new InMemoryCommandBus(),
          eventBus: new EventEmitterEventBus(),
          queryBus: new InMemoryQueryBus(),
        }),
      },
    });

    // Should succeed despite first attempt failing
    await domain.dispatchCommand({
      name: "Increment",
      targetAggregateId: "counter-1",
      payload: { by: 5 },
    });

    expect(saveCallCount).toBe(2);
  });

  it("should propagate ConcurrencyError when maxRetries is 0", async () => {
    const failingPersistence: EventSourcedAggregatePersistence = {
      load: async () => [],
      save: async (name, id) => {
        throw new ConcurrencyError(name, id, 0, 1);
      },
    };

    const domain = await configureDomain<Infrastructure>({
      writeModel: { aggregates: { Counter } },
      readModel: { projections: {} },
      infrastructure: {
        aggregatePersistence: () => failingPersistence,
        aggregateConcurrency: { maxRetries: 0 },
        cqrsInfrastructure: () => ({
          commandBus: new InMemoryCommandBus(),
          eventBus: new EventEmitterEventBus(),
          queryBus: new InMemoryQueryBus(),
        }),
      },
    });

    await expect(
      domain.dispatchCommand({
        name: "Increment",
        targetAggregateId: "counter-1",
        payload: { by: 5 },
      }),
    ).rejects.toThrow(ConcurrencyError);
  });
});
```

### dispatchCommand works with pessimistic locking

```ts
import { describe, it, expect } from "vitest";
import {
  configureDomain,
  defineAggregate,
  EventEmitterEventBus,
  InMemoryCommandBus,
  InMemoryQueryBus,
  InMemoryEventSourcedAggregatePersistence,
  InMemoryAggregateLocker,
} from "@noddde/core";
import type {
  DefineCommands,
  DefineEvents,
  AggregateTypes,
  Infrastructure,
} from "@noddde/core";

type CounterState = { count: number };
type CounterEvent = DefineEvents<{ Incremented: { by: number } }>;
type CounterCommand = DefineCommands<{ Increment: { by: number } }>;
type CounterTypes = AggregateTypes & {
  state: CounterState;
  events: CounterEvent;
  commands: CounterCommand;
  infrastructure: Infrastructure;
};

const Counter = defineAggregate<CounterTypes>({
  initialState: { count: 0 },
  commands: {
    Increment: (cmd) => ({
      name: "Incremented",
      payload: { by: cmd.payload.by },
    }),
  },
  apply: {
    Incremented: (payload, state) => ({ count: state.count + payload.by }),
  },
});

describe("Domain - pessimistic concurrency", () => {
  it("should execute command successfully with pessimistic locking", async () => {
    const locker = new InMemoryAggregateLocker();
    const persistence = new InMemoryEventSourcedAggregatePersistence();

    const domain = await configureDomain<Infrastructure>({
      writeModel: { aggregates: { Counter } },
      readModel: { projections: {} },
      infrastructure: {
        aggregatePersistence: () => persistence,
        aggregateConcurrency: {
          strategy: "pessimistic",
          locker,
        },
        cqrsInfrastructure: () => ({
          commandBus: new InMemoryCommandBus(),
          eventBus: new EventEmitterEventBus(),
          queryBus: new InMemoryQueryBus(),
        }),
      },
    });

    await domain.dispatchCommand({
      name: "Increment",
      targetAggregateId: "counter-1",
      payload: { by: 5 },
    });

    const events = await persistence.load("Counter", "counter-1");
    expect(events).toHaveLength(1);
  });

  it("should release lock even when command handler throws", async () => {
    const locker = new InMemoryAggregateLocker();

    const FailingAggregate = defineAggregate<CounterTypes>({
      initialState: { count: 0 },
      commands: {
        Increment: () => {
          throw new Error("handler failure");
        },
      },
      apply: {
        Incremented: (payload, state) => ({ count: state.count + payload.by }),
      },
    });

    const domain = await configureDomain<Infrastructure>({
      writeModel: { aggregates: { FailingAggregate } },
      readModel: { projections: {} },
      infrastructure: {
        aggregateConcurrency: {
          strategy: "pessimistic",
          locker,
        },
        cqrsInfrastructure: () => ({
          commandBus: new InMemoryCommandBus(),
          eventBus: new EventEmitterEventBus(),
          queryBus: new InMemoryQueryBus(),
        }),
      },
    });

    await expect(
      domain.dispatchCommand({
        name: "Increment",
        targetAggregateId: "counter-1",
        payload: { by: 5 },
      }),
    ).rejects.toThrow("handler failure");

    // Lock should be released — a second command should not hang
    await expect(
      domain.dispatchCommand({
        name: "Increment",
        targetAggregateId: "counter-1",
        payload: { by: 5 },
      }),
    ).rejects.toThrow("handler failure");
  });

  it("should serialize concurrent commands on same aggregate", async () => {
    const locker = new InMemoryAggregateLocker();
    const persistence = new InMemoryEventSourcedAggregatePersistence();

    const domain = await configureDomain<Infrastructure>({
      writeModel: { aggregates: { Counter } },
      readModel: { projections: {} },
      infrastructure: {
        aggregatePersistence: () => persistence,
        aggregateConcurrency: {
          strategy: "pessimistic",
          locker,
        },
        cqrsInfrastructure: () => ({
          commandBus: new InMemoryCommandBus(),
          eventBus: new EventEmitterEventBus(),
          queryBus: new InMemoryQueryBus(),
        }),
      },
    });

    await Promise.all([
      domain.dispatchCommand({
        name: "Increment",
        targetAggregateId: "counter-1",
        payload: { by: 1 },
      }),
      domain.dispatchCommand({
        name: "Increment",
        targetAggregateId: "counter-1",
        payload: { by: 2 },
      }),
    ]);

    const events = await persistence.load("Counter", "counter-1");
    expect(events).toHaveLength(2);
  });
});
```

### Idempotent command processing skips duplicate commands

```ts
import { describe, it, expect, vi } from "vitest";
import {
  configureDomain,
  InMemoryCommandBus,
  EventEmitterEventBus,
  InMemoryQueryBus,
  InMemoryEventSourcedAggregatePersistence,
  InMemoryIdempotencyStore,
} from "@noddde/engine";
import { defineAggregate } from "@noddde/core";
import type { Infrastructure } from "@noddde/core";

const Counter = defineAggregate({
  name: "Counter",
  initialState: { count: 0 },
  commands: {
    Increment: (command, state) => ({
      name: "Incremented" as const,
      payload: { by: command.payload.by },
    }),
  },
  apply: {
    Incremented: (payload: { by: number }, state: { count: number }) => ({
      count: state.count + payload.by,
    }),
  },
});

describe("Idempotent command processing", () => {
  it("should skip duplicate command with same commandId", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();
    const idempotencyStore = new InMemoryIdempotencyStore();

    const domain = await configureDomain<Infrastructure>({
      writeModel: { aggregates: { Counter } },
      readModel: { projections: {} },
      infrastructure: {
        aggregatePersistence: () => persistence,
        idempotencyStore: () => idempotencyStore,
        cqrsInfrastructure: () => ({
          commandBus: new InMemoryCommandBus(),
          eventBus: new EventEmitterEventBus(),
          queryBus: new InMemoryQueryBus(),
        }),
      },
    });

    // First dispatch — should process normally
    await domain.dispatchCommand({
      name: "Increment",
      targetAggregateId: "counter-1",
      payload: { by: 5 },
      commandId: "cmd-1",
    });

    // Second dispatch with same commandId — should be skipped
    await domain.dispatchCommand({
      name: "Increment",
      targetAggregateId: "counter-1",
      payload: { by: 5 },
      commandId: "cmd-1",
    });

    const events = await persistence.load("Counter", "counter-1");
    expect(events).toHaveLength(1);
  });

  it("should process first command with commandId and record it", async () => {
    const idempotencyStore = new InMemoryIdempotencyStore();

    const domain = await configureDomain<Infrastructure>({
      writeModel: { aggregates: { Counter } },
      readModel: { projections: {} },
      infrastructure: {
        idempotencyStore: () => idempotencyStore,
        cqrsInfrastructure: () => ({
          commandBus: new InMemoryCommandBus(),
          eventBus: new EventEmitterEventBus(),
          queryBus: new InMemoryQueryBus(),
        }),
      },
    });

    await domain.dispatchCommand({
      name: "Increment",
      targetAggregateId: "counter-1",
      payload: { by: 3 },
      commandId: "cmd-42",
    });

    expect(await idempotencyStore.exists("cmd-42")).toBe(true);
  });

  it("should bypass idempotency for commands without commandId", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();
    const idempotencyStore = new InMemoryIdempotencyStore();

    const domain = await configureDomain<Infrastructure>({
      writeModel: { aggregates: { Counter } },
      readModel: { projections: {} },
      infrastructure: {
        aggregatePersistence: () => persistence,
        idempotencyStore: () => idempotencyStore,
        cqrsInfrastructure: () => ({
          commandBus: new InMemoryCommandBus(),
          eventBus: new EventEmitterEventBus(),
          queryBus: new InMemoryQueryBus(),
        }),
      },
    });

    // Dispatch twice without commandId — both should process
    await domain.dispatchCommand({
      name: "Increment",
      targetAggregateId: "counter-1",
      payload: { by: 1 },
    });

    await domain.dispatchCommand({
      name: "Increment",
      targetAggregateId: "counter-1",
      payload: { by: 1 },
    });

    const events = await persistence.load("Counter", "counter-1");
    expect(events).toHaveLength(2);
  });

  it("should persist idempotency record in same UoW as events", async () => {
    const idempotencyStore = new InMemoryIdempotencyStore();
    const failingPersistence = {
      async load() {
        return [];
      },
      async save() {
        throw new Error("persistence failure");
      },
      async loadAfterVersion() {
        return [];
      },
    };

    const domain = await configureDomain<Infrastructure>({
      writeModel: { aggregates: { Counter } },
      readModel: { projections: {} },
      infrastructure: {
        aggregatePersistence: () => failingPersistence as any,
        idempotencyStore: () => idempotencyStore,
        cqrsInfrastructure: () => ({
          commandBus: new InMemoryCommandBus(),
          eventBus: new EventEmitterEventBus(),
          queryBus: new InMemoryQueryBus(),
        }),
      },
    });

    // Command should fail due to persistence failure
    await expect(
      domain.dispatchCommand({
        name: "Increment",
        targetAggregateId: "counter-1",
        payload: { by: 1 },
        commandId: "cmd-fail",
      }),
    ).rejects.toThrow("persistence failure");

    // Idempotency record should NOT have been saved (UoW rolled back)
    expect(await idempotencyStore.exists("cmd-fail")).toBe(false);
  });
});
```

### per-aggregate persistence routes each aggregate to its own persistence

```ts
import { describe, it, expect } from "vitest";
import {
  configureDomain,
  defineAggregate,
  EventEmitterEventBus,
  InMemoryCommandBus,
  InMemoryQueryBus,
  InMemoryEventSourcedAggregatePersistence,
  InMemoryStateStoredAggregatePersistence,
} from "@noddde/core";
import type {
  DefineCommands,
  DefineEvents,
  AggregateTypes,
  Infrastructure,
} from "@noddde/core";

type CounterState = { count: number };
type CounterEvent = DefineEvents<{ Incremented: { by: number } }>;
type CounterCommand = DefineCommands<{ Increment: { by: number } }>;
type CounterTypes = AggregateTypes & {
  state: CounterState;
  events: CounterEvent;
  commands: CounterCommand;
  infrastructure: Infrastructure;
};

const Counter = defineAggregate<CounterTypes>({
  initialState: { count: 0 },
  commands: {
    Increment: (cmd) => ({
      name: "Incremented",
      payload: { by: cmd.payload.by },
    }),
  },
  apply: {
    Incremented: (payload, state) => ({ count: state.count + payload.by }),
  },
});

type BalanceState = { balance: number };
type BalanceEvent = DefineEvents<{ Deposited: { amount: number } }>;
type BalanceCommand = DefineCommands<{ Deposit: { amount: number } }>;
type BalanceTypes = AggregateTypes & {
  state: BalanceState;
  events: BalanceEvent;
  commands: BalanceCommand;
  infrastructure: Infrastructure;
};

const BankAccount = defineAggregate<BalanceTypes>({
  initialState: { balance: 0 },
  commands: {
    Deposit: (cmd) => ({
      name: "Deposited",
      payload: { amount: cmd.payload.amount },
    }),
  },
  apply: {
    Deposited: (payload, state) => ({
      balance: state.balance + payload.amount,
    }),
  },
});

describe("Per-aggregate persistence", () => {
  it("should route each aggregate to its configured persistence", async () => {
    const esPersistence = new InMemoryEventSourcedAggregatePersistence();
    const ssPersistence = new InMemoryStateStoredAggregatePersistence();

    const domain = await configureDomain<Infrastructure>({
      writeModel: { aggregates: { Counter, BankAccount } },
      readModel: { projections: {} },
      infrastructure: {
        aggregatePersistence: {
          Counter: () => esPersistence,
          BankAccount: () => ssPersistence,
        },
        cqrsInfrastructure: () => ({
          commandBus: new InMemoryCommandBus(),
          eventBus: new EventEmitterEventBus(),
          queryBus: new InMemoryQueryBus(),
        }),
      },
    });

    await domain.dispatchCommand({
      name: "Increment",
      targetAggregateId: "c-1",
      payload: { by: 5 },
    });
    await domain.dispatchCommand({
      name: "Deposit",
      targetAggregateId: "acc-1",
      payload: { amount: 100 },
    });

    // Counter uses event-sourced persistence
    const counterEvents = await esPersistence.load("Counter", "c-1");
    expect(counterEvents).toHaveLength(1);
    expect(counterEvents[0]!.name).toBe("Incremented");

    // BankAccount uses state-stored persistence
    const bankState = await ssPersistence.load("BankAccount", "acc-1");
    expect(bankState).not.toBeNull();
    expect(bankState!.state.balance).toBe(100);
  });
});
```

### per-aggregate persistence init throws for missing aggregate entries

```ts
import { describe, it, expect } from "vitest";
import {
  configureDomain,
  defineAggregate,
  EventEmitterEventBus,
  InMemoryCommandBus,
  InMemoryQueryBus,
  InMemoryEventSourcedAggregatePersistence,
} from "@noddde/core";
import type {
  DefineCommands,
  DefineEvents,
  AggregateTypes,
  Infrastructure,
} from "@noddde/core";

type CounterState = { count: number };
type CounterEvent = DefineEvents<{ Incremented: { by: number } }>;
type CounterCommand = DefineCommands<{ Increment: { by: number } }>;
type CounterTypes = AggregateTypes & {
  state: CounterState;
  events: CounterEvent;
  commands: CounterCommand;
  infrastructure: Infrastructure;
};

const Counter = defineAggregate<CounterTypes>({
  initialState: { count: 0 },
  commands: {
    Increment: (cmd) => ({
      name: "Incremented",
      payload: { by: cmd.payload.by },
    }),
  },
  apply: {
    Incremented: (payload, state) => ({ count: state.count + payload.by }),
  },
});

type BalanceState = { balance: number };
type BalanceEvent = DefineEvents<{ Deposited: { amount: number } }>;
type BalanceCommand = DefineCommands<{ Deposit: { amount: number } }>;
type BalanceTypes = AggregateTypes & {
  state: BalanceState;
  events: BalanceEvent;
  commands: BalanceCommand;
  infrastructure: Infrastructure;
};

const BankAccount = defineAggregate<BalanceTypes>({
  initialState: { balance: 0 },
  commands: {
    Deposit: (cmd) => ({
      name: "Deposited",
      payload: { amount: cmd.payload.amount },
    }),
  },
  apply: {
    Deposited: (payload, state) => ({
      balance: state.balance + payload.amount,
    }),
  },
});

describe("Per-aggregate persistence validation", () => {
  it("should throw if per-aggregate persistence is missing entries for registered aggregates", async () => {
    await expect(
      configureDomain<Infrastructure>({
        writeModel: { aggregates: { Counter, BankAccount } },
        readModel: { projections: {} },
        infrastructure: {
          // Only Counter has persistence — BankAccount is missing
          aggregatePersistence: {
            Counter: () => new InMemoryEventSourcedAggregatePersistence(),
          } as any,
          cqrsInfrastructure: () => ({
            commandBus: new InMemoryCommandBus(),
            eventBus: new EventEmitterEventBus(),
            queryBus: new InMemoryQueryBus(),
          }),
        },
      }),
    ).rejects.toThrow(/missing.*BankAccount/i);
  });

  it("should throw if per-aggregate persistence references unknown aggregates", async () => {
    await expect(
      configureDomain<Infrastructure>({
        writeModel: { aggregates: { Counter } },
        readModel: { projections: {} },
        infrastructure: {
          aggregatePersistence: {
            Counter: () => new InMemoryEventSourcedAggregatePersistence(),
            NonExistent: () => new InMemoryEventSourcedAggregatePersistence(),
          } as any,
          cqrsInfrastructure: () => ({
            commandBus: new InMemoryCommandBus(),
            eventBus: new EventEmitterEventBus(),
            queryBus: new InMemoryQueryBus(),
          }),
        },
      }),
    ).rejects.toThrow(/unknown.*NonExistent/i);
  });
});
```

### domain-wide persistence factory still works as before

```ts
import { describe, it, expect } from "vitest";
import {
  configureDomain,
  defineAggregate,
  EventEmitterEventBus,
  InMemoryCommandBus,
  InMemoryQueryBus,
  InMemoryEventSourcedAggregatePersistence,
} from "@noddde/core";
import type {
  DefineCommands,
  DefineEvents,
  AggregateTypes,
  Infrastructure,
} from "@noddde/core";

type CounterState = { count: number };
type CounterEvent = DefineEvents<{ Incremented: { by: number } }>;
type CounterCommand = DefineCommands<{ Increment: { by: number } }>;
type CounterTypes = AggregateTypes & {
  state: CounterState;
  events: CounterEvent;
  commands: CounterCommand;
  infrastructure: Infrastructure;
};

const Counter = defineAggregate<CounterTypes>({
  initialState: { count: 0 },
  commands: {
    Increment: (cmd) => ({
      name: "Incremented",
      payload: { by: cmd.payload.by },
    }),
  },
  apply: {
    Incremented: (payload, state) => ({ count: state.count + payload.by }),
  },
});

describe("Domain-wide persistence (backward compatibility)", () => {
  it("should use a single persistence factory for all aggregates", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();

    const domain = await configureDomain<Infrastructure>({
      writeModel: { aggregates: { Counter } },
      readModel: { projections: {} },
      infrastructure: {
        aggregatePersistence: () => persistence,
        cqrsInfrastructure: () => ({
          commandBus: new InMemoryCommandBus(),
          eventBus: new EventEmitterEventBus(),
          queryBus: new InMemoryQueryBus(),
        }),
      },
    });

    await domain.dispatchCommand({
      name: "Increment",
      targetAggregateId: "c-1",
      payload: { by: 3 },
    });

    const events = await persistence.load("Counter", "c-1");
    expect(events).toHaveLength(1);
  });
});
```

### per-aggregate async factories are resolved at init time

```ts
import { describe, it, expect, vi } from "vitest";
import {
  configureDomain,
  defineAggregate,
  EventEmitterEventBus,
  InMemoryCommandBus,
  InMemoryQueryBus,
  InMemoryEventSourcedAggregatePersistence,
  InMemoryStateStoredAggregatePersistence,
} from "@noddde/core";
import type {
  DefineCommands,
  DefineEvents,
  AggregateTypes,
  Infrastructure,
} from "@noddde/core";

type CounterState = { count: number };
type CounterEvent = DefineEvents<{ Incremented: { by: number } }>;
type CounterCommand = DefineCommands<{ Increment: { by: number } }>;
type CounterTypes = AggregateTypes & {
  state: CounterState;
  events: CounterEvent;
  commands: CounterCommand;
  infrastructure: Infrastructure;
};

const Counter = defineAggregate<CounterTypes>({
  initialState: { count: 0 },
  commands: {
    Increment: (cmd) => ({
      name: "Incremented",
      payload: { by: cmd.payload.by },
    }),
  },
  apply: {
    Incremented: (payload, state) => ({ count: state.count + payload.by }),
  },
});

type BalanceState = { balance: number };
type BalanceEvent = DefineEvents<{ Deposited: { amount: number } }>;
type BalanceCommand = DefineCommands<{ Deposit: { amount: number } }>;
type BalanceTypes = AggregateTypes & {
  state: BalanceState;
  events: BalanceEvent;
  commands: BalanceCommand;
  infrastructure: Infrastructure;
};

const BankAccount = defineAggregate<BalanceTypes>({
  initialState: { balance: 0 },
  commands: {
    Deposit: (cmd) => ({
      name: "Deposited",
      payload: { amount: cmd.payload.amount },
    }),
  },
  apply: {
    Deposited: (payload, state) => ({
      balance: state.balance + payload.amount,
    }),
  },
});

describe("Per-aggregate persistence factory resolution", () => {
  it("should resolve all async per-aggregate factories during init", async () => {
    const esFactory = vi.fn(
      async () => new InMemoryEventSourcedAggregatePersistence(),
    );
    const ssFactory = vi.fn(
      async () => new InMemoryStateStoredAggregatePersistence(),
    );

    await configureDomain<Infrastructure>({
      writeModel: { aggregates: { Counter, BankAccount } },
      readModel: { projections: {} },
      infrastructure: {
        aggregatePersistence: {
          Counter: esFactory,
          BankAccount: ssFactory,
        },
        cqrsInfrastructure: () => ({
          commandBus: new InMemoryCommandBus(),
          eventBus: new EventEmitterEventBus(),
          queryBus: new InMemoryQueryBus(),
        }),
      },
    });

    expect(esFactory).toHaveBeenCalledOnce();
    expect(ssFactory).toHaveBeenCalledOnce();
  });
});
```

### mixed persistence with snapshots only applies to event-sourced aggregates

```ts
import { describe, it, expect, vi } from "vitest";
import {
  configureDomain,
  defineAggregate,
  EventEmitterEventBus,
  InMemoryCommandBus,
  InMemoryQueryBus,
  InMemoryEventSourcedAggregatePersistence,
  InMemoryStateStoredAggregatePersistence,
  InMemorySnapshotStore,
  everyNEvents,
} from "@noddde/core";
import type {
  DefineCommands,
  DefineEvents,
  AggregateTypes,
  Infrastructure,
} from "@noddde/core";

type CounterState = { count: number };
type CounterEvent = DefineEvents<{ Incremented: { by: number } }>;
type CounterCommand = DefineCommands<{ Increment: { by: number } }>;
type CounterTypes = AggregateTypes & {
  state: CounterState;
  events: CounterEvent;
  commands: CounterCommand;
  infrastructure: Infrastructure;
};

const Counter = defineAggregate<CounterTypes>({
  initialState: { count: 0 },
  commands: {
    Increment: (cmd) => ({
      name: "Incremented",
      payload: { by: cmd.payload.by },
    }),
  },
  apply: {
    Incremented: (payload, state) => ({ count: state.count + payload.by }),
  },
});

type BalanceState = { balance: number };
type BalanceEvent = DefineEvents<{ Deposited: { amount: number } }>;
type BalanceCommand = DefineCommands<{ Deposit: { amount: number } }>;
type BalanceTypes = AggregateTypes & {
  state: BalanceState;
  events: BalanceEvent;
  commands: BalanceCommand;
  infrastructure: Infrastructure;
};

const BankAccount = defineAggregate<BalanceTypes>({
  initialState: { balance: 0 },
  commands: {
    Deposit: (cmd) => ({
      name: "Deposited",
      payload: { amount: cmd.payload.amount },
    }),
  },
  apply: {
    Deposited: (payload, state) => ({
      balance: state.balance + payload.amount,
    }),
  },
});

describe("Mixed persistence with snapshots", () => {
  it("should only create snapshots for event-sourced aggregates", async () => {
    const snapshotStore = new InMemorySnapshotStore();

    const domain = await configureDomain<Infrastructure>({
      writeModel: { aggregates: { Counter, BankAccount } },
      readModel: { projections: {} },
      infrastructure: {
        aggregatePersistence: {
          Counter: () => new InMemoryEventSourcedAggregatePersistence(),
          BankAccount: () => new InMemoryStateStoredAggregatePersistence(),
        },
        snapshotStore: () => snapshotStore,
        snapshotStrategy: everyNEvents(1), // snapshot after every event
        cqrsInfrastructure: () => ({
          commandBus: new InMemoryCommandBus(),
          eventBus: new EventEmitterEventBus(),
          queryBus: new InMemoryQueryBus(),
        }),
      },
    });

    // Dispatch to event-sourced aggregate
    await domain.dispatchCommand({
      name: "Increment",
      targetAggregateId: "c-1",
      payload: { by: 5 },
    });

    // Dispatch to state-stored aggregate
    await domain.dispatchCommand({
      name: "Deposit",
      targetAggregateId: "acc-1",
      payload: { amount: 100 },
    });

    // Snapshot should exist for event-sourced Counter
    const counterSnapshot = await snapshotStore.load("Counter", "c-1");
    expect(counterSnapshot).not.toBeNull();

    // No snapshot for state-stored BankAccount
    const bankSnapshot = await snapshotStore.load("BankAccount", "acc-1");
    expect(bankSnapshot).toBeNull();
  });
});
```

### defineDomain returns a typed DomainDefinition

```ts
import { describe, it, expect } from "vitest";
import { defineDomain, defineAggregate } from "@noddde/engine";
import type {
  AggregateTypes,
  DefineCommands,
  DefineEvents,
  Infrastructure,
} from "@noddde/core";

type CounterState = { count: number };
type CounterEvent = DefineEvents<{ Incremented: { by: number } }>;
type CounterCommand = DefineCommands<{ Increment: { by: number } }>;
type CounterTypes = AggregateTypes & {
  state: CounterState;
  events: CounterEvent;
  commands: CounterCommand;
  infrastructure: Infrastructure;
};

const Counter = defineAggregate<CounterTypes>({
  initialState: { count: 0 },
  commands: {
    Increment: (cmd) => ({
      name: "Incremented",
      payload: { by: cmd.payload.by },
    }),
  },
  apply: {
    Incremented: (payload, state) => ({ count: state.count + payload.by }),
  },
});

describe("defineDomain", () => {
  it("should return the definition unchanged with type inference", () => {
    const definition = defineDomain<Infrastructure>({
      writeModel: { aggregates: { Counter } },
      readModel: { projections: {} },
    });

    expect(definition.writeModel.aggregates).toEqual({ Counter });
    expect(definition.readModel.projections).toEqual({});
    expect(definition.processModel).toBeUndefined();
  });
});
```

### wireDomain creates and initializes a domain from definition + wiring

```ts
import { describe, it, expect } from "vitest";
import {
  defineDomain,
  wireDomain,
  Domain,
  EventEmitterEventBus,
  InMemoryCommandBus,
  InMemoryQueryBus,
  defineAggregate,
  InMemoryEventSourcedAggregatePersistence,
} from "@noddde/engine";
import type {
  AggregateTypes,
  DefineCommands,
  DefineEvents,
  Infrastructure,
} from "@noddde/core";

type CounterState = { count: number };
type CounterEvent = DefineEvents<{
  CounterCreated: { id: string };
  Incremented: { by: number };
}>;
type CounterCommand = DefineCommands<{
  CreateCounter: void;
  Increment: { by: number };
}>;
type CounterTypes = AggregateTypes & {
  state: CounterState;
  events: CounterEvent;
  commands: CounterCommand;
  infrastructure: Infrastructure;
};

const Counter = defineAggregate<CounterTypes>({
  initialState: { count: 0 },
  commands: {
    CreateCounter: (cmd) => ({
      name: "CounterCreated",
      payload: { id: cmd.targetAggregateId },
    }),
    Increment: (cmd) => ({
      name: "Incremented",
      payload: { by: cmd.payload.by },
    }),
  },
  apply: {
    CounterCreated: (_p, state) => state,
    Incremented: (payload, state) => ({ count: state.count + payload.by }),
  },
});

describe("wireDomain", () => {
  it("should create an initialized Domain from definition + wiring", async () => {
    const definition = defineDomain<Infrastructure>({
      writeModel: { aggregates: { Counter } },
      readModel: { projections: {} },
    });

    const persistence = new InMemoryEventSourcedAggregatePersistence();

    const domain = await wireDomain(definition, {
      aggregates: {
        persistence: () => persistence,
      },
      buses: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus: new EventEmitterEventBus(),
        queryBus: new InMemoryQueryBus(),
      }),
    });

    expect(domain).toBeInstanceOf(Domain);

    // Verify it's functional
    await domain.dispatchCommand({
      name: "CreateCounter",
      targetAggregateId: "c-1",
    });
    await domain.dispatchCommand({
      name: "Increment",
      targetAggregateId: "c-1",
      payload: { by: 5 },
    });

    const events = await persistence.load("Counter", "c-1");
    expect(events).toHaveLength(2);
  });
});
```

### wireDomain with per-aggregate concurrency and snapshots

```ts
import { describe, it, expect } from "vitest";
import {
  defineDomain,
  wireDomain,
  defineAggregate,
  InMemoryEventSourcedAggregatePersistence,
  InMemoryStateStoredAggregatePersistence,
  InMemorySnapshotStore,
  InMemoryAggregateLocker,
  EventEmitterEventBus,
  InMemoryCommandBus,
  InMemoryQueryBus,
} from "@noddde/engine";
import { everyNEvents } from "@noddde/core";
import type {
  AggregateTypes,
  DefineCommands,
  DefineEvents,
  Infrastructure,
} from "@noddde/core";

type CounterState = { count: number };
type CounterEvent = DefineEvents<{ Incremented: { by: number } }>;
type CounterCommand = DefineCommands<{ Increment: { by: number } }>;
type CounterTypes = AggregateTypes & {
  state: CounterState;
  events: CounterEvent;
  commands: CounterCommand;
  infrastructure: Infrastructure;
};

const Counter = defineAggregate<CounterTypes>({
  initialState: { count: 0 },
  commands: {
    Increment: (cmd) => ({
      name: "Incremented",
      payload: { by: cmd.payload.by },
    }),
  },
  apply: {
    Incremented: (payload, state) => ({ count: state.count + payload.by }),
  },
});

type BalanceState = { balance: number };
type BalanceEvent = DefineEvents<{ DepositMade: { amount: number } }>;
type BalanceCommand = DefineCommands<{ Deposit: { amount: number } }>;
type BalanceTypes = AggregateTypes & {
  state: BalanceState;
  events: BalanceEvent;
  commands: BalanceCommand;
  infrastructure: Infrastructure;
};

const BankAccount = defineAggregate<BalanceTypes>({
  initialState: { balance: 0 },
  commands: {
    Deposit: (cmd) => ({
      name: "DepositMade",
      payload: { amount: cmd.payload.amount },
    }),
  },
  apply: {
    DepositMade: (payload, state) => ({
      balance: state.balance + payload.amount,
    }),
  },
});

describe("wireDomain per-aggregate config", () => {
  it("should support different concurrency and snapshots per aggregate", async () => {
    const snapshotStore = new InMemorySnapshotStore();

    const definition = defineDomain<Infrastructure>({
      writeModel: { aggregates: { Counter, BankAccount } },
      readModel: { projections: {} },
    });

    const domain = await wireDomain(definition, {
      aggregates: {
        Counter: {
          persistence: () => new InMemoryEventSourcedAggregatePersistence(),
          concurrency: { maxRetries: 5 },
          snapshots: {
            store: () => snapshotStore,
            strategy: everyNEvents(1),
          },
        },
        BankAccount: {
          persistence: () => new InMemoryStateStoredAggregatePersistence(),
          // No concurrency, no snapshots
        },
      },
      buses: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus: new EventEmitterEventBus(),
        queryBus: new InMemoryQueryBus(),
      }),
    });

    // Counter should produce snapshots
    await domain.dispatchCommand({
      name: "Increment",
      targetAggregateId: "c-1",
      payload: { by: 10 },
    });

    const counterSnapshot = await snapshotStore.load("Counter", "c-1");
    expect(counterSnapshot).not.toBeNull();

    // BankAccount should not produce snapshots
    await domain.dispatchCommand({
      name: "Deposit",
      targetAggregateId: "acc-1",
      payload: { amount: 100 },
    });

    const bankSnapshot = await snapshotStore.load("BankAccount", "acc-1");
    expect(bankSnapshot).toBeNull();
  });
});
```

### wireDomain with no wiring argument (hello world)

```ts
import { describe, it, expect, vi } from "vitest";
import {
  defineDomain,
  wireDomain,
  Domain,
  defineAggregate,
} from "@noddde/engine";
import type {
  AggregateTypes,
  DefineCommands,
  DefineEvents,
  Infrastructure,
} from "@noddde/core";

type PingState = { pinged: boolean };
type PingEvent = DefineEvents<{ Pinged: Record<string, never> }>;
type PingCommand = DefineCommands<{ Ping: void }>;
type PingTypes = AggregateTypes & {
  state: PingState;
  events: PingEvent;
  commands: PingCommand;
  infrastructure: Infrastructure;
};

const Pinger = defineAggregate<PingTypes>({
  initialState: { pinged: false },
  commands: {
    Ping: () => ({ name: "Pinged", payload: {} }),
  },
  apply: {
    Pinged: () => ({ pinged: true }),
  },
});

describe("wireDomain hello world", () => {
  it("should work with no wiring argument at all", async () => {
    const definition = defineDomain<Infrastructure>({
      writeModel: { aggregates: { Pinger } },
      readModel: { projections: {} },
    });

    const domain = await wireDomain(definition);
    expect(domain).toBeInstanceOf(Domain);

    // Should work with in-memory defaults
    await domain.dispatchCommand({
      name: "Ping",
      targetAggregateId: "p-1",
    });
  });

  it("should log warnings when using in-memory defaults", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const definition = defineDomain<Infrastructure>({
      writeModel: { aggregates: { Pinger } },
      readModel: { projections: {} },
    });

    await wireDomain(definition);

    // Should warn about in-memory persistence
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("[noddde]"));
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("aggregate persistence"),
    );
    // Should warn about in-memory buses
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("buses"));

    warnSpy.mockRestore();
  });

  it("should not log warnings when all wiring is explicitly provided", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const definition = defineDomain<Infrastructure>({
      writeModel: { aggregates: { Pinger } },
      readModel: { projections: {} },
    });

    const {
      InMemoryEventSourcedAggregatePersistence,
      InMemoryCommandBus,
      EventEmitterEventBus,
      InMemoryQueryBus,
    } = await import("@noddde/engine");

    await wireDomain(definition, {
      aggregates: {
        persistence: () => new InMemoryEventSourcedAggregatePersistence(),
      },
      buses: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus: new EventEmitterEventBus(),
        queryBus: new InMemoryQueryBus(),
      }),
    });

    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
```

### wireDomain with minimal wiring uses all defaults

```ts
import { describe, it, expect } from "vitest";
import {
  defineDomain,
  wireDomain,
  Domain,
  defineAggregate,
} from "@noddde/engine";
import type {
  AggregateTypes,
  DefineCommands,
  DefineEvents,
  Infrastructure,
} from "@noddde/core";

type PingState = { pinged: boolean };
type PingEvent = DefineEvents<{ Pinged: Record<string, never> }>;
type PingCommand = DefineCommands<{ Ping: void }>;
type PingTypes = AggregateTypes & {
  state: PingState;
  events: PingEvent;
  commands: PingCommand;
  infrastructure: Infrastructure;
};

const Pinger = defineAggregate<PingTypes>({
  initialState: { pinged: false },
  commands: {
    Ping: () => ({ name: "Pinged", payload: {} }),
  },
  apply: {
    Pinged: () => ({ pinged: true }),
  },
});

describe("wireDomain minimal", () => {
  it("should work with empty wiring using all defaults", async () => {
    const definition = defineDomain<Infrastructure>({
      writeModel: { aggregates: { Pinger } },
      readModel: { projections: {} },
    });

    const domain = await wireDomain(definition, {});
    expect(domain).toBeInstanceOf(Domain);

    // Should work with in-memory defaults
    await domain.dispatchCommand({
      name: "Ping",
      targetAggregateId: "p-1",
    });
  });
});
```

### wireDomain resolves projection viewStore from wiring

```ts
import { describe, it, expect } from "vitest";
import {
  defineDomain,
  wireDomain,
  defineAggregate,
  defineProjection,
  InMemoryViewStore,
  EventEmitterEventBus,
  InMemoryCommandBus,
  InMemoryQueryBus,
} from "@noddde/engine";
import type {
  AggregateTypes,
  DefineCommands,
  DefineEvents,
  DefineQueries,
  ProjectionTypes,
  Infrastructure,
} from "@noddde/core";

type ItemEvent = DefineEvents<{
  ItemAdded: { id: string; name: string };
}>;

type ItemQuery = DefineQueries<{
  GetItem: {
    payload: { id: string };
    result: { id: string; name: string } | null;
  };
}>;

type ItemView = { id: string; name: string };

interface TestInfra extends Infrastructure {
  itemViewStore: InMemoryViewStore<ItemView>;
}

type ItemProjectionTypes = ProjectionTypes & {
  events: ItemEvent;
  queries: ItemQuery;
  view: ItemView;
  infrastructure: TestInfra;
};

const ItemProjection = defineProjection<ItemProjectionTypes>({
  reducers: {
    ItemAdded: (event) => ({ id: event.payload.id, name: event.payload.name }),
  },
  queryHandlers: {
    GetItem: (payload, { views }) => views.load(payload.id),
  },
  identity: {
    ItemAdded: (event) => event.payload.id,
  },
  initialView: { id: "", name: "" },
  // Note: no viewStore on the projection definition — provided via wiring
});

type AddItemCommand = DefineCommands<{
  AddItem: { id: string; name: string };
}>;
type AddItemEvent = DefineEvents<{
  ItemAdded: { id: string; name: string };
}>;
type ItemAggregateTypes = AggregateTypes & {
  state: Record<string, never>;
  events: AddItemEvent;
  commands: AddItemCommand;
  infrastructure: TestInfra;
};

const ItemAggregate = defineAggregate<ItemAggregateTypes>({
  initialState: {},
  commands: {
    AddItem: (cmd) => ({
      name: "ItemAdded",
      payload: { id: cmd.payload.id, name: cmd.payload.name },
    }),
  },
  apply: {
    ItemAdded: (_p, state) => state,
  },
});

describe("wireDomain projection wiring", () => {
  it("should resolve viewStore from wiring.projections", async () => {
    const viewStore = new InMemoryViewStore<ItemView>();

    const definition = defineDomain<TestInfra>({
      writeModel: { aggregates: { Item: ItemAggregate } },
      readModel: { projections: { ItemProjection } },
    });

    const domain = await wireDomain(definition, {
      infrastructure: () => ({ itemViewStore: viewStore }),
      projections: {
        ItemProjection: {
          viewStore: () => viewStore,
        },
      },
      buses: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus: new EventEmitterEventBus(),
        queryBus: new InMemoryQueryBus(),
      }),
    });

    await domain.dispatchCommand({
      name: "AddItem",
      targetAggregateId: "item-1",
      payload: { id: "item-1", name: "Widget" },
    });

    // Allow eventual consistency
    await new Promise((r) => setTimeout(r, 50));

    const result = await domain.dispatchQuery({
      name: "GetItem",
      payload: { id: "item-1" },
    } as ItemQuery);

    expect(result).toEqual({ id: "item-1", name: "Widget" });
  });
});
```

### wireDomain with user infrastructure separated from framework plumbing

```ts
import { describe, it, expect } from "vitest";
import {
  defineDomain,
  wireDomain,
  defineAggregate,
  EventEmitterEventBus,
  InMemoryCommandBus,
  InMemoryQueryBus,
} from "@noddde/engine";
import type {
  AggregateTypes,
  DefineCommands,
  DefineEvents,
} from "@noddde/core";

interface AppInfrastructure {
  clock: { now(): Date };
  logger: { log(msg: string): void };
}

type PingState = { lastPing: Date | null };
type PingEvent = DefineEvents<{ Pinged: { at: string } }>;
type PingCommand = DefineCommands<{ Ping: void }>;
type PingTypes = AggregateTypes & {
  state: PingState;
  events: PingEvent;
  commands: PingCommand;
  infrastructure: AppInfrastructure;
};

const Pinger = defineAggregate<PingTypes>({
  initialState: { lastPing: null },
  commands: {
    Ping: (_cmd, _state, infra) => ({
      name: "Pinged",
      payload: { at: infra.clock.now().toISOString() },
    }),
  },
  apply: {
    Pinged: (payload, _state) => ({ lastPing: new Date(payload.at) }),
  },
});

describe("wireDomain infrastructure separation", () => {
  it("should provide user infrastructure to handlers separately from framework plumbing", async () => {
    const fixedDate = new Date("2025-06-01T12:00:00Z");
    const logs: string[] = [];

    const definition = defineDomain<AppInfrastructure>({
      writeModel: { aggregates: { Pinger } },
      readModel: { projections: {} },
    });

    const domain = await wireDomain(definition, {
      // User services — what handlers receive as `infrastructure`
      infrastructure: () => ({
        clock: { now: () => fixedDate },
        logger: { log: (msg: string) => logs.push(msg) },
      }),
      // Framework plumbing — separate concern
      buses: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus: new EventEmitterEventBus(),
        queryBus: new InMemoryQueryBus(),
      }),
    });

    // User infrastructure is accessible
    expect(domain.infrastructure.clock.now()).toBe(fixedDate);
    expect(domain.infrastructure.logger).toBeDefined();

    // CQRS buses are also on infrastructure (merged)
    expect(domain.infrastructure.commandBus).toBeInstanceOf(InMemoryCommandBus);
  });
});
```
