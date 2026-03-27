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

> The domain API is split into two phases: **definition** (`defineDomain`) captures the pure domain structure (aggregates, projections, sagas, handlers) as a sync identity function, while **wiring** (`wireDomain`) connects that definition to infrastructure (persistence, buses, concurrency, snapshots) and returns a running `Domain` instance. This separation allows domain definitions to be shared, tested, and analyzed independently of runtime concerns. The `Domain` class remains the central runtime orchestrator.

## Type Contract

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
  TStandaloneEvent extends Event = Event,
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
 * Sync identity function that creates a domain definition with full type
 * inference. Consistent with defineAggregate, defineProjection, defineSaga.
 */
const defineDomain: <
  TInfrastructure extends Infrastructure = Infrastructure,
  TStandaloneCommand extends Command = Command,
  TStandaloneQuery extends Query<any> = Query<any>,
  TAggregates extends AggregateMap = AggregateMap,
  TStandaloneEvent extends Event = Event,
>(
  definition: DomainDefinition<
    TInfrastructure,
    TStandaloneCommand,
    TStandaloneQuery,
    TAggregates,
    TStandaloneEvent
  >,
) => DomainDefinition<
  TInfrastructure,
  TStandaloneCommand,
  TStandaloneQuery,
  TAggregates,
  TStandaloneEvent
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
  TStandaloneEvent extends Event = Event,
