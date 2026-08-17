---
title: "Domain Wiring"
module: engine/domain
source_file: packages/engine/src/domain.ts
status: implemented
exports:
  [
    Domain,
    AggregateWiring,
    ProjectionWiring,
    DomainWiring,
    wireDomain,
    InferDomain,
    InferAggregateMapCommands,
    InferProjectionMapQueries,
  ]
re_exports:
  - { from: "@noddde/core", names: [DomainDefinition, defineDomain] }
depends_on:
  - engine/implementations/ee-event-bus
  - engine/implementations/in-memory-command-bus
  - engine/implementations/in-memory-query-bus
  - engine/implementations/in-memory-aggregate-persistence
  - engine/implementations/in-memory-saga-persistence
  - engine/aggregate-persistence-resolver
  - engine/projection-rebuild
  - engine/executors/command-lifecycle-executor
  - engine/executors/saga-executor
  - engine/executors/metadata-enricher
  - engine/outbox-relay
  - engine/logger
  - ddd/aggregate-root
  - ddd/projection
  - ddd/saga
  - ddd/domain-definition
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
  - read-model/projection-rebuild.mdx
---

# Domain Wiring

> The domain API is split into two phases. The **definition** phase (`defineDomain` + `DomainDefinition`) captures the pure domain structure (aggregates, projections, sagas, handlers) as a sync identity function and is owned by `@noddde/core` — see [`ddd/domain-definition`](../core/ddd/domain-definition.spec.md). This spec covers the **wiring** phase: `wireDomain` connects a `DomainDefinition` to infrastructure (persistence, buses, concurrency, snapshots) and returns a running `Domain` instance. The `Domain` class is the central runtime orchestrator. For backward compatibility, `@noddde/engine` re-exports `DomainDefinition` and `defineDomain` from `@noddde/core`, so existing `import { defineDomain } from "@noddde/engine"` continues to work.

## Type Contract

```ts
/**
 * Extracts the union of all command types from a map of aggregates.
 * Distributes InferAggregateCommands across each value in the map.
 */
type InferAggregateMapCommands<
  TMap extends Record<string | symbol, Aggregate>,
> = TMap[keyof TMap] extends Aggregate<infer U> ? U["commands"] : never;

/**
 * Extracts the union of all query types from a map of projections.
 * Distributes InferProjectionQueries across each value in the map.
 */
type InferProjectionMapQueries<
  TMap extends Record<string | symbol, Projection>,
> = TMap[keyof TMap] extends Projection<infer U> ? U["queries"] : never;

/**
 * `DomainDefinition` and `defineDomain` are owned by `@noddde/core` — see
 * the [ddd/domain-definition spec](../core/ddd/domain-definition.spec.md).
 * `@noddde/engine` re-exports both for backward compatibility, so existing
 * `import { defineDomain, DomainDefinition } from "@noddde/engine"` calls
 * keep working. New code should prefer `from "@noddde/core"`.
 */

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
 *
 * `viewStore` is a {@link ViewStoreFactory} singleton — its
 * `getForContext(ctx?)` is invoked by the engine: once at init with
 * `ctx = undefined` (the cached base instance for query handlers and
 * eventual-consistency reads), and once per enlisted strong-consistency
 * read-modify-write with `ctx = uow.context` (the active transaction
 * handle from the configured persistence adapter).
 */
type ProjectionWiring = {
  viewStore: ViewStoreFactory;
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
  projections?: Record<keyof TProjections & string, ProjectionWiring>;
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
  /** Framework logger. Defaults to NodddeLogger at 'warn' level. */
  logger?: Logger;
};

/**
 * Wires a DomainDefinition with infrastructure to create a running Domain.
 * When `wiring` is omitted or `{}`, all infrastructure defaults to in-memory
 * implementations with startup warnings logged to the console.
 *
 * All type parameters are inferred from TDef (the narrow definition type):
 * - TInfrastructure: intersection of all infrastructure types from aggregates,
 *   projections, and sagas (the wiring.infrastructure factory must satisfy it)
 * - TAggregateCommand: union of all aggregate command types
 * - TProjectionQuery: union of all projection query types
 * - TStandaloneCommand/TStandaloneQuery: extracted from standalone handlers
 */
const wireDomain: <
  TDef extends DomainDefinition<any, any, any, any, any, any>,
  TInfrastructure extends Infrastructure = ExtractInfrastructure<TDef>,
  TStandaloneCommand extends Command = ExtractStandaloneCommand<TDef>,
  TStandaloneQuery extends Query<any> = ExtractStandaloneQuery<TDef>,
  TAggregates extends AggregateMap = ExtractAggregates<TDef>,
  TProjections extends ProjectionMap = ExtractProjections<TDef>,
>(
  definition: TDef,
  wiring?: DomainWiring<ExtractInfrastructure<TDef>, TAggregates>,
) => Promise<
  Domain<
    TInfrastructure,
    TStandaloneCommand,
    TStandaloneQuery,
    InferAggregateMapCommands<TAggregates>,
    InferProjectionMapQueries<TProjections>,
    TProjections
  >
>;

/**
 * The running domain instance. Created via wireDomain, it is the primary
 * entry point for dispatching commands and queries.
 *
 * dispatchCommand accepts aggregate commands (from registered aggregates)
 * and standalone commands (from registered standalone command handlers).
 * dispatchQuery accepts projection queries (from registered projections)
 * and standalone queries (from registered standalone query handlers).
 */
class Domain<
  TInfrastructure extends Infrastructure,
  TStandaloneCommand extends Command = Command,
  TStandaloneQuery extends Query<any> = Query<any>,
  TAggregateCommand extends AggregateCommand<any> = AggregateCommand<any>,
  TProjectionQuery extends Query<any> = Query<any>,
  TProjections extends ProjectionMap = ProjectionMap,
> {
  /** The fully resolved infrastructure (custom + CQRS buses + framework logger). */
  get infrastructure(): TInfrastructure &
    CQRSInfrastructure &
    FrameworkInfrastructure;

  /**
   * Dispatches a command to the appropriate aggregate or standalone handler.
   * Aggregate commands return the targetAggregateId, standalone commands return void.
   */
  dispatchCommand<TCommand extends TAggregateCommand | TStandaloneCommand>(
    command: TCommand,
  ): Promise<
    TCommand extends AggregateCommand<any>
      ? TCommand["targetAggregateId"]
      : void
  >;

  /**
   * Dispatches a query to the registered query handler via the query bus.
   * Returns the typed result from the handler.
   */
  dispatchQuery<TQuery extends TProjectionQuery | TStandaloneQuery>(
    query: TQuery,
  ): Promise<QueryResult<TQuery>>;

  /**
   * Rebuilds the named projection from the event log. The projection name is
   * a typed union of the projections registered in the enclosing domain
   * definition — passing an unknown name is a compile-time error.
   *
   * v1 supports eventual-consistency projections only and requires the
   * caller to halt writes during the rebuild window. See
   * `specs/engine/projection-rebuild.spec.md` for the full contract.
   */
  rebuildProjection<TName extends keyof TProjections & string>(
    name: TName,
    options?: ProjectionRebuildOptions,
  ): Promise<ProjectionRebuildResult>;
}
```