>(
  definition: DomainDefinition<
    TInfrastructure,
    TStandaloneCommand,
    TStandaloneQuery,
    TAggregates,
    TStandaloneEvent
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

## Behavioral Requirements

### Domain.init() -- Initialization Sequence

The `init()` method must execute the following steps in order:

1. **Resolve custom infrastructure** -- Call `wiring.infrastructure()` if provided. Store the result. If not provided, use `{}` as the default infrastructure.
2. **Resolve CQRS infrastructure** -- Call `wiring.buses(infrastructure)` if provided, passing the resolved custom infrastructure. Store the `CommandBus`, `EventBus`, and `QueryBus`. If not provided, create default in-memory implementations (`InMemoryCommandBus`, `EventEmitterEventBus`, `InMemoryQueryBus`) and log a warning: `[noddde] Using in-memory CQRS buses. This is not suitable for production.`
3. **Merge infrastructure** -- Combine custom infrastructure and CQRS infrastructure into `this._infrastructure` as `TInfrastructure & CQRSInfrastructure`.
4. **Resolve aggregate persistence** -- Build an `AggregatePersistenceResolver` (strategy pattern, engine-internal) based on the `wiring.aggregates` configuration:
   - **Omitted** (`undefined`): Create a `GlobalAggregatePersistenceResolver` wrapping a default `InMemoryEventSourcedAggregatePersistence` and log a warning: `[noddde] Using in-memory aggregate persistence. This is not suitable for production.`
   - **Global `AggregateWiring`** (has `persistence`, `concurrency`, or `snapshots` key): Call the `persistence` factory, create a `GlobalAggregatePersistenceResolver` wrapping the result.
   - **Per-aggregate record**: Validate that every aggregate in `definition.writeModel.aggregates` has a corresponding entry and that no unknown aggregate names are present. Throw a descriptive error on mismatch. Resolve each factory. Create a `PerAggregatePersistenceResolver` wrapping a `Map<string, PersistenceConfiguration>`.
     Pass the resolver to `CommandLifecycleExecutor`, which calls `resolver.resolve(aggregateName)` at each command dispatch to obtain the persistence for the target aggregate.
5. **Resolve snapshots** -- For each aggregate with `AggregateWiring.snapshots` configured, call `snapshots.store()` and store the `snapshots.strategy`. Both are optional per-aggregate.
6. **Resolve saga persistence** -- Only when `processModel.sagas` is defined and non-empty: call `wiring.sagas.persistence()` if provided. If omitted, default to `InMemorySagaPersistence` and log a warning: `[noddde] Using in-memory saga persistence. This is not suitable for production.` When `processModel` has only `standaloneEventHandlers` and no `sagas`, saga persistence is not resolved and no warning is logged.
   6b. **Resolve outbox store** -- If `wiring.outbox` is provided, call `outbox.store()` to resolve the `OutboxStore`. Create an `OutboxRelay` instance (but do not start it). The outbox store is used to compose the `onEventsProduced` callback (enlisting outbox writes in the UoW) and the `onEventsDispatched` callback (marking entries published by event ID after dispatch).
7. **Register command handlers** -- For each aggregate in `writeModel.aggregates`, register a command handler on the command bus for each command name defined in `Aggregate.commands`. The registered handler encapsulates the full command lifecycle (load, execute, apply, persist, publish).
8. **Register standalone command handlers** -- For each handler in `writeModel.standaloneCommandHandlers`, register it on the command bus, wrapping it to receive the merged infrastructure.
9. **Register query handlers** -- For each projection in `readModel.projections`, register each query handler from `Projection.queryHandlers` on the query bus.
10. **Register standalone query handlers** -- For each handler in `readModel.standaloneQueryHandlers`, register it on the query bus.
11. **Register event listeners for projections** -- For each projection, subscribe to each event name in `Projection.reducers` on the event bus. When an event arrives, invoke the reducer to update the projection's view.
12. **Register event listeners for sagas** -- For each saga in `processModel.sagas` (if defined), subscribe to each event name in `Object.keys(saga.on)` on the event bus. When an event arrives, execute the saga event handling lifecycle.
13. **Register standalone event handlers** -- For each handler in `processModel.standaloneEventHandlers` (if defined), subscribe it to the event bus for the corresponding event name. When an event arrives, invoke the handler with the full event and the merged infrastructure (`TInfrastructure & CQRSInfrastructure`). Runs after saga handler registration.

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

The domain delegates concurrency control to a `ConcurrencyStrategy` instance, constructed during `init()` based on `AggregateWiring.concurrency` configuration. The strategy wraps the command attempt — the Domain itself has no concurrency-specific branching.

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

**Default behavior**: `concurrency: { maxRetries: 3 }` (without `strategy` field) defaults to optimistic. Omitting `concurrency` entirely defaults to optimistic with 0 retries.

### Domain.dispatchCommand() -- Idempotent Command Processing

When an `IdempotencyStore` is configured (via `DomainWiring.idempotency`) and a command carries a `commandId`, the domain engine enforces idempotent processing:

1. **Idempotency check** (before concurrency strategy, before Load) — If `idempotencyStore` is configured AND `command.commandId != null`:
   - Call `idempotencyStore.exists(command.commandId)`.
   - If `true`: return `command.targetAggregateId` immediately. Skip all subsequent steps — no load, no execute, no persist, no publish.
   - If `false`: proceed with the normal command lifecycle.
2. **Idempotency record save** (after event persistence, within the same UoW) — If `command.commandId != null` and the command is being processed (not a duplicate):
   - Enlist `idempotencyStore.save({ commandId, aggregateName, aggregateId, processedAt })` in the UoW, after the event persistence enlistment.
   - This ensures atomicity: the idempotency record is only persisted if event persistence succeeds.
3. **Bypass conditions** — Idempotency is skipped entirely when:
   - `idempotencyStore` is not configured (no `wiring.idempotency` factory in `DomainWiring`).
   - `command.commandId` is `undefined` or not present on the command object.

### Saga Event Handling Lifecycle

When an event arrives on the event bus for a registered saga:

1. **Derive saga instance ID** -- Call `saga.on[event.name].id(event)` to get the saga instance ID.
2. **Load saga state** -- Call `sagaPersistence.load(sagaName, sagaId)`.
3. **Bootstrap or resume** -- If state is `null`/`undefined`:
   - If `event.name` is in `saga.startedBy`, use `saga.initialState` as the current state.
   - Otherwise, ignore the event (the saga has not been started yet).
4. **Execute handler** -- Call `saga.on[event.name].handle(event, currentState, infrastructure)`. Returns a `SagaReaction` with new state and optional commands.
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

1. **Aggregate persistence** — When `wiring.aggregates` is omitted (global default `InMemoryEventSourcedAggregatePersistence`). Logged once, not per-aggregate.
2. **CQRS buses** — When `wiring.buses` is omitted (default `InMemoryCommandBus`, `EventEmitterEventBus`, `InMemoryQueryBus`). Logged as a single warning covering all three buses.
3. **Saga persistence** — When `processModel.sagas` is defined and non-empty and `wiring.sagas.persistence` is omitted (default `InMemorySagaPersistence`). Not triggered when `processModel` has only `standaloneEventHandlers`.

Warnings are **not** logged for:

- Optional components that are simply not configured (snapshots, idempotency, outbox, unit of work) — omitting these is a valid production choice.
- User-provided infrastructure (`wiring.infrastructure`) — `{}` is a valid default when aggregates don't need external services.
- Components where the user explicitly provides a factory that happens to return an in-memory implementation — the framework only warns when **it** supplies the default.

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
- **processModel with only standaloneEventHandlers (no sagas)** -- `processModel: { standaloneEventHandlers: { ... } }` with `sagas` omitted. Saga persistence is not resolved, no saga warning is logged. Event handlers are subscribed normally.
- **Empty standaloneEventHandlers** -- `processModel: { standaloneEventHandlers: {} }` — no event subscriptions are created. No error.
- **Standalone event handler is async** -- The handler returns `Promise<void>`. The event bus awaits the handler before proceeding.
- **Standalone event handler throws** -- The error propagates through the event bus dispatch, consistent with saga and projection handler behavior.
- **No custom infrastructure** -- `wiring.infrastructure` can be omitted. The domain uses `{}` as the custom infrastructure.
- **No CQRS infrastructure provided** -- `wiring.buses` can be omitted. The domain creates default in-memory buses.
- **No persistence provided** -- `wiring.aggregates` can be omitted. The domain uses a default in-memory event-sourced persistence for all aggregates via `GlobalAggregatePersistenceResolver`.
- **Per-aggregate persistence with missing aggregate** -- If the per-aggregate record is missing an entry for a registered aggregate, `init()` throws an error listing the missing aggregate names.
- **Per-aggregate persistence with unknown aggregate name** -- If the per-aggregate record contains a key that does not match any registered aggregate, `init()` throws an error listing the unknown names.
- **Per-aggregate persistence with mixed strategies** -- Some aggregates event-sourced, others state-stored. Snapshots only apply to event-sourced aggregates; the existing `isEventSourced` check in `CommandLifecycleExecutor` handles this correctly.
- **Per-aggregate factory throws during init** -- The error propagates through `wireDomain` and the domain is not usable.
- **Command handler returns a single event** -- Must be normalized to an array before processing.
- **Command handler returns empty array** -- No events to apply, persist, or publish. The aggregate state remains unchanged.
- **Saga handler returns no commands** -- `reaction.commands` is `undefined` or empty. Only the saga state is persisted; no commands are dispatched.
- **init() factory throws** -- The error propagates through `wireDomain` and the domain is not usable.
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
- **SagaExecutor** -- Internal executor that handles the saga event handling lifecycle (derive ID, load state, bootstrap/resume, execute handler, dispatch commands atomically). Created during `init()` when `processModel.sagas` is configured.
- **Standalone event handlers** -- Registered during `init()` from `processModel.standaloneEventHandlers`. Each handler subscribes to its event name on the event bus and receives the full event + merged infrastructure. No executor or persistence needed — handlers are fire-and-forget side effects.
- **MetadataEnricher** -- Internal helper that enriches raw events with metadata (eventId, timestamp, correlationId, causationId, userId, aggregate context). Used by `CommandLifecycleExecutor`.
- **Projections** -- The domain reads `Projection.reducers` and `Projection.queryHandlers` to wire event listeners and query handlers.
- **External consumers** -- Applications interact with the domain via `domain.dispatchCommand(command)` and `domain.dispatchQuery(query)`. The query bus remains accessible directly via `domain.infrastructure.queryBus` for advanced use cases.

## Test Scenarios

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
  on: {
    ItemAdded: {
      id: (event) => event.payload.id,
      reduce: (event) => ({ id: event.payload.id, name: event.payload.name }),
    },
  },
  queryHandlers: {
    GetItem: (payload, { views }) => views.load(payload.id),
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

### Standalone event handler receives event and infrastructure

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
  Event,
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

describe("standalone event handlers", () => {
  it("should invoke handler when matching event is dispatched", async () => {
    const receivedEvents: Event[] = [];

    const definition = defineDomain<
      Infrastructure,
      never,
      never,
      typeof Counter extends infer A ? { Counter: typeof Counter } : never,
      CounterEvent
    >({
      writeModel: { aggregates: { Counter } },
      readModel: { projections: {} },
      processModel: {
        standaloneEventHandlers: {
          Incremented: (event, _infrastructure) => {
            receivedEvents.push(event);
          },
        },
      },
    });

    const domain = await wireDomain(definition, {
      buses: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus: new EventEmitterEventBus(),
        queryBus: new InMemoryQueryBus(),
      }),
    });

    await domain.dispatchCommand({
      name: "Increment",
      targetAggregateId: "c-1",
      payload: { by: 5 },
    });

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0]!.name).toBe("Incremented");
    expect(receivedEvents[0]!.payload).toEqual({ by: 5 });
  });
});
```

### Standalone event handler without sagas does not trigger saga persistence

```ts
import { describe, it, expect, vi } from "vitest";
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