- `InferAggregateMapCommands<TMap>` extracts the union of all command types from a map of aggregates. `InferProjectionMapQueries<TMap>` extracts the union of all query types from a map of projections. Both distribute the corresponding single-aggregate/projection inference across every value in the map.
- `DomainDefinition` and `defineDomain` are owned by `@noddde/core`. See [`ddd/domain-definition`](../core/ddd/domain-definition.spec.md) for the full type contract and behavioral requirements. Engine re-exports both names for backward compatibility — they are referenced throughout this spec exactly as if they were defined locally.
- `AggregateWiring` groups per-aggregate runtime config: persistence, concurrency strategy, and snapshots. All fields optional.
- `ProjectionWiring` provides per-projection view store wiring. Its `viewStore` field is a {@link ViewStoreFactory} singleton — the only accepted form. The legacy `(infrastructure) => ViewStore` function shorthand has been removed.
- `DomainWiring` separates user-provided infrastructure (`infrastructure`) from framework plumbing (`aggregates`, `projections`, `sagas`, `buses`, `unitOfWork`, `idempotency`, `outbox`).
- `DomainWiring.aggregates` is a discriminated union: a single `AggregateWiring` (global — all aggregates share the same config) or a `Record<keyof TAggregates & string, AggregateWiring>` (per-aggregate — each aggregate configured independently). Runtime discrimination: `typeof aggregates.persistence === 'function'` or `typeof aggregates.concurrency !== 'undefined'` or `typeof aggregates.snapshots !== 'undefined'` → global; otherwise per-aggregate record.
- `wireDomain` accepts a `DomainDefinition` and an optional `DomainWiring`. When `wiring` is omitted or `{}`, all infrastructure defaults to in-memory implementations and startup warnings are logged. Resolves all factories, creates a `Domain` instance, calls `init()`, and returns it. All type parameters are inferred from `TDef` (the narrow definition type) via conditional type extraction — the user does not need to specify any generics.
- `wireDomain` computes `TInfrastructure` as the intersection of all infrastructure types declared across aggregates, projections, and sagas. The `wiring.infrastructure` factory must return this computed type. If a component declares `{ clock: Clock }` and another declares `{ emailService: EmailService }`, the factory must return `{ clock: Clock, emailService: EmailService }`. The compiler reports exactly which fields are missing.
- The returned `Domain` is strongly typed: `TAggregateCommand = InferAggregateMapCommands<TAggregates>` and `TProjectionQuery = InferProjectionMapQueries<TProjections>`.
- `Domain.dispatchCommand` accepts the union `TAggregateCommand | TStandaloneCommand`. The return type is conditional: aggregate commands return `targetAggregateId`, standalone commands return `void`. `Domain.dispatchQuery` accepts `TProjectionQuery | TStandaloneQuery`. This provides autocomplete for valid command/query names and infers payload types via discriminated union narrowing.

## Behavioral Requirements

### Domain.init() -- Initialization Sequence

The `init()` method must execute the following steps in order:

1. **Resolve custom infrastructure** -- Call `wiring.infrastructure()` if provided. Store the result. If not provided, use `{}` as the default infrastructure.
2. **Resolve CQRS infrastructure** -- Call `wiring.buses(infrastructure)` if provided, passing the resolved custom infrastructure. Store the `CommandBus`, `EventBus`, and `QueryBus`. If not provided, create default in-memory implementations (`InMemoryCommandBus`, `EventEmitterEventBus`, `InMemoryQueryBus`) and log a warning: `[noddde] Using in-memory CQRS buses. This is not suitable for production.`
   _Note: Auto-connect is deferred to step 13b (after all handler registration) to prevent a race condition where broker-backed buses deliver queued messages before handlers are registered._
3. **Merge infrastructure** -- Combine custom infrastructure and CQRS infrastructure into `this._infrastructure` as `TInfrastructure & CQRSInfrastructure`.
4. **Resolve aggregate persistence** -- Build an `AggregatePersistenceResolver` (strategy pattern, engine-internal) based on the `wiring.aggregates` configuration:
   - **Omitted** (`undefined`): Create a `GlobalAggregatePersistenceResolver` wrapping a default `InMemoryEventSourcedAggregatePersistence` and log a warning: `[noddde] Using in-memory aggregate persistence. This is not suitable for production.`
   - **Global `AggregateWiring`** (has `persistence`, `concurrency`, or `snapshots` key): Call the `persistence` factory, create a `GlobalAggregatePersistenceResolver` wrapping the result.
   - **Per-aggregate record**: Validate that every aggregate in `definition.writeModel.aggregates` has a corresponding entry and that no unknown aggregate names are present. Throw a descriptive error on mismatch. Resolve each factory. Create a `PerAggregatePersistenceResolver` wrapping a `Map<string, PersistenceConfiguration>`.
     Pass the resolver to `CommandLifecycleExecutor`, which calls `resolver.resolve(aggregateName)` at each command dispatch to obtain the persistence for the target aggregate.
5. **Resolve snapshots** -- For each aggregate with `AggregateWiring.snapshots` configured, call `snapshots.store()` and store the `snapshots.strategy`. Both are optional per-aggregate.
6. **Resolve saga persistence** -- Only when `processModel.sagas` is defined and non-empty: call `wiring.sagas.persistence()` if provided. If omitted, default to `InMemorySagaPersistence` and log a warning: `[noddde] Using in-memory saga persistence. This is not suitable for production.` When `processModel` has only `standaloneEventHandlers` and no `sagas`, saga persistence is not resolved and no warning is logged.
   6b. **Resolve outbox store** -- If `wiring.outbox` is provided, call `outbox.store()` to resolve the `OutboxStore`. Create an `OutboxRelay` instance (but do not start it). The outbox store is used to compose the `onEventsProduced` callback (enlisting outbox writes in the UoW) and the `onEventsDispatched` callback (marking entries published by event ID after dispatch).
7. **Register command handlers** -- For each aggregate in `writeModel.aggregates`, register a command handler on the command bus for each command name defined in `Aggregate.decide`. The registered handler encapsulates the full command lifecycle (load, execute, evolve, persist, publish).
8. **Register standalone command handlers** -- For each handler in `writeModel.standaloneCommandHandlers`, register it on the command bus, wrapping it to receive the merged infrastructure.
9. **Register query handlers** -- For each projection in `readModel.projections`, register each query handler from `Projection.queryHandlers` on the query bus.
10. **Register standalone query handlers** -- For each handler in `readModel.standaloneQueryHandlers`, register it on the query bus.
11. **Register event listeners for projections** -- For each projection, subscribe to each event name in `Projection.on` on the event bus. When an event arrives, invoke the reducer to update the projection's view.
12. **Register event listeners for sagas** -- For each saga in `processModel.sagas` (if defined), subscribe to each event name in `Object.keys(saga.on)` on the event bus. When an event arrives, execute the saga event handling lifecycle.
13. **Register standalone event handlers** -- For each handler in `processModel.standaloneEventHandlers` (if defined), subscribe it to the event bus for the corresponding event name. When an event arrives, invoke the handler with the full event and the merged infrastructure (`TInfrastructure & CQRSInfrastructure`). Runs after saga handler registration.
    13b. **Auto-connect buses** -- After ALL handler registration is complete (steps 7-13), iterate over `{ commandBus, eventBus, queryBus }`. For each that passes `isConnectable(bus)`, call `await bus.connect()`. If any `connect()` rejects, propagate the error immediately (fail-fast — the domain cannot operate without its buses). Connecting AFTER handler registration ensures that broker-backed buses do not deliver queued messages before handlers are ready. All adapter implementations support `on()` before `connect()` (handlers are buffered and subscriptions are activated during `connect()`). In-memory buses (which are not `Connectable`) are unaffected.

### Domain.dispatchCommand() -- Command Dispatch Lifecycle

The `dispatchCommand` method executes the following lifecycle for aggregate commands:

1. **Route** -- Look up the aggregate whose `decide` map contains a handler for `command.name`. If no aggregate handles this command, check standalone command handlers.
2. **Load** -- Using the resolved persistence:
   - **Event-sourced (with snapshot)**: If a `SnapshotStore` is configured, call `snapshotStore.load(aggregateName, command.targetAggregateId)` first. If a snapshot is found and the persistence implements `PartialEventLoad`, call `persistence.loadAfterVersion(aggregateName, id, snapshot.version)` to load only post-snapshot events. If the persistence does not implement `PartialEventLoad`, call `persistence.load(aggregateName, id)` and slice the result: `events.slice(snapshot.version)`. Derive `version = snapshot.version + loadedEvents.length`. Replay only the post-snapshot events through `Aggregate.evolve` handlers, starting from `snapshot.state`.
   - **Event-sourced (without snapshot)**: Call `persistence.load(aggregateName, command.targetAggregateId)` to get the full event stream. Derive `version = events.length`. Replay all events through `Aggregate.evolve` handlers, starting from `Aggregate.initialState`, to rebuild the current state.
   - **State-stored**: Call `persistence.load(aggregateName, command.targetAggregateId)` to get `{ state, version }` or `null`. If `null`, use `Aggregate.initialState` with `version = 0`.
3. **Execute** -- Invoke the aggregate's decide handler: `aggregate.decide[command.name](command, currentState, infrastructure)`. The handler returns one or more events.
4. **Evolve** -- For each returned event, evolve the state via `aggregate.evolve[event.name](event.payload, state)` to compute the new state. This ensures the aggregate's in-memory state is consistent with the events.
5. **Persist** -- Save the results with optimistic concurrency:
   - **Event-sourced**: Call `persistence.save(aggregateName, command.targetAggregateId, newEvents, version)` to append the new events. `version` is the stream length observed at load time.
   - **State-stored**: Call `persistence.save(aggregateName, command.targetAggregateId, newState, version)` to store the updated state. `version` is the version observed at load time.
6. **Publish** -- Dispatch all new events sequentially via `for (const e of events) { await eventBus.dispatch(e); }`. This triggers projections and sagas. Sequential dispatch preserves event ordering from a single command — events are guaranteed to arrive at consumers in the same order they were produced by the aggregate's `evolve` chain. This is critical for event-sourced systems where downstream consumers (projections, sagas) depend on causal ordering. After all dispatches complete, proceed to snapshot evaluation.
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
3. **Handler re-execution** -- Decide handlers may be called multiple times during retry. Handlers should be side-effect-free (the Decider pattern already implies this).

**Pessimistic strategy** (`{ strategy: "pessimistic", locker, lockTimeoutMs? }`):

1. **Lock acquisition** -- Before executing the attempt, acquires an exclusive lock via `locker.acquire(aggregateName, aggregateId, lockTimeoutMs)`.
2. **Single attempt** -- Executes the attempt callback once (no retry loop). The lock prevents concurrent access, so `ConcurrencyError` should not occur (the version check on `save()` remains as a safety net).
3. **Lock release** -- Always releases the lock in a `finally` block, even if the attempt throws.
4. **Lock timeout** -- If the lock cannot be acquired within `lockTimeoutMs`, throws `LockTimeoutError` (not retried).

**Both strategies apply to both UoW paths**:

- **Implicit UoW** (normal commands): The strategy wraps the full attempt including UoW creation and commit.
- **Explicit UoW** (`withUnitOfWork`, or a saga's atomic UoW): For optimistic, the strategy still just wraps the lifecycle call — this is a pass-through, since `ConcurrencyError` happens at commit time (outside the strategy). For pessimistic, the lock is acquired before the lifecycle runs and held until the OWNING UoW settles (commit or rollback), not released when the lifecycle call returns — see `specs/engine/executors/command-lifecycle-executor.spec.md` requirements 12/12a. This closes a defect where the lock previously protected only the load phase and was released before the actual write (which happens later, at the owning UoW's commit), allowing a second command to acquire the lock and load stale state before the first command's write had landed — exactly the interleaving pessimistic locking exists to prevent.

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

### Domain.rebuildProjection() -- Projection Rebuild

`rebuildProjection<TName extends keyof TProjections & string>(name, options?)` truncates a projection's view store and replays the entire event log through its `on` map handlers.

1. **Typed name parameter** -- `TName` is constrained to `keyof TProjections & string`. The `TProjections` generic on `Domain` is inferred from `definition.readModel.projections` by `wireDomain` (sixth type parameter). Unknown names produce a `TS2345` error at the call site; runtime checks defend against `any`-typed callers.
2. **Delegation to projection-rebuild helper** -- The method delegates the full pipeline (validation, subscription detach, truncate, replay, subscription re-attach) to the helper defined in `specs/engine/projection-rebuild.spec.md`. The helper consumes the Domain's internal projection registry (`resolvedProjections`, `resolvedViewStoreFactories`), the event bus handle, the projection-subscription registry (populated at init step 11), the wired `PersistenceAdapter.eventReader` (if any), and the resolved event-sourced persistence (for the structural-fallback path).
3. **Subscription registry** -- `init()` step 11 (event listener registration for eventual-consistency projections) MUST additionally record, for each `(projectionName, eventName)` pair, the precise handler function reference registered on the event bus. This registry is stored on the `Domain` instance and read by `rebuildProjection` to detach and re-attach subscriptions atomically. Strong-consistency projections are NOT recorded — they have no event-bus subscriptions to manage.
4. **Pre-init / post-shutdown guards** -- `rebuildProjection` throws `DomainShutdownError` once `_shuttingDown` is true (same as `dispatchCommand`/`dispatchQuery`). If called before `init()`, throws `Error("Domain not initialized")`.
5. **TProjections threading** -- `Domain`'s sixth generic `TProjections extends ProjectionMap = ProjectionMap` defaults to the open `ProjectionMap` type so that legacy callers that omitted the generic (or used `Domain<...>` with five generics) compile unchanged. `wireDomain` AND `InferDomain` MUST pass `ExtractProjections<TDef>` as the sixth argument. Existing call sites that do not explicitly construct `Domain<...>` literals are unaffected.

### Domain.startOutboxRelay() / stopOutboxRelay() / processOutboxOnce() -- Outbox Lifecycle

When `infrastructure.outbox` is configured:

1. **startOutboxRelay()** -- Starts the `OutboxRelay` background polling. Throws `Error("Outbox relay requires outbox configuration")` if outbox is not configured.
2. **stopOutboxRelay()** -- Stops the relay polling. No-op if outbox is not configured or relay is not running.
3. **processOutboxOnce()** -- Delegates to `OutboxRelay.processOnce()`. Returns the number of entries dispatched. Throws if outbox is not configured.

### Domain.withUnitOfWork() -- Outbox Post-Dispatch Marking

When outbox is configured, after the explicit UoW commits and events are dispatched, call `outboxStore.markPublishedByEventIds(eventIds)` (best-effort, errors swallowed). This marks the outbox entries written during the UoW as published, preventing the relay from re-dispatching them.

### Domain.withUnitOfWork() -- Event Publishing Runs Outside the UoW's AsyncLocalStorage Scope