describe("standalone event handlers without sagas", () => {
  it("should not log saga persistence warning when processModel has only standaloneEventHandlers", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const definition = defineDomain<
      Infrastructure,
      never,
      never,
      typeof Counter extends infer A ? { Counter: typeof Counter } : never,
      CounterEvent
    >({
      writeModel: { aggregates: { Counter } },
      readModel: { projections: {} },
      processModel: {
        standaloneEventHandlers: {
          Incremented: () => {},
        },
      },
    });

    await wireDomain(definition, {
      buses: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus: new EventEmitterEventBus(),
        queryBus: new InMemoryQueryBus(),
      }),
    });

    const sagaWarnings = warnSpy.mock.calls.filter((args) =>
      String(args[0]).includes("saga persistence"),
    );
    expect(sagaWarnings).toHaveLength(0);

    warnSpy.mockRestore();
  });
});
```

### Async standalone event handler is awaited

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

describe("async standalone event handler", () => {
  it("should await async standalone event handlers before dispatch resolves", async () => {
    let completed = false;

    const definition = defineDomain<
      Infrastructure,
      never,
      never,
      typeof Counter extends infer A ? { Counter: typeof Counter } : never,
      CounterEvent
    >({
      writeModel: { aggregates: { Counter } },
      readModel: { projections: {} },
      processModel: {
        standaloneEventHandlers: {
          Incremented: async () => {
            await new Promise((r) => setTimeout(r, 10));
            completed = true;
          },
        },
      },
    });

    const domain = await wireDomain(definition, {
      buses: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus: new EventEmitterEventBus(),
        queryBus: new InMemoryQueryBus(),
      }),
    });

    await domain.dispatchCommand({
      name: "Increment",
      targetAggregateId: "c-1",
      payload: { by: 1 },
    });

    expect(completed).toBe(true);
  });
});
```

### Empty standaloneEventHandlers is a no-op

```ts
import { describe, it, expect } from "vitest";
import {
  defineDomain,
  wireDomain,
  Domain,
  defineAggregate,
  EventEmitterEventBus,
  InMemoryCommandBus,
  InMemoryQueryBus,
} from "@noddde/engine";
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

describe("empty standalone event handlers", () => {
  it("should handle empty standaloneEventHandlers gracefully", async () => {
    const definition = defineDomain<Infrastructure>({
      writeModel: { aggregates: { Counter } },
      readModel: { projections: {} },
      processModel: {
        standaloneEventHandlers: {},
      },
    });

    const domain = await wireDomain(definition, {
      buses: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus: new EventEmitterEventBus(),
        queryBus: new InMemoryQueryBus(),
      }),
    });

    expect(domain).toBeInstanceOf(Domain);
  });
});
```