`withUnitOfWork(fn)` creates a UoW, then executes `fn()` and `uow.commit()` inside `this._uowStorage.run(uow, ...)` (so commands dispatched by `fn()` can find the ambient UoW and enlist on it via the explicit-UoW path in `CommandLifecycleExecutor`). Historically, event publishing (`for (const e of events) { await eventBus.dispatch(e); }`) and the outbox post-dispatch marking (above) ALSO ran inside that same `uowStorage.run(...)` callback, after `commit()`.

1. **Publish and outbox-marking run after `uowStorage.run(...)` returns, not nested inside it** -- `withUnitOfWork` captures the commit result (`events`) from inside the ALS scope, but performs the publish loop and outbox marking after that scope has exited. `uow.rollback()` on failure is likewise attempted inside the scope (it's part of settling the UoW), but nothing downstream of settlement runs while `uow` is still the ambient `AsyncLocalStorage` value.
2. **Rationale -- re-entrant dispatch from a standalone event handler** -- A standalone event handler (registered with `processModel.standaloneEventHandlers`, handed `infrastructure.commandBus` by design) that reacts to an event published from `withUnitOfWork` and dispatches a command must NOT observe the just-completed `uow` via `uowStorage.getStore()`. Before this fix, it would: `CommandLifecycleExecutor` would take the explicit-UoW path (since `getStore()` returned the completed `uow`), and `uow.enlist(...)` would throw `"UnitOfWork already completed"` -- swallowed into a log by the event bus, so the command silently never ran. After this fix, `uowStorage.getStore()` returns `undefined` for that re-entrant dispatch (the ALS scope has already exited), so the command takes the implicit-UoW path and succeeds with its own fresh UoW -- identical behavior to a handler reacting to an event from a plain `dispatchCommand()`.
3. **`runUowCompletionHooks(uow, committed)` is invoked exactly once, after settlement, outside the ALS scope, and BEFORE the publish loop** -- This runs any deferred lock releases or deferred snapshot saves that aggregate commands dispatched inside `fn()` registered via `onUowSettled`/`onUowCommitted` (see `specs/engine/executors/command-lifecycle-executor.spec.md` requirement 14a) on this UoW. `committed` is `true` only if `uow.commit()` actually returned; on any failure path (including a failure inside `fn()` itself), it is `false` and only `onUowSettled` hooks run (e.g., lock release) -- `onUowCommitted` hooks (e.g., snapshot save) do not. **Ordering is load-bearing, not incidental:** a deferred pessimistic-lock release MUST run before the publish loop, never after. If it ran after, the lock would still be held while events are being published, and a standalone handler (or any re-entrant path) reacting to one of those events by dispatching a command against the SAME aggregate would queue behind that still-held lock -- with no `lockTimeoutMs` configured, this deadlocks `withUnitOfWork` forever; with one configured, it silently loses the re-entrant command to a `LockTimeoutError` swallowed by the event bus, reintroducing the exact "handler dispatches a command, nothing happens" failure class this fix exists to close. `SagaExecutor` (see `specs/engine/executors/saga-executor.spec.md` requirements 13-15) follows this same hooks-before-publish ordering; `withUnitOfWork` MUST match it exactly, not merely run the hooks "somewhere after settlement."

### defineDomain() -- Identity Function

`defineDomain` lives in `@noddde/core`. See [`ddd/domain-definition`](../core/ddd/domain-definition.spec.md#behavioral-requirements) for its behavioral requirements. `@noddde/engine` re-exports it unchanged.

### wireDomain() -- Factory Function

1. Accept a `DomainDefinition` and an **optional** `DomainWiring` (defaults to `{}`).
2. **Resolve aggregate wiring** — Determine global vs per-aggregate mode:
   - If `wiring.aggregates` is undefined, use defaults (in-memory event-sourced, no concurrency, no snapshots).
   - If `wiring.aggregates` has a `persistence`, `concurrency`, or `snapshots` key at the top level, it is **global mode** — apply the same config to all aggregates.
   - Otherwise, it is **per-aggregate mode** — each key is an aggregate name mapped to its `AggregateWiring`. Validate that every aggregate in `definition.writeModel.aggregates` has a corresponding entry and that no unknown aggregate names are present. Throw a descriptive error on mismatch.
3. **Resolve projection wiring** — For each projection in `definition.readModel.projections`:
   - If `wiring.projections[name]` exists, use its `viewStore` (a `ViewStoreFactory`).
   - Otherwise, fall back to the `Projection.viewStore` field on the definition (also a `ViewStoreFactory`) if present.
   - If neither is set and the projection has `identity`, throw an error (same as today).
   - For each resolved factory, call `getForContext(undefined)` once to obtain the cached, non-transactional base instance used by query handlers and eventual-consistency reads.
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

### Domain.init() -- Fail Loud on Unwired Projection View Stores

During `init()`, after `resolvedViewStoreFactories` is built (step 5.8 area) and before command/query handler registration:

1. **Strong-consistency projection with no wired `ViewStoreFactory` throws at init** -- For every projection with `consistency === "strong"`, `init()` requires a resolvable entry in `resolvedViewStoreFactories`. If missing, `init()` throws synchronously (before any command/query/event registration, before `wireDomain` returns) with a descriptive `Error` naming the projection and stating that `DomainWiring.projections["<name>"].viewStore` (or the projection's own `viewStore` field) must be configured for a strong-consistency projection. This replaces the previous silent behavior of filtering the unwired strong projection out of `onEventsProduced`'s scope with no diagnostic -- a strong-consistency projection is the mode a user picks specifically because they cannot tolerate staleness, so a misconfiguration that leaves it permanently stale must be impossible to miss.
2. **Eventual-consistency projection with no wired `ViewStoreFactory` warns, does not throw** -- For every projection with `consistency !== "strong"` (i.e., `"eventual"` or unset), if `resolvedViewStoreFactories` has no entry, `init()` logs a `warn`-level message via the domain's logger (e.g. `` `Projection "<name>" has no viewStore wired; it will not receive live events.` ``) and proceeds -- the projection is still skipped from event-bus subscription (step 11's existing `if (!viewStoreInstance) continue;`), matching prior behavior, but the skip is no longer silent. This is deliberately a warning, not a throw: an eventual-consistency projection with no store might be legitimately unused in a given deployment (e.g., feature-flagged off, or query-only via a different projection), whereas a strong-consistency projection with no store cannot function AT ALL and always indicates a wiring mistake.
3. **Ordering** -- Both checks run during `init()`, before step 6 (command handler registration) and before `13b`'s bus auto-connect, so a misconfiguration is surfaced before the domain accepts any traffic, not on the first query against the broken projection.

## Invariants

- `Domain.infrastructure` must not be accessed before `init()` completes. The `!` non-null assertion on the private fields indicates they are set during init.
- `dispatchQuery` must not be called before `init()` completes. The `_infrastructure` field (including the query bus) is not assigned until `init()` runs.
- `init()` must be called exactly once. Calling it multiple times may re-register handlers, causing duplicate processing.
- `wireDomain` always returns an initialized domain. If `init()` throws, the promise rejects.
- `defineDomain` invariants are owned by [`ddd/domain-definition`](../core/ddd/domain-definition.spec.md#invariants). Engine re-exports the function unchanged.
- The command bus enforces single-handler-per-command-name. If two aggregates define handlers for the same command name, registration must fail.
- Events are published only after successful persistence. If persistence fails, events must not be published (to avoid inconsistency between the store and downstream subscribers).
- All events from a command are dispatched sequentially after successful persistence. Event ordering from a single command is preserved — events arrive at consumers in the order they were produced.
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
- **Decide handler returns a single event** -- Must be normalized to an array before processing.
- **Decide handler returns empty array** -- No events to evolve, persist, or publish. The aggregate state remains unchanged.
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
- **wireDomain projection viewStore overrides Projection.viewStore** -- If both `wiring.projections[name].viewStore` and `Projection.viewStore` are set, the wiring version takes priority. Both must be `ViewStoreFactory` instances.
- **wireDomain projection viewStore not provided for projection with identity** -- Throws an error (same as today when `Projection.viewStore` is missing for a projection with `identity`).
- **wireDomain projection viewStore as a function** -- Type error at compile time and rejected at runtime: only `ViewStoreFactory` instances (anything with a callable `getForContext` method) are accepted. The legacy `(infra) => ViewStore` shorthand has been removed.
- **defineDomain edge cases** -- See [`ddd/domain-definition`](../core/ddd/domain-definition.spec.md#edge-cases).
- **Strong-consistency projection, `viewStore` omitted from both wiring and definition** -- `wireDomain`/`init()` throws synchronously, before the domain is usable. No command can be dispatched against a domain in this state.
- **Eventual-consistency projection, `viewStore` omitted** -- `init()` succeeds, but logs a `warn`. The projection never receives live events (pre-existing skip behavior) and its query handlers (if any) will only ever see whatever a manual `rebuildProjection` or external write populated -- typically nothing.
- **Standalone event handler dispatches a command in reaction to an event published by `withUnitOfWork`** -- Succeeds via its own implicit UoW. Does not throw `"UnitOfWork already completed"` (see the new `Domain.withUnitOfWork() -- Event Publishing Runs Outside the UoW's AsyncLocalStorage Scope` section above).
- **Pessimistic concurrency inside `withUnitOfWork`, second command targets the same aggregate before the first's `withUnitOfWork` call resolves** -- The second command's lock acquisition blocks (or times out per `lockTimeoutMs`) until the first `withUnitOfWork` call's UoW actually commits or rolls back, not merely until the first command's lifecycle function returns.

## Integration Points

- **CQRS buses** -- The domain owns the command bus, query bus, and event bus. They are wired during init and exposed via `domain.infrastructure`.
- **Persistence** -- The domain resolves aggregate persistence during init from factory functions, building an `AggregatePersistenceResolver` (either `GlobalAggregatePersistenceResolver` or `PerAggregatePersistenceResolver`). The resolver is passed to `CommandLifecycleExecutor`. Saga persistence is resolved separately.
- **CommandLifecycleExecutor** -- Internal executor that handles the full aggregate command lifecycle (load, execute, apply, enrich, persist, publish). Created during `init()` and used by `dispatchCommand()` and command bus handlers.
- **SagaExecutor** -- Internal executor that handles the saga event handling lifecycle (derive ID, load state, bootstrap/resume, execute handler, dispatch commands atomically). Created during `init()` when `processModel.sagas` is configured.
- **Standalone event handlers** -- Registered during `init()` from `processModel.standaloneEventHandlers`. Each handler subscribes to its event name on the event bus and receives the full event + merged infrastructure. No executor or persistence needed — handlers are fire-and-forget side effects.
- **MetadataEnricher** -- Internal helper that enriches raw events with metadata (eventId, timestamp, correlationId, causationId, userId, aggregate context). Used by `CommandLifecycleExecutor`.
- **Projections** -- The domain reads `Projection.on` and `Projection.queryHandlers` to wire event listeners and query handlers.
- **External consumers** -- Applications interact with the domain via `domain.dispatchCommand(command)` and `domain.dispatchQuery(query)`. The query bus remains accessible directly via `domain.infrastructure.queryBus` for advanced use cases.

## Test Scenarios

> Test scenarios for `defineDomain` itself (identity, processModel shapes, re-export) live in [`ddd/domain-definition`](../core/ddd/domain-definition.spec.md#test-scenarios). The scenarios below cover `wireDomain` and `Domain` runtime behavior, which exercise `defineDomain` only as a setup primitive.

### wireDomain creates and initializes a domain from definition + wiring

```ts
import { describe, it, expect } from "vitest";
import { defineDomain } from "@noddde/core";
import {
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
  decide: {
    CreateCounter: (cmd) => ({
      name: "CounterCreated",
      payload: { id: cmd.targetAggregateId },
    }),
    Increment: (cmd) => ({
      name: "Incremented",
      payload: { by: cmd.payload.by },
    }),
  },
  evolve: {
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
import { defineDomain, everyNEvents } from "@noddde/core";
import {
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
  decide: {
    Increment: (cmd) => ({
      name: "Incremented",
      payload: { by: cmd.payload.by },
    }),
  },
  evolve: {
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
  decide: {
    Deposit: (cmd) => ({
      name: "DepositMade",
      payload: { amount: cmd.payload.amount },
    }),
  },
  evolve: {
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
import { defineDomain } from "@noddde/core";
import { wireDomain, Domain, defineAggregate } from "@noddde/engine";
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
  decide: {
    Ping: () => ({ name: "Pinged", payload: {} }),
  },
  evolve: {
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
import { defineDomain } from "@noddde/core";
import { wireDomain, Domain, defineAggregate } from "@noddde/engine";
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
  decide: {
    Ping: () => ({ name: "Pinged", payload: {} }),
  },
  evolve: {
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
import { defineDomain } from "@noddde/core";
import {
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
  decide: {
    AddItem: (cmd) => ({
      name: "ItemAdded",
      payload: { id: cmd.payload.id, name: cmd.payload.name },
    }),
  },
  evolve: {
    ItemAdded: (_p, state) => state,
  },
});

describe("wireDomain projection wiring", () => {
  it("should resolve viewStore from wiring.projections", async () => {
    const viewStore = new InMemoryViewStore<ItemView>();
    const factory = createViewStoreFactory<ItemView>(() => viewStore);

    const definition = defineDomain<TestInfra>({
      writeModel: { aggregates: { Item: ItemAggregate } },
      readModel: { projections: { ItemProjection } },
    });

    const domain = await wireDomain(definition, {
      infrastructure: () => ({ itemViewStore: viewStore }),
      projections: {
        ItemProjection: {
          viewStore: factory,
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
import { defineDomain } from "@noddde/core";
import {
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
  decide: {
    Ping: (_cmd, _state, infra) => ({
      name: "Pinged",
      payload: { at: infra.clock.now().toISOString() },
    }),
  },
  evolve: {
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
import { defineDomain } from "@noddde/core";
import {
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
  decide: {
    Increment: (cmd) => ({
      name: "Incremented",
      payload: { by: cmd.payload.by },
    }),
  },
  evolve: {
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
import { defineDomain } from "@noddde/core";
import {
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
  decide: {
    Increment: (cmd) => ({
      name: "Incremented",
      payload: { by: cmd.payload.by },
    }),
  },
  evolve: {
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
import { defineDomain } from "@noddde/core";
import {
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
  decide: {
    Increment: (cmd) => ({
      name: "Incremented",
      payload: { by: cmd.payload.by },
    }),
  },
  evolve: {
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
import { defineDomain } from "@noddde/core";
import {
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
  decide: {
    Increment: (cmd) => ({
      name: "Incremented",
      payload: { by: cmd.payload.by },
    }),
  },
  evolve: {
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

### dispatchCommand accepts only registered aggregate commands (type-level)

```ts
import { describe, it } from "vitest";
import { expectTypeOf } from "vitest";
import { defineDomain } from "@noddde/core";
import { wireDomain, defineAggregate, defineProjection } from "@noddde/engine";
import type {
  AggregateTypes,
  DefineCommands,
  DefineEvents,
  DefineQueries,
  ProjectionTypes,
  Infrastructure,
} from "@noddde/core";

// --- Two aggregates with distinct command sets ---

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
  decide: {
    Increment: (cmd) => ({
      name: "Incremented",
      payload: { by: cmd.payload.by },
    }),
  },
  evolve: {
    Incremented: (payload, state) => ({ count: state.count + payload.by }),
  },
});

type TodoState = { done: boolean };
type TodoEvent = DefineEvents<{ TodoCreated: { title: string } }>;
type TodoCommand = DefineCommands<{ CreateTodo: { title: string } }>;
type TodoTypes = AggregateTypes & {
  state: TodoState;
  events: TodoEvent;
  commands: TodoCommand;
  infrastructure: Infrastructure;
};

const Todo = defineAggregate<TodoTypes>({
  initialState: { done: false },
  decide: {
    CreateTodo: (cmd) => ({
      name: "TodoCreated",
      payload: { title: cmd.payload.title },
    }),
  },
  evolve: {
    TodoCreated: () => ({ done: false }),
  },
});

// --- Projection with query ---

type CounterView = { total: number };
type CounterQuery = DefineQueries<{
  GetTotal: { payload: void; result: CounterView };
}>;
type CounterProjectionTypes = ProjectionTypes & {
  events: CounterEvent;
  queries: CounterQuery;
  view: CounterView;
  infrastructure: Infrastructure;
};

const CounterProjection = defineProjection<CounterProjectionTypes>({
  on: {
    Incremented: {
      id: (event) => "global",
      reduce: (event, view) => ({
        total: (view?.total ?? 0) + event.payload.by,
      }),
    },
  },
  queryHandlers: {
    GetTotal: (_payload, { views }) => views.load("global"),
  },
  initialView: { total: 0 },
});

describe("typed dispatch - aggregate commands", () => {
  it("should accept commands from registered aggregates", async () => {
    const definition = defineDomain({
      writeModel: { aggregates: { Counter, Todo } },
      readModel: { projections: { CounterProjection } },
    });

    const domain = await wireDomain(definition);

    // These should compile — valid aggregate commands
    await domain.dispatchCommand({
      name: "Increment",
      targetAggregateId: "c-1",
      payload: { by: 5 },
    });
    await domain.dispatchCommand({
      name: "CreateTodo",
      targetAggregateId: "t-1",
      payload: { title: "Test" },
    });
  });

  it("should reject commands not in any aggregate", async () => {
    const definition = defineDomain({
      writeModel: { aggregates: { Counter } },
      readModel: { projections: {} },
    });

    const domain = await wireDomain(definition);

    // @ts-expect-error — "FooBar" is not a registered command
    await domain.dispatchCommand({
      name: "FooBar",
      targetAggregateId: "x",
      payload: {},
    });
  });

  it("should return targetAggregateId for aggregate commands", async () => {
    const definition = defineDomain({
      writeModel: { aggregates: { Counter } },
      readModel: { projections: {} },
    });

    const domain = await wireDomain(definition);

    const result = await domain.dispatchCommand({
      name: "Increment",
      targetAggregateId: "c-1",
      payload: { by: 1 },
    });

    expectTypeOf(result).toEqualTypeOf<string>();
  });
});
```

### dispatchCommand accepts standalone commands (type-level)

```ts
import { describe, it } from "vitest";
import { expectTypeOf } from "vitest";
import { defineDomain } from "@noddde/core";
import { wireDomain, defineAggregate } from "@noddde/engine";
import type {
  AggregateTypes,
  Command,
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
  decide: {
    Increment: (cmd) => ({
      name: "Incremented",
      payload: { by: cmd.payload.by },
    }),
  },
  evolve: {
    Incremented: (payload, state) => ({ count: state.count + payload.by }),
  },
});

type NotifyCommand = { name: "SendNotification"; payload: { message: string } };

describe("typed dispatch - standalone commands", () => {
  it("should accept standalone commands from registered handlers", async () => {
    const definition = defineDomain<Infrastructure, NotifyCommand>({
      writeModel: {
        aggregates: { Counter },
        standaloneCommandHandlers: {
          SendNotification: (cmd, infra) => {},
        },
      },
      readModel: { projections: {} },
    });

    const domain = await wireDomain(definition);

    // Standalone command — should compile
    await domain.dispatchCommand({
      name: "SendNotification",
      payload: { message: "hello" },
    });

    // Aggregate command — should also compile
    await domain.dispatchCommand({
      name: "Increment",
      targetAggregateId: "c-1",
      payload: { by: 1 },
    });
  });

  it("should return void for standalone commands", async () => {
    const definition = defineDomain<Infrastructure, NotifyCommand>({
      writeModel: {
        aggregates: {},
        standaloneCommandHandlers: {
          SendNotification: (cmd, infra) => {},
        },
      },
      readModel: { projections: {} },
    });

    const domain = await wireDomain(definition);

    const result = await domain.dispatchCommand({
      name: "SendNotification",
      payload: { message: "hello" },
    });

    expectTypeOf(result).toEqualTypeOf<void>();
  });
});
```

### dispatchQuery accepts only registered projection and standalone queries (type-level)

```ts
import { describe, it } from "vitest";
import { expectTypeOf } from "vitest";
import { defineDomain } from "@noddde/core";
import { wireDomain, defineProjection } from "@noddde/engine";
import type {
  DefineEvents,
  DefineQueries,
  ProjectionTypes,
  Infrastructure,
  Query,
  QueryResult,
} from "@noddde/core";

type ItemEvent = DefineEvents<{ ItemAdded: { id: string; name: string } }>;
type ItemView = { id: string; name: string };
type ItemQuery = DefineQueries<{
  GetItem: { payload: { id: string }; result: ItemView | null };
}>;
type ItemProjectionTypes = ProjectionTypes & {
  events: ItemEvent;
  queries: ItemQuery;
  view: ItemView;
  infrastructure: Infrastructure;
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
});

type HealthQuery = DefineQueries<{
  GetHealth: { payload: void; result: { status: string } };
}>;

describe("typed dispatch - queries", () => {
  it("should accept queries from registered projections", async () => {
    const definition = defineDomain({
      writeModel: { aggregates: {} },
      readModel: { projections: { ItemProjection } },
    });

    const domain = await wireDomain(definition);

    // Should compile — valid projection query
    const item = await domain.dispatchQuery({
      name: "GetItem",
      payload: { id: "item-1" },
    });

    // Result type should be inferred
    expectTypeOf(item).toEqualTypeOf<ItemView | null>();
  });

  it("should accept standalone queries from registered handlers", async () => {
    type StandaloneQ = HealthQuery;

    const definition = defineDomain<Infrastructure, never, StandaloneQ>({
      writeModel: { aggregates: {} },
      readModel: {
        projections: { ItemProjection },
        standaloneQueryHandlers: {
          GetHealth: (_payload) => ({ status: "ok" }),
        },
      },
    });

    const domain = await wireDomain(definition);

    // Standalone query — should compile
    const health = await domain.dispatchQuery({
      name: "GetHealth",
    });
    expectTypeOf(health).toEqualTypeOf<{ status: string }>();

    // Projection query — should also compile
    const item = await domain.dispatchQuery({
      name: "GetItem",
      payload: { id: "item-1" },
    });
    expectTypeOf(item).toEqualTypeOf<ItemView | null>();
  });

  it("should reject queries not in any projection or standalone handler", async () => {
    const definition = defineDomain({
      writeModel: { aggregates: {} },
      readModel: { projections: { ItemProjection } },
    });

    const domain = await wireDomain(definition);

    // @ts-expect-error — "NonExistent" is not a registered query
    await domain.dispatchQuery({
      name: "NonExistent",
      payload: {},
    });
  });
});
```

### InferAggregateMapCommands extracts union from multi-aggregate map

```ts
import { describe, it } from "vitest";
import { expectTypeOf } from "vitest";
import { defineAggregate } from "@noddde/engine";
import type {
  AggregateTypes,
  DefineCommands,
  DefineEvents,
  Infrastructure,
  InferAggregateMapCommands,
} from "@noddde/core";

type CounterCommand = DefineCommands<{ Increment: { by: number } }>;
type CounterEvent = DefineEvents<{ Incremented: { by: number } }>;
type CounterTypes = AggregateTypes & {
  state: { count: number };
  events: CounterEvent;
  commands: CounterCommand;
  infrastructure: Infrastructure;
};

const Counter = defineAggregate<CounterTypes>({
  initialState: { count: 0 },
  decide: {
    Increment: (cmd) => ({
      name: "Incremented",
      payload: { by: cmd.payload.by },
    }),
  },
  evolve: {
    Incremented: (payload, state) => ({ count: state.count + payload.by }),
  },
});

type TodoCommand = DefineCommands<{ CreateTodo: { title: string } }>;
type TodoEvent = DefineEvents<{ TodoCreated: { title: string } }>;
type TodoTypes = AggregateTypes & {
  state: { done: boolean };
  events: TodoEvent;
  commands: TodoCommand;
  infrastructure: Infrastructure;
};

const Todo = defineAggregate<TodoTypes>({
  initialState: { done: false },
  decide: {
    CreateTodo: (cmd) => ({
      name: "TodoCreated",
      payload: { title: cmd.payload.title },
    }),
  },
  evolve: {
    TodoCreated: () => ({ done: false }),
  },
});

describe("InferAggregateMapCommands", () => {
  it("should extract command union from multi-aggregate map", () => {
    const aggregates = { Counter, Todo } as const;
    type Commands = InferAggregateMapCommands<typeof aggregates>;

    // Should be the union of CounterCommand | TodoCommand
    expectTypeOf<Commands>().toMatchTypeOf<
      | {
          name: "Increment";
          targetAggregateId: string;
          payload: { by: number };
        }
      | {
          name: "CreateTodo";
          targetAggregateId: string;
          payload: { title: string };
        }
    >();
  });
});
```

### InferProjectionMapQueries extracts union from multi-projection map

```ts
import { describe, it } from "vitest";
import { expectTypeOf } from "vitest";
import { defineProjection } from "@noddde/engine";
import type {
  DefineEvents,
  DefineQueries,
  ProjectionTypes,
  Infrastructure,
  InferProjectionMapQueries,
} from "@noddde/core";

type ItemEvent = DefineEvents<{ ItemAdded: { id: string; name: string } }>;
type ItemView = { id: string; name: string };
type ItemQuery = DefineQueries<{
  GetItem: { payload: { id: string }; result: ItemView | null };
}>;
type ItemProjectionTypes = ProjectionTypes & {
  events: ItemEvent;
  queries: ItemQuery;
  view: ItemView;
  infrastructure: Infrastructure;
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
});

type OrderEvent = DefineEvents<{
  OrderPlaced: { orderId: string; total: number };
}>;
type OrderView = { orderId: string; total: number };
type OrderQuery = DefineQueries<{
  GetOrder: { payload: { orderId: string }; result: OrderView | null };
}>;
type OrderProjectionTypes = ProjectionTypes & {
  events: OrderEvent;
  queries: OrderQuery;
  view: OrderView;
  infrastructure: Infrastructure;
};

const OrderProjection = defineProjection<OrderProjectionTypes>({
  on: {
    OrderPlaced: {
      id: (event) => event.payload.orderId,
      reduce: (event) => ({
        orderId: event.payload.orderId,
        total: event.payload.total,
      }),
    },
  },
  queryHandlers: {
    GetOrder: (payload, { views }) => views.load(payload.orderId),
  },
  initialView: { orderId: "", total: 0 },
});

describe("InferProjectionMapQueries", () => {
  it("should extract query union from multi-projection map", () => {
    const projections = { ItemProjection, OrderProjection } as const;
    type Queries = InferProjectionMapQueries<typeof projections>;

    // Should be the union of ItemQuery | OrderQuery
    expectTypeOf<Queries>().toMatchTypeOf<
      { name: "GetItem" } | { name: "GetOrder" }
    >();
  });
});
```

### init throws when a strong-consistency projection has no wired viewStore

```ts
import { describe, it, expect } from "vitest";
import { defineDomain, defineAggregate, defineProjection } from "@noddde/core";
import { wireDomain } from "@noddde/engine";
import type {
  AggregateTypes,
  DefineCommands,
  DefineEvents,
  DefineQueries,
  Infrastructure,
} from "@noddde/core";

type ItemEvent = DefineEvents<{ ItemCreated: { id: string } }>;
type ItemCommand = DefineCommands<{ CreateItem: { id: string } }>;
type ItemQuery = DefineQueries<{
  GetItem: { payload: { id: string }; result: { id: string } | null };
}>;
type ItemTypes = AggregateTypes & {
  state: { id: string } | null;
  commands: ItemCommand;
  events: ItemEvent;
  infrastructure: Infrastructure;
};

const Item = defineAggregate<ItemTypes>({
  initialState: null,
  decide: {
    CreateItem: (cmd) => ({
      name: "ItemCreated",
      payload: { id: cmd.payload.id },
    }),
  },
  evolve: { ItemCreated: (p) => ({ id: p.id }) },
});

const StrongSummary = defineProjection<{
  events: ItemEvent;
  queries: ItemQuery;
  view: { id: string };
  infrastructure: Infrastructure;
}>({
  consistency: "strong",
  on: {
    ItemCreated: {
      id: (e) => e.payload.id,
      reduce: (e) => ({ id: e.payload.id }),
    },
  },
  queryHandlers: {},
});

describe("Domain.init: fail loud on unwired strong-consistency projection", () => {
  it("should throw during wireDomain when no viewStore is wired for a strong projection", async () => {
    const def = defineDomain({
      writeModel: { aggregates: { Item } },
      readModel: { projections: { StrongSummary } },
    });

    // No `projections: { StrongSummary: { viewStore: ... } }` wiring at all.
    await expect(wireDomain(def)).rejects.toThrow(/StrongSummary/);
  });
});
```

### init warns (does not throw) when an eventual-consistency projection has no wired viewStore

```ts
import { describe, it, expect } from "vitest";
import { defineDomain, defineAggregate, defineProjection } from "@noddde/core";
import { wireDomain } from "@noddde/engine";
import type {
  AggregateTypes,
  DefineCommands,
  DefineEvents,
  DefineQueries,
  Infrastructure,
  Logger,
} from "@noddde/core";

type ItemEvent = DefineEvents<{ ItemCreated: { id: string } }>;
type ItemCommand = DefineCommands<{ CreateItem: { id: string } }>;
type ItemQuery = DefineQueries<{
  GetItem: { payload: { id: string }; result: { id: string } | null };
}>;
type ItemTypes = AggregateTypes & {
  state: { id: string } | null;
  commands: ItemCommand;
  events: ItemEvent;
  infrastructure: Infrastructure;
};

const Item = defineAggregate<ItemTypes>({
  initialState: null,
  decide: {
    CreateItem: (cmd) => ({
      name: "ItemCreated",
      payload: { id: cmd.payload.id },
    }),
  },
  evolve: { ItemCreated: (p) => ({ id: p.id }) },
});

const EventualSummary = defineProjection<{
  events: ItemEvent;
  queries: ItemQuery;
  view: { id: string };
  infrastructure: Infrastructure;
}>({
  on: {
    ItemCreated: {
      id: (e) => e.payload.id,
      reduce: (e) => ({ id: e.payload.id }),
    },
  },
  queryHandlers: {},
});

describe("Domain.init: warn on unwired eventual-consistency projection", () => {
  it("should not throw, and should log a warning naming the projection", async () => {
    const warnings: string[] = [];
    const logger: Logger = {
      debug: () => {},
      info: () => {},
      warn: (message: string) => warnings.push(message),
      error: () => {},
      child: () => logger,
    };

    const def = defineDomain({
      writeModel: { aggregates: { Item } },
      readModel: { projections: { EventualSummary } },
    });

    // No `projections: { EventualSummary: { viewStore: ... } }` wiring.
    const domain = await wireDomain(def, { logger });

    expect(domain).toBeDefined();
    expect(warnings.some((w) => w.includes("EventualSummary"))).toBe(true);
  });
});
```

### withUnitOfWork: pessimistic lock is released before publish, so a same-aggregate re-entrant dispatch does not deadlock

> Regression guard for the hooks-before-publish ordering (requirement 3 above). If the lock release hook ran AFTER the publish loop instead of before it, this test would time out (or, with `lockTimeoutMs` set as it is here, resolve with a swallowed `LockTimeoutError` and the target's state never updated) instead of completing quickly with the aggregate updated twice.

```ts
import { describe, it, expect } from "vitest";
import { defineDomain, defineAggregate } from "@noddde/core";
import {
  wireDomain,
  InMemoryEventSourcedAggregatePersistence,
  InMemoryAggregateLocker,
  InMemoryCommandBus,
  EventEmitterEventBus,
  InMemoryQueryBus,
} from "@noddde/engine";
import type {
  AggregateTypes,
  DefineCommands,
  DefineEvents,
  Infrastructure,
} from "@noddde/core";

type CounterEvent = DefineEvents<{ Bumped: { by: number } }>;
type CounterCommand = DefineCommands<{ Bump: { by: number } }>;
type CounterTypes = AggregateTypes & {
  state: { total: number };
  commands: CounterCommand;
  events: CounterEvent;
  infrastructure: Infrastructure;
};

const Counter = defineAggregate<CounterTypes>({
  initialState: { total: 0 },
  decide: {
    Bump: (cmd) => ({ name: "Bumped", payload: { by: cmd.payload.by } }),
  },
  evolve: {
    Bumped: (p, s) => ({ total: s.total + p.by }),
  },
});

describe("Domain.withUnitOfWork: pessimistic lock released before publish", () => {
  it("should let a same-aggregate re-entrant dispatch proceed instead of deadlocking on the still-held lock", async () => {
    const sharedPersistence = new InMemoryEventSourcedAggregatePersistence();

    const definition = defineDomain({
      writeModel: { aggregates: { Counter } },
      readModel: { projections: {} },
      processModel: {
        standaloneEventHandlers: {
          Bumped: async (event, infrastructure) => {
            // Re-entrant dispatch against the SAME aggregate the just-committed
            // withUnitOfWork call targeted.
            if (event.payload.by === 1) {
              await infrastructure.commandBus.dispatch({
                name: "Bump",
                targetAggregateId: "c-1",
                payload: { by: 100 },
              });
            }
          },
        },
      },
    });

    const domain = await wireDomain(definition, {
      aggregates: {
        persistence: () => sharedPersistence,
        concurrency: {
          strategy: "pessimistic",
          locker: new InMemoryAggregateLocker(),
          lockTimeoutMs: 500,
        },
      },
      buses: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus: new EventEmitterEventBus(),
        queryBus: new InMemoryQueryBus(),
      }),
    });

    await domain.withUnitOfWork(async () => {
      await domain.dispatchCommand({
        name: "Bump",
        targetAggregateId: "c-1",
        payload: { by: 1 },
      });
    });

    const events = await sharedPersistence.load("Counter", "c-1");
    expect(events).toHaveLength(2);
    expect(events[1]!.payload).toEqual({ by: 100 });
  });
});
```

### withUnitOfWork: a standalone handler can dispatch a command in reaction to a published event

```ts
import { describe, it, expect } from "vitest";
import { defineDomain, defineAggregate } from "@noddde/core";
import {
  wireDomain,
  InMemoryEventSourcedAggregatePersistence,
  InMemoryCommandBus,
  EventEmitterEventBus,
  InMemoryQueryBus,
} from "@noddde/engine";
import type {
  AggregateTypes,
  DefineCommands,
  DefineEvents,
  Infrastructure,
} from "@noddde/core";

type SourceEvent = DefineEvents<{ SourceDone: { id: string } }>;
type SourceCommand = DefineCommands<{ FinishSource: { id: string } }>;
type SourceTypes = AggregateTypes & {
  state: { done: boolean } | null;
  commands: SourceCommand;
  events: SourceEvent;
  infrastructure: Infrastructure;
};

const Source = defineAggregate<SourceTypes>({
  initialState: null,
  decide: {
    FinishSource: (cmd) => ({
      name: "SourceDone",
      payload: { id: cmd.targetAggregateId as string },
    }),
  },
  evolve: { SourceDone: () => ({ done: true }) },
});

type TargetEvent = DefineEvents<{ TargetUpdated: { id: string } }>;
type TargetCommand = DefineCommands<{ UpdateTarget: { id: string } }>;
type TargetTypes = AggregateTypes & {
  state: { updated: boolean } | null;
  commands: TargetCommand;
  events: TargetEvent;
  infrastructure: Infrastructure;
};

const Target = defineAggregate<TargetTypes>({
  initialState: null,
  decide: {
    UpdateTarget: (cmd) => ({
      name: "TargetUpdated",
      payload: { id: cmd.targetAggregateId as string },
    }),
  },
  evolve: { TargetUpdated: () => ({ updated: true }) },
});

describe("Domain.withUnitOfWork: re-entrant dispatch from a standalone event handler", () => {
  it("should let a standalone handler dispatch a command against a second aggregate without throwing", async () => {
    const sharedPersistence = new InMemoryEventSourcedAggregatePersistence();

    const definition = defineDomain({
      writeModel: { aggregates: { Source, Target } },
      readModel: { projections: {} },
      processModel: {
        standaloneEventHandlers: {
          SourceDone: async (event, infrastructure) => {
            await infrastructure.commandBus.dispatch({
              name: "UpdateTarget",
              targetAggregateId: event.payload.id,
              payload: { id: event.payload.id },
            });
          },
        },
      },
    });

    const domain = await wireDomain(definition, {
      aggregates: { persistence: () => sharedPersistence },
      buses: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus: new EventEmitterEventBus(),
        queryBus: new InMemoryQueryBus(),
      }),
    });

    await domain.withUnitOfWork(async () => {
      await domain.dispatchCommand({
        name: "FinishSource",
        targetAggregateId: "s-1",
        payload: { id: "s-1" },
      });
    });

    const targetEvents = await sharedPersistence.load("Target", "s-1");
    expect(targetEvents).toHaveLength(1);
    expect(targetEvents[0]!.name).toBe("TargetUpdated");
  });
});
```
