---
title: "CommandLifecycleExecutor"
module: engine/executors/command-lifecycle-executor
source_file: packages/engine/src/executors/command-lifecycle-executor.ts
status: implemented
exports: []
depends_on:
  - engine/executors/metadata-enricher
  - engine/aggregate-persistence-resolver
  - edd/event
  - edd/event-metadata
  - ddd/aggregate-root
  - cqrs/command/command
  - persistence
  - persistence/snapshot
  - persistence/idempotency
---

# CommandLifecycleExecutor

> `CommandLifecycleExecutor` executes the full aggregate command lifecycle: load state, execute the decide handler, evolve state, enrich metadata, enlist persistence in a unit of work, defer event publishing, and evaluate the snapshot strategy. It manages UoW ownership (implicit vs. explicit) and delegates concurrency control to a `ConcurrencyStrategy`. This is an engine-internal class instantiated by `Domain` during `init()`.

## Type Contract

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import type {
  Aggregate,
  AggregateCommand,
  CQRSInfrastructure,
  IdempotencyStore,
  Infrastructure,
  SnapshotStore,
  SnapshotStrategy,
  UnitOfWork,
  UnitOfWorkFactory,
} from "@noddde/core";
import type { AggregatePersistenceResolver } from "../aggregate-persistence-resolver";
import type { ConcurrencyStrategy } from "../concurrency-strategy";
import type { MetadataEnricher } from "./metadata-enricher";

class CommandLifecycleExecutor {
  constructor(
    persistenceResolver: AggregatePersistenceResolver,
    infrastructure: Infrastructure & CQRSInfrastructure,
    unitOfWorkFactory: UnitOfWorkFactory,
    concurrencyStrategy: ConcurrencyStrategy,
    uowStorage: AsyncLocalStorage<UnitOfWork>,
    metadataEnricher: MetadataEnricher,
    snapshotStore?: SnapshotStore,
    snapshotStrategy?: SnapshotStrategy,
    idempotencyStore?: IdempotencyStore,
    onEventsProduced?: (events: Event[], uow: UnitOfWork) => Promise<void>,
    onEventsDispatched?: (events: Event[]) => Promise<void>,
  );

  execute(
    aggregateName: string,
    aggregate: Aggregate<any>,
    command: AggregateCommand,
  ): Promise<void>;
}
```

- `CommandLifecycleExecutor` is constructed with all dependencies needed for the lifecycle: an `AggregatePersistenceResolver` (which resolves the correct persistence for each aggregate by name), infrastructure (including CQRS buses), UoW factory, concurrency strategy, UoW storage (for detecting explicit UoW), metadata enricher, and optional snapshot store/strategy.
- `execute` is the single public method. It runs the full lifecycle for a given aggregate command, handling UoW creation/ownership and concurrency delegation internally.

## Behavioral Requirements

### Load Phase

1. **Event-sourced with snapshot** -- If a `SnapshotStore` is configured, call `snapshotStore.load(aggregateName, command.targetAggregateId)` first. If a snapshot is found:

   - If the persistence implements `PartialEventLoad` (has a `loadAfterVersion` method), call `persistence.loadAfterVersion(aggregateName, id, snapshot.version)` to load only post-snapshot events.
   - If the persistence does not implement `PartialEventLoad`, call `persistence.load(aggregateName, id)` and slice the result: `events.slice(snapshot.version)`.
   - Derive `version = snapshot.version + loadedEvents.length`.
   - Replay only the post-snapshot events through `aggregate.evolve` handlers, starting from `snapshot.state`.

2. **Event-sourced without snapshot** -- If no snapshot is found (or no `SnapshotStore` is configured), call `persistence.load(aggregateName, command.targetAggregateId)`. If the result is an array (event-sourced):

   - Derive `version = events.length`.
   - Replay all events through `aggregate.evolve` handlers, starting from `aggregate.initialState`.

3. **State-stored** -- If `persistence.load` returns a non-array result (state-stored):
   - The result is `{ state, version } | null`.
   - If `null`, use `aggregate.initialState` with `version = 0`.
   - Otherwise, use the returned `state` and `version`.

### Execute Phase

4. **Invoke decide handler** -- Look up the handler via `aggregate.decide[command.name]`. If no handler is found, throw an error: `"No decide handler found for command: ${command.name} on aggregate: ${aggregateName}"`. Otherwise, invoke the handler with `(command, currentState, infrastructure)`. The handler may return a single event or an array of events.

### Normalize Phase

5. **Single event to array** -- If the decide handler returns a single event (not an array), wrap it in an array. If it returns an array, use it as-is.

### Evolve Phase

6. **Evolve state from events** -- For each event in the normalized array, look up the evolve handler via `aggregate.evolve[event.name]`. If found, apply it: `newState = evolveHandler(event.payload, state)`. If no evolve handler exists for an event name, the state is unchanged.

### Enrich Phase

7. **Delegate to MetadataEnricher** -- Call `metadataEnricher.enrich(newEvents, aggregateName, command.targetAggregateId, version, command.name)` to attach metadata to all events. `command.name` is used as the `causationFallback`.

### Enlist Phase

8. **Enlist persistence in UoW** -- Enlist a deferred write operation on the UoW:
   - **Event-sourced**: `uow.enlist(() => persistence.save(aggregateName, id, enrichedEvents, version))`.
   - **State-stored**: `uow.enlist(() => persistence.save(aggregateName, id, newState, version))`.

### Defer Phase

9. **Defer event publishing** -- Call `uow.deferPublish(...enrichedEvents)` to schedule the enriched events for publishing after UoW commit.

### Snapshot Evaluation

10. **Evaluate snapshot strategy** -- If the persistence is event-sourced, a `SnapshotStore` is configured, and a `SnapshotStrategy` is configured:
    - Compute `newVersion = version + newEvents.length`.
    - Compute `lastSnapshotVersion = snapshot?.version ?? 0`.
    - Compute `eventsSinceSnapshot = newVersion - lastSnapshotVersion`.
    - Call the strategy function with `{ version: newVersion, lastSnapshotVersion, eventsSinceSnapshot }`.
    - If the strategy returns `true`, return a pending snapshot `{ aggregateName, aggregateId, snapshot: { state: newState, version: newVersion } }`.
    - If the strategy returns `false` (or is not configured), return `null`.

### Idempotent Command Processing

10b. **Idempotency check** (at the top of `execute`, before any other work) -- If `idempotencyStore` is configured AND `command.commandId != null`: - Call `idempotencyStore.exists(command.commandId)`. - If `true`: return immediately. Skip all subsequent phases — no load, no execute, no persist, no publish. - If `false`: proceed with normal lifecycle.

10c. **Idempotency record save** (after event persistence enlistment, within the same UoW) -- If `command.commandId != null` and execution proceeds: - Enlist `idempotencyStore.save({ commandId, aggregateName, aggregateId, processedAt })` in the UoW after the event persistence enlistment. - This ensures atomicity: if event persistence fails and the UoW rolls back, the idempotency record is not saved.

10d. **Bypass conditions** -- Idempotency is skipped entirely when: - `idempotencyStore` is not provided (undefined in constructor). - `command.commandId` is `undefined` or not present.

### UoW Management

11. **Implicit UoW (no existing UoW)** -- When no UoW is in the `AsyncLocalStorage`:

    - The concurrency strategy wraps the full attempt: UoW creation, lifecycle execution, and UoW commit.
    - On success, `uow.commit()` is called and returns the deferred events.
    - On failure, `uow.rollback()` is called (best-effort; rollback errors are swallowed).
    - After successful commit, the pending snapshot (if any) is saved to the snapshot store (best-effort; save errors are swallowed).
    - After successful commit, all returned events are dispatched sequentially via `for (const e of events) { await eventBus.dispatch(e); }` to preserve causal ordering.

12. **Explicit UoW (existing UoW in storage)** -- When a UoW is already in the `AsyncLocalStorage` (via `withUnitOfWork` or saga handling):
    - The lifecycle enlists persistence and defers events on the existing UoW.
    - No events are dispatched by the executor itself; the owning UoW (the code that eventually calls `uow.commit()` -- `Domain.withUnitOfWork` or `SagaExecutor`) handles commit and event publishing.
    - **Locking is held across the owning commit, not just the lifecycle.** If `concurrencyStrategy.acquireForUow` is defined (see requirement 12a), the executor calls it instead of wrapping the lifecycle in `concurrencyStrategy.execute()`. This acquires whatever guard the strategy provides (e.g. a pessimistic lock) and defers its release until the _owning_ UoW settles -- not until this method returns. This closes the gap where a pessimistic lock protected only the load-and-enlist phase while the actual write happened later, unprotected, at the owning UoW's commit. If the strategy has no `acquireForUow` (e.g. `OptimisticConcurrencyStrategy`, which holds nothing to release), the executor falls back to the pre-existing behavior of wrapping the lifecycle in `concurrencyStrategy.execute()` -- optimistic concurrency has no lock to hold across commit; the version check on `save()` remains the safety net regardless of UoW ownership.
    - **Snapshot save is deferred to the owning commit, not dropped.** If the snapshot strategy triggers during the explicit-UoW lifecycle (see requirement 10), the pending snapshot is registered via `onUowCommitted(existingUow, ...)` (requirement 14a) instead of being silently discarded. It is saved, best-effort, only if and when the owning UoW actually commits.

12a. **`ConcurrencyStrategy.acquireForUow` (optional strategy hook)** -- `packages/engine/src/concurrency-strategy.ts` defines an optional method on `ConcurrencyStrategy`: `acquireForUow(aggregateName, aggregateId, uow): Promise<void>`. `PessimisticConcurrencyStrategy` implements it: acquires the lock via `this.locker.acquire(...)`, then registers `() => this.locker.release(...)` via `onUowSettled(uow, ...)` (requirement 14a) instead of releasing in a `finally` block. `OptimisticConcurrencyStrategy` does not implement it (nothing to hold). `PerAggregateConcurrencyStrategy` always implements it, delegating to the resolved per-aggregate strategy's `acquireForUow` when present, and no-op otherwise -- so composite configurations route correctly regardless of which concrete strategy backs a given aggregate. `acquireForUow` performs no retry (matching `PessimisticConcurrencyStrategy.execute`'s no-retry contract); the caller (`CommandLifecycleExecutor`) runs the lifecycle exactly once after acquiring.

### Concurrency Delegation

13. **Wraps attempt in ConcurrencyStrategy.execute()** -- The full attempt (including UoW create + commit for implicit, or just lifecycle for explicit) is passed to `concurrencyStrategy.execute(aggregateName, command.targetAggregateId, attempt)`. The strategy handles retry logic (optimistic) or lock acquisition/release (pessimistic).

### Post-Commit Operations

14. **Snapshot save is best-effort** -- After implicit UoW commit, if a pending snapshot exists and a `SnapshotStore` is configured, the snapshot is saved. If the save fails, the error is silently swallowed. Snapshot failure does not affect the command result.

15. **Event publishing after implicit commit** -- After implicit UoW commit, all committed events are dispatched sequentially via `for (const e of events) { await eventBus.dispatch(e); }`. Sequential dispatch preserves causal ordering — events from a single command arrive at consumers in the order they were produced by the aggregate.

16. **Post-dispatch callback (best-effort)** -- After dispatching all events in the implicit UoW path, if `onEventsDispatched` is provided, call `onEventsDispatched(events)`. Errors from this callback are silently swallowed. This enables the Domain to mark outbox entries as published after successful dispatch.

14a. **`onUowCommitted` / `onUowSettled` (completion hooks module)** -- `packages/engine/src/uow-completion-hooks.ts` exports a small `WeakMap<UnitOfWork, ...>`-keyed registry with three functions: `onUowCommitted(uow, hook)` (runs `hook` only if the UoW commits successfully), `onUowSettled(uow, hook)` (runs `hook` unconditionally, whether the UoW commits or rolls back), and `runUowCompletionHooks(uow, committed)` (invoked exactly once by whichever code owns that UoW's commit/rollback -- `Domain.withUnitOfWork` and `SagaExecutor`, both covered under `specs/engine/domain.spec.md` and `specs/engine/executors/saga-executor.spec.md` -- after the UoW has settled; runs `onCommitted` hooks first, only if `committed` is `true`, then `onSettled` hooks always; registration for a given UoW is cleared after this runs). This module is engine-internal (not exported from `@noddde/engine`) and exists so that code registering explicit-UoW work (a deferred lock release, a deferred snapshot save) does not need the owning UoW's commit call site to know about that work's specifics -- it just calls `runUowCompletionHooks` generically. A UoW nobody registered hooks on is a no-op lookup.

## Invariants

- The lifecycle phases always execute in order: load, execute, normalize, evolve, enrich, enlist, defer, snapshot evaluation.
- Events are enriched before being enlisted for persistence (enriched events are what gets persisted).
- Events are published only after successful UoW commit (never before).
- Snapshot save never causes a command to fail (errors are swallowed), whether saved directly (implicit UoW) or via a deferred `onUowCommitted` hook (explicit UoW).
- A pessimistic lock acquired for an explicit-UoW command is released exactly once, when the owning UoW settles -- never before, never twice, and never leaked (it releases on rollback too, via `onUowSettled`).
- UoW rollback errors are swallowed (the original error is re-thrown).
- The concurrency strategy always wraps the attempt -- even with 0 retries, the strategy is called.
- `execute` is always async and returns `Promise<void>`.
- Missing decide handler throws a descriptive error.
- The `version` parameter passed to persistence `save` is the version observed at load time (for optimistic concurrency).

## Edge Cases

- **Decide handler returns single event** -- Normalized to `[event]` before evolve/enrich.
- **Decide handler returns empty array** -- No events to evolve, enrich, persist, or publish. The UoW enlist and deferPublish are called with empty data. Snapshot strategy receives `eventsSinceSnapshot` that may be 0 relative to last snapshot.
- **No evolve handler for an event name** -- State is unchanged for that event. No error thrown.
- **No decide handler found** -- Throws `Error` with message identifying the command and aggregate.
- **Snapshot store configured but no strategy** -- No snapshot evaluation occurs.
- **Snapshot strategy configured but no store** -- No snapshot evaluation occurs. Both must be present.
- **State-stored persistence** -- Snapshot evaluation is skipped entirely (only applies to event-sourced).
- **Explicit UoW with pessimistic strategy** -- The lock is acquired before the lifecycle runs and held until the _owning_ UoW settles (commit or rollback) via `onUowSettled`, not released when this method returns. A second command targeting the same aggregate cannot acquire the lock until the first one's owning UoW has actually committed or rolled back -- this is what "serialized access" means for pessimistic concurrency, and it now holds for the explicit-UoW path exactly as it already did for the implicit path.
- **Explicit UoW with a snapshot strategy that triggers** -- The pending snapshot is registered via `onUowCommitted` and saved (best-effort) only after the owning UoW's commit succeeds -- not dropped, and not saved if the owning UoW rolls back.
- **UoW commit fails** -- Rollback is attempted. Original error propagates. No events published, no snapshot saved.
- **PartialEventLoad optimization** -- Only loads events after snapshot version, avoiding full stream replay.
- **Persistence load returns null for state-stored** -- Uses `aggregate.initialState` and `version = 0`.
- **New aggregate (no prior events)** -- Event-sourced: `events = []`, `version = 0`, state is `initialState`. State-stored: `null` result, `version = 0`, state is `initialState`.

## Integration Points

- **MetadataEnricher** -- Called during the enrich phase to attach metadata to raw events.
- **ConcurrencyStrategy** -- Wraps the attempt for retry (optimistic) or locking (pessimistic).
- **UnitOfWork** -- Persistence and event publishing are enlisted/deferred on the UoW for atomic commit.
- **AsyncLocalStorage<UnitOfWork>** -- Checked to determine implicit vs. explicit UoW ownership.
- **AggregatePersistenceResolver** -- Resolves the correct `PersistenceConfiguration` for each aggregate by name. The executor calls `persistenceResolver.resolve(aggregateName)` at the start of `execute()` to obtain the persistence instance. The resolved persistence is either `EventSourcedAggregatePersistence` or `StateStoredAggregatePersistence`; the executor detects the type by checking whether `load` returns an array.
- **SnapshotStore / SnapshotStrategy** -- Optional. Used for snapshot-aware loading and post-command snapshot evaluation.
- **EventBus** -- Events are dispatched after implicit UoW commit.
- **Domain** -- Constructs the executor during `init()` and calls `execute` for each aggregate command dispatch.
- **`uow-completion-hooks.ts`** -- `onUowCommitted`/`onUowSettled` are called during the explicit-UoW path to defer snapshot saves and lock releases to the owning UoW's actual settlement; `runUowCompletionHooks` is called by the owner (`Domain.withUnitOfWork`, `SagaExecutor`), not by this executor.
- **`ConcurrencyStrategy.acquireForUow`** -- Optional hook checked at the top of the explicit-UoW branch; see requirement 12a.

## Test Scenarios

### execute loads event-sourced aggregate and replays events to rebuild state

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import { describe, it, expect, vi } from "vitest";
import { defineAggregate } from "@noddde/core";
import type {
  AggregateTypes,
  DefineCommands,
  DefineEvents,
  Infrastructure,
  UnitOfWork,
} from "@noddde/core";
import {
  InMemoryEventSourcedAggregatePersistence,
  InMemoryCommandBus,
  EventEmitterEventBus,
  InMemoryQueryBus,
  createInMemoryUnitOfWork,
} from "@noddde/engine";
import { CommandLifecycleExecutor } from "../../../executors/command-lifecycle-executor";
import { MetadataEnricher } from "../../../executors/metadata-enricher";
import type { MetadataContext } from "../../../domain";
import { OptimisticConcurrencyStrategy } from "../../../concurrency-strategy";

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
    CreateCounter: (command) => ({
      name: "CounterCreated",
      payload: { id: command.targetAggregateId },
    }),
    Increment: (command) => ({
      name: "Incremented",
      payload: { by: command.payload.by },
    }),
  },
  evolve: {
    CounterCreated: (_payload, state) => state,
    Incremented: (payload, state) => ({ count: state.count + payload.by }),
  },
});

describe("CommandLifecycleExecutor", () => {
  it("should load event-sourced aggregate, execute command, evolve, enrich, persist, and publish", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();
    const eventBus = new EventEmitterEventBus();
    const infrastructure = {
      commandBus: new InMemoryCommandBus(),
      eventBus,
      queryBus: new InMemoryQueryBus(),
    };
    const uowStorage = new AsyncLocalStorage<UnitOfWork>();
    const metadataStorage = new AsyncLocalStorage<MetadataContext>();
    const enricher = new MetadataEnricher(metadataStorage);
    const strategy = new OptimisticConcurrencyStrategy(0);

    const executor = new CommandLifecycleExecutor(
      persistence,
      infrastructure,
      createInMemoryUnitOfWork,
      strategy,
      uowStorage,
      enricher,
    );

    const publishedEvents: any[] = [];
    eventBus.on("CounterCreated", (event: any) => publishedEvents.push(event));

    await executor.execute("Counter", Counter, {
      name: "CreateCounter",
      payload: undefined,
      targetAggregateId: "c1",
    });

    // Verify persistence
    const stored = await persistence.load("Counter", "c1");
    expect(stored).toHaveLength(1);
    expect(stored[0]!.name).toBe("CounterCreated");
    expect(stored[0]!.metadata).toBeDefined();
    expect(stored[0]!.metadata!.aggregateName).toBe("Counter");
    expect(stored[0]!.metadata!.aggregateId).toBe("c1");
    expect(stored[0]!.metadata!.sequenceNumber).toBe(1);

    // Verify event publishing
    expect(publishedEvents).toHaveLength(1);
  });
});
```

### execute handles state-stored persistence

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import { describe, it, expect } from "vitest";
import { defineAggregate } from "@noddde/core";
import type {
  AggregateTypes,
  DefineCommands,
  DefineEvents,
  Infrastructure,
  UnitOfWork,
} from "@noddde/core";
import {
  InMemoryStateStoredAggregatePersistence,
  InMemoryCommandBus,
  EventEmitterEventBus,
  InMemoryQueryBus,
  createInMemoryUnitOfWork,
} from "@noddde/engine";
import { CommandLifecycleExecutor } from "../../../executors/command-lifecycle-executor";
import { MetadataEnricher } from "../../../executors/metadata-enricher";
import type { MetadataContext } from "../../../domain";
import { OptimisticConcurrencyStrategy } from "../../../concurrency-strategy";

type ToggleState = { on: boolean };
type ToggleEvent = DefineEvents<{ Toggled: {} }>;
type ToggleCommand = DefineCommands<{ Toggle: void }>;
type ToggleTypes = AggregateTypes & {
  state: ToggleState;
  events: ToggleEvent;
  commands: ToggleCommand;
  infrastructure: Infrastructure;
};

const Toggle = defineAggregate<ToggleTypes>({
  initialState: { on: false },
  decide: {
    Toggle: () => ({ name: "Toggled", payload: {} }),
  },
  evolve: {
    Toggled: (_payload, state) => ({ on: !state.on }),
  },
});

describe("CommandLifecycleExecutor", () => {
  it("should load state-stored aggregate and persist new state", async () => {
    const persistence = new InMemoryStateStoredAggregatePersistence();
    const eventBus = new EventEmitterEventBus();
    const infrastructure = {
      commandBus: new InMemoryCommandBus(),
      eventBus,
      queryBus: new InMemoryQueryBus(),
    };
    const uowStorage = new AsyncLocalStorage<UnitOfWork>();
    const metadataStorage = new AsyncLocalStorage<MetadataContext>();
    const enricher = new MetadataEnricher(metadataStorage);
    const strategy = new OptimisticConcurrencyStrategy(0);

    const executor = new CommandLifecycleExecutor(
      persistence,
      infrastructure,
      createInMemoryUnitOfWork,
      strategy,
      uowStorage,
      enricher,
    );

    await executor.execute("Toggle", Toggle, {
      name: "Toggle",
      payload: undefined,
      targetAggregateId: "t1",
    });

    const stored = await persistence.load("Toggle", "t1");
    expect(stored).not.toBeNull();
    expect(stored!.state).toEqual({ on: true });
    expect(stored!.version).toBe(1);
  });
});
```

### execute throws when no decide handler is found

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import { describe, it, expect } from "vitest";
import { defineAggregate } from "@noddde/core";
import type {
  AggregateTypes,
  DefineCommands,
  DefineEvents,
  Infrastructure,
  UnitOfWork,
} from "@noddde/core";
import {
  InMemoryEventSourcedAggregatePersistence,
  InMemoryCommandBus,
  EventEmitterEventBus,
  InMemoryQueryBus,
  createInMemoryUnitOfWork,
} from "@noddde/engine";
import { CommandLifecycleExecutor } from "../../../executors/command-lifecycle-executor";
import { MetadataEnricher } from "../../../executors/metadata-enricher";
import type { MetadataContext } from "../../../domain";
import { OptimisticConcurrencyStrategy } from "../../../concurrency-strategy";

const EmptyAggregate = defineAggregate<
  AggregateTypes & {
    state: {};
    events: never;
    commands: never;
    infrastructure: Infrastructure;
  }
>({
  initialState: {},
  decide: {},
  evolve: {},
});

describe("CommandLifecycleExecutor", () => {
  it("should throw an error when the decide handler is not found", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();
    const infrastructure = {
      commandBus: new InMemoryCommandBus(),
      eventBus: new EventEmitterEventBus(),
      queryBus: new InMemoryQueryBus(),
    };
    const uowStorage = new AsyncLocalStorage<UnitOfWork>();
    const metadataStorage = new AsyncLocalStorage<MetadataContext>();
    const enricher = new MetadataEnricher(metadataStorage);
    const strategy = new OptimisticConcurrencyStrategy(0);

    const executor = new CommandLifecycleExecutor(
      persistence,
      infrastructure,
      createInMemoryUnitOfWork,
      strategy,
      uowStorage,
      enricher,
    );

    await expect(
      executor.execute("MyAggregate", EmptyAggregate, {
        name: "UnknownCommand",
        payload: undefined,
        targetAggregateId: "a1",
      }),
    ).rejects.toThrow(
      "No decide handler found for command: UnknownCommand on aggregate: MyAggregate",
    );
  });
});
```

### execute uses existing UoW when one is active (explicit UoW)

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import { describe, it, expect, vi } from "vitest";
import { defineAggregate } from "@noddde/core";
import type {
  AggregateTypes,
  DefineCommands,
  DefineEvents,
  Infrastructure,
  UnitOfWork,
} from "@noddde/core";
import {
  InMemoryEventSourcedAggregatePersistence,
  InMemoryCommandBus,
  EventEmitterEventBus,
  InMemoryQueryBus,
  createInMemoryUnitOfWork,
} from "@noddde/engine";
import { CommandLifecycleExecutor } from "../../../executors/command-lifecycle-executor";
import { MetadataEnricher } from "../../../executors/metadata-enricher";
import type { MetadataContext } from "../../../domain";
import { OptimisticConcurrencyStrategy } from "../../../concurrency-strategy";

type ItemState = { items: string[] };
type ItemEvent = DefineEvents<{ ItemAdded: { item: string } }>;
type ItemCommand = DefineCommands<{ AddItem: { item: string } }>;
type ItemTypes = AggregateTypes & {
  state: ItemState;
  events: ItemEvent;
  commands: ItemCommand;
  infrastructure: Infrastructure;
};

const ItemList = defineAggregate<ItemTypes>({
  initialState: { items: [] },
  decide: {
    AddItem: (command) => ({
      name: "ItemAdded",
      payload: { item: command.payload.item },
    }),
  },
  evolve: {
    ItemAdded: (payload, state) => ({
      items: [...state.items, payload.item],
    }),
  },
});

describe("CommandLifecycleExecutor", () => {
  it("should enlist on existing UoW without committing or publishing events", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();
    const eventBus = new EventEmitterEventBus();
    const infrastructure = {
      commandBus: new InMemoryCommandBus(),
      eventBus,
      queryBus: new InMemoryQueryBus(),
    };
    const uowStorage = new AsyncLocalStorage<UnitOfWork>();
    const metadataStorage = new AsyncLocalStorage<MetadataContext>();
    const enricher = new MetadataEnricher(metadataStorage);
    const strategy = new OptimisticConcurrencyStrategy(0);

    const executor = new CommandLifecycleExecutor(
      persistence,
      infrastructure,
      createInMemoryUnitOfWork,
      strategy,
      uowStorage,
      enricher,
    );

    const publishedEvents: any[] = [];
    eventBus.on("ItemAdded", (event: any) => publishedEvents.push(event));

    const externalUow = createInMemoryUnitOfWork();

    await uowStorage.run(externalUow, async () => {
      await executor.execute("ItemList", ItemList, {
        name: "AddItem",
        payload: { item: "apple" },
        targetAggregateId: "list1",
      });
    });

    // Events should NOT be published yet (UoW not committed)
    expect(publishedEvents).toHaveLength(0);

    // Persistence should NOT have the events yet (UoW not committed)
    const storedBefore = await persistence.load("ItemList", "list1");
    expect(storedBefore).toHaveLength(0);

    // Now commit the external UoW
    const committedEvents = await externalUow.commit();
    expect(committedEvents).toHaveLength(1);
    expect(committedEvents[0]!.name).toBe("ItemAdded");

    // After commit, persistence should have the events
    const storedAfter = await persistence.load("ItemList", "list1");
    expect(storedAfter).toHaveLength(1);
  });
});
```

### execute evaluates snapshot strategy and saves snapshot after implicit commit

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import { describe, it, expect } from "vitest";
import { defineAggregate, everyNEvents } from "@noddde/core";
import type {
  AggregateTypes,
  DefineCommands,
  DefineEvents,
  Infrastructure,
  UnitOfWork,
} from "@noddde/core";
import {
  InMemoryEventSourcedAggregatePersistence,
  InMemoryCommandBus,
  EventEmitterEventBus,
  InMemoryQueryBus,
  InMemorySnapshotStore,
  createInMemoryUnitOfWork,
} from "@noddde/engine";
import { CommandLifecycleExecutor } from "../../../executors/command-lifecycle-executor";
import { MetadataEnricher } from "../../../executors/metadata-enricher";
import type { MetadataContext } from "../../../domain";
import { OptimisticConcurrencyStrategy } from "../../../concurrency-strategy";

type AccState = { total: number };
type AccEvent = DefineEvents<{ Added: { n: number } }>;
type AccCommand = DefineCommands<{ Add: { n: number } }>;
type AccTypes = AggregateTypes & {
  state: AccState;
  events: AccEvent;
  commands: AccCommand;
  infrastructure: Infrastructure;
};

const Accumulator = defineAggregate<AccTypes>({
  initialState: { total: 0 },
  decide: {
    Add: (command) => ({ name: "Added", payload: { n: command.payload.n } }),
  },
  evolve: {
    Added: (payload, state) => ({ total: state.total + payload.n }),
  },
});

describe("CommandLifecycleExecutor", () => {
  it("should save a snapshot when the strategy triggers", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();
    const eventBus = new EventEmitterEventBus();
    const infrastructure = {
      commandBus: new InMemoryCommandBus(),
      eventBus,
      queryBus: new InMemoryQueryBus(),
    };
    const uowStorage = new AsyncLocalStorage<UnitOfWork>();
    const metadataStorage = new AsyncLocalStorage<MetadataContext>();
    const enricher = new MetadataEnricher(metadataStorage);
    const strategy = new OptimisticConcurrencyStrategy(0);
    const snapshotStore = new InMemorySnapshotStore();
    const snapshotStrategy = everyNEvents(3);

    const executor = new CommandLifecycleExecutor(
      persistence,
      infrastructure,
      createInMemoryUnitOfWork,
      strategy,
      uowStorage,
      enricher,
      snapshotStore,
      snapshotStrategy,
    );

    // Dispatch 3 commands to trigger snapshot (everyNEvents(3))
    for (let i = 1; i <= 3; i++) {
      await executor.execute("Accumulator", Accumulator, {
        name: "Add",
        payload: { n: i },
        targetAggregateId: "acc1",
      });
    }

    const snapshot = await snapshotStore.load("Accumulator", "acc1");
    expect(snapshot).not.toBeNull();
    expect(snapshot!.state).toEqual({ total: 6 }); // 1+2+3
    expect(snapshot!.version).toBe(3);
  });
});
```

### execute loads from snapshot and replays only post-snapshot events

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import { describe, it, expect, vi } from "vitest";
import { defineAggregate } from "@noddde/core";
import type {
  AggregateTypes,
  DefineCommands,
  DefineEvents,
  Infrastructure,
  UnitOfWork,
} from "@noddde/core";
import {
  InMemoryEventSourcedAggregatePersistence,
  InMemoryCommandBus,
  EventEmitterEventBus,
  InMemoryQueryBus,
  InMemorySnapshotStore,
  createInMemoryUnitOfWork,
} from "@noddde/engine";
import { CommandLifecycleExecutor } from "../../../executors/command-lifecycle-executor";
import { MetadataEnricher } from "../../../executors/metadata-enricher";
import type { MetadataContext } from "../../../domain";
import { OptimisticConcurrencyStrategy } from "../../../concurrency-strategy";

type ValState = { value: number };
type ValEvent = DefineEvents<{ ValueSet: { v: number } }>;
type ValCommand = DefineCommands<{ SetValue: { v: number } }>;
type ValTypes = AggregateTypes & {
  state: ValState;
  events: ValEvent;
  commands: ValCommand;
  infrastructure: Infrastructure;
};

const ValueAgg = defineAggregate<ValTypes>({
  initialState: { value: 0 },
  decide: {
    SetValue: (command) => ({
      name: "ValueSet",
      payload: { v: command.payload.v },
    }),
  },
  evolve: {
    ValueSet: (payload) => ({ value: payload.v }),
  },
});

describe("CommandLifecycleExecutor", () => {
  it("should load from snapshot and replay only post-snapshot events", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();
    const eventBus = new EventEmitterEventBus();
    const infrastructure = {
      commandBus: new InMemoryCommandBus(),
      eventBus,
      queryBus: new InMemoryQueryBus(),
    };
    const uowStorage = new AsyncLocalStorage<UnitOfWork>();
    const metadataStorage = new AsyncLocalStorage<MetadataContext>();
    const enricher = new MetadataEnricher(metadataStorage);
    const strategy = new OptimisticConcurrencyStrategy(0);
    const snapshotStore = new InMemorySnapshotStore();

    // Pre-seed: save 5 events and a snapshot at version 3
    for (let i = 1; i <= 5; i++) {
      await persistence.save(
        "ValueAgg",
        "v1",
        [{ name: "ValueSet", payload: { v: i * 10 } }],
        i - 1,
      );
    }
    await snapshotStore.save("ValueAgg", "v1", {
      state: { value: 30 },
      version: 3,
    });

    // Spy on persistence.load to verify optimization
    const loadSpy = vi.spyOn(persistence, "load");

    const executor = new CommandLifecycleExecutor(
      persistence,
      infrastructure,
      createInMemoryUnitOfWork,
      strategy,
      uowStorage,
      enricher,
      snapshotStore,
    );

    const publishedEvents: any[] = [];
    eventBus.on("ValueSet", (event: any) => publishedEvents.push(event));

    await executor.execute("ValueAgg", ValueAgg, {
      name: "SetValue",
      payload: { v: 99 },
      targetAggregateId: "v1",
    });

    // A new event should be persisted at version 5 (snapshot 3 + 2 post-snapshot + new)
    const stored = await persistence.load("ValueAgg", "v1");
    expect(stored).toHaveLength(6);
    expect(stored[5]!.payload).toEqual({ v: 99 });

    expect(publishedEvents).toHaveLength(1);
  });
});
```

### execute rolls back UoW on decide handler error

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import { describe, it, expect } from "vitest";
import { defineAggregate } from "@noddde/core";
import type {
  AggregateTypes,
  DefineCommands,
  DefineEvents,
  Infrastructure,
  UnitOfWork,
} from "@noddde/core";
import {
  InMemoryEventSourcedAggregatePersistence,
  InMemoryCommandBus,
  EventEmitterEventBus,
  InMemoryQueryBus,
  createInMemoryUnitOfWork,
} from "@noddde/engine";
import { CommandLifecycleExecutor } from "../../../executors/command-lifecycle-executor";
import { MetadataEnricher } from "../../../executors/metadata-enricher";
import type { MetadataContext } from "../../../domain";
import { OptimisticConcurrencyStrategy } from "../../../concurrency-strategy";

type ErrState = {};
type ErrEvent = DefineEvents<{ Happened: {} }>;
type ErrCommand = DefineCommands<{ Fail: void }>;
type ErrTypes = AggregateTypes & {
  state: ErrState;
  events: ErrEvent;
  commands: ErrCommand;
  infrastructure: Infrastructure;
};

const FailingAggregate = defineAggregate<ErrTypes>({
  initialState: {},
  decide: {
    Fail: () => {
      throw new Error("Handler exploded");
    },
  },
  evolve: {
    Happened: (_payload, state) => state,
  },
});

describe("CommandLifecycleExecutor", () => {
  it("should rollback UoW and propagate handler error", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();
    const eventBus = new EventEmitterEventBus();
    const infrastructure = {
      commandBus: new InMemoryCommandBus(),
      eventBus,
      queryBus: new InMemoryQueryBus(),
    };
    const uowStorage = new AsyncLocalStorage<UnitOfWork>();
    const metadataStorage = new AsyncLocalStorage<MetadataContext>();
    const enricher = new MetadataEnricher(metadataStorage);
    const strategy = new OptimisticConcurrencyStrategy(0);

    const executor = new CommandLifecycleExecutor(
      persistence,
      infrastructure,
      createInMemoryUnitOfWork,
      strategy,
      uowStorage,
      enricher,
    );

    const publishedEvents: any[] = [];
    eventBus.on("Happened", (event: any) => publishedEvents.push(event));

    await expect(
      executor.execute("FailingAggregate", FailingAggregate, {
        name: "Fail",
        payload: undefined,
        targetAggregateId: "f1",
      }),
    ).rejects.toThrow("Handler exploded");

    // No events should be persisted or published
    const stored = await persistence.load("FailingAggregate", "f1");
    expect(stored).toHaveLength(0);
    expect(publishedEvents).toHaveLength(0);
  });
});
```

### explicit UoW: pessimistic lock is held until the owning UoW settles, not released early

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import { describe, it, expect } from "vitest";
import { defineAggregate } from "@noddde/core";
import type {
  AggregateLocker,
  AggregateTypes,
  DefineCommands,
  DefineEvents,
  ID,
  Infrastructure,
  UnitOfWork,
} from "@noddde/core";
import {
  InMemoryEventSourcedAggregatePersistence,
  InMemoryCommandBus,
  EventEmitterEventBus,
  InMemoryQueryBus,
  createInMemoryUnitOfWork,
} from "@noddde/engine";
import { CommandLifecycleExecutor } from "../../../executors/command-lifecycle-executor";
import { MetadataEnricher } from "../../../executors/metadata-enricher";
import type { MetadataContext } from "../../../domain";
import { PessimisticConcurrencyStrategy } from "../../../concurrency-strategy";
import { runUowCompletionHooks } from "../../../uow-completion-hooks";
import { GlobalAggregatePersistenceResolver } from "../../../aggregate-persistence-resolver";

type LockState = { count: number };
type LockEvent = DefineEvents<{ Bumped: {} }>;
type LockCommand = DefineCommands<{ Bump: void }>;
type LockTypes = AggregateTypes & {
  state: LockState;
  events: LockEvent;
  commands: LockCommand;
  infrastructure: Infrastructure;
};

const Counter = defineAggregate<LockTypes>({
  initialState: { count: 0 },
  decide: { Bump: () => ({ name: "Bumped", payload: {} }) },
  evolve: { Bumped: (_p, s) => ({ count: s.count + 1 }) },
});

describe("CommandLifecycleExecutor", () => {
  it("should not release a pessimistic lock until the owning UoW settles", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();
    const infrastructure = {
      commandBus: new InMemoryCommandBus(),
      eventBus: new EventEmitterEventBus(),
      queryBus: new InMemoryQueryBus(),
    };
    const uowStorage = new AsyncLocalStorage<UnitOfWork>();
    const metadataStorage = new AsyncLocalStorage<MetadataContext>();
    const enricher = new MetadataEnricher(metadataStorage);

    const acquired: string[] = [];
    const released: string[] = [];
    let locked = false;
    const locker: AggregateLocker = {
      async acquire(aggregateName: string, aggregateId: ID) {
        if (locked) throw new Error("already locked");
        locked = true;
        acquired.push(`${aggregateName}:${aggregateId}`);
      },
      async release(aggregateName: string, aggregateId: ID) {
        locked = false;
        released.push(`${aggregateName}:${aggregateId}`);
      },
    };
    const strategy = new PessimisticConcurrencyStrategy(locker);

    const executor = new CommandLifecycleExecutor(
      new GlobalAggregatePersistenceResolver(persistence),
      infrastructure,
      createInMemoryUnitOfWork,
      strategy,
      uowStorage,
      enricher,
    );

    const uow = createInMemoryUnitOfWork();
    await uowStorage.run(uow, async () => {
      await executor.execute("Counter", Counter, {
        name: "Bump",
        payload: undefined,
        targetAggregateId: "c1",
      });
    });

    // The lock is acquired but the owning UoW hasn't committed yet --
    // it must still be held.
    expect(acquired).toEqual(["Counter:c1"]);
    expect(released).toEqual([]);

    // A second attempt on the same aggregate must fail to acquire while
    // the first command's owning UoW is still open.
    await expect(
      uowStorage.run(createInMemoryUnitOfWork(), () =>
        executor.execute("Counter", Counter, {
          name: "Bump",
          payload: undefined,
          targetAggregateId: "c1",
        }),
      ),
    ).rejects.toThrow("already locked");

    // The owning UoW now settles (simulating Domain.withUnitOfWork / SagaExecutor).
    await uow.commit();
    await runUowCompletionHooks(uow, true);

    expect(released).toEqual(["Counter:c1"]);
  });
});
```

### explicit UoW: pending snapshot is saved after the owning UoW commits, not dropped

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import { describe, it, expect } from "vitest";
import { defineAggregate, everyNEvents } from "@noddde/core";
import type {
  AggregateTypes,
  DefineCommands,
  DefineEvents,
  Infrastructure,
  UnitOfWork,
} from "@noddde/core";
import {
  InMemoryEventSourcedAggregatePersistence,
  InMemoryCommandBus,
  EventEmitterEventBus,
  InMemoryQueryBus,
  InMemorySnapshotStore,
  createInMemoryUnitOfWork,
} from "@noddde/engine";
import { CommandLifecycleExecutor } from "../../../executors/command-lifecycle-executor";
import { MetadataEnricher } from "../../../executors/metadata-enricher";
import type { MetadataContext } from "../../../domain";
import { OptimisticConcurrencyStrategy } from "../../../concurrency-strategy";
import { runUowCompletionHooks } from "../../../uow-completion-hooks";
import { GlobalAggregatePersistenceResolver } from "../../../aggregate-persistence-resolver";

type AccState = { total: number };
type AccEvent = DefineEvents<{ Added: { n: number } }>;
type AccCommand = DefineCommands<{ Add: { n: number } }>;
type AccTypes = AggregateTypes & {
  state: AccState;
  events: AccEvent;
  commands: AccCommand;
  infrastructure: Infrastructure;
};

const Accumulator = defineAggregate<AccTypes>({
  initialState: { total: 0 },
  decide: {
    Add: (command) => ({ name: "Added", payload: { n: command.payload.n } }),
  },
  evolve: {
    Added: (payload, state) => ({ total: state.total + payload.n }),
  },
});

describe("CommandLifecycleExecutor", () => {
  it("should defer the snapshot save to the owning UoW's commit in the explicit-UoW path", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();
    const infrastructure = {
      commandBus: new InMemoryCommandBus(),
      eventBus: new EventEmitterEventBus(),
      queryBus: new InMemoryQueryBus(),
    };
    const uowStorage = new AsyncLocalStorage<UnitOfWork>();
    const metadataStorage = new AsyncLocalStorage<MetadataContext>();
    const enricher = new MetadataEnricher(metadataStorage);
    const strategy = new OptimisticConcurrencyStrategy(0);
    const snapshotStore = new InMemorySnapshotStore();
    const snapshotStrategy = everyNEvents(1); // trigger on every command

    const executor = new CommandLifecycleExecutor(
      new GlobalAggregatePersistenceResolver(persistence),
      infrastructure,
      createInMemoryUnitOfWork,
      strategy,
      uowStorage,
      enricher,
      () => ({ store: snapshotStore, strategy: snapshotStrategy }),
    );

    const uow = createInMemoryUnitOfWork();
    await uowStorage.run(uow, async () => {
      await executor.execute("Accumulator", Accumulator, {
        name: "Add",
        payload: { n: 5 },
        targetAggregateId: "acc1",
      });
    });

    // Not saved yet -- the owning UoW hasn't committed.
    expect(await snapshotStore.load("Accumulator", "acc1")).toBeNull();

    await uow.commit();
    await runUowCompletionHooks(uow, true);

    const snapshot = await snapshotStore.load("Accumulator", "acc1");
    expect(snapshot).not.toBeNull();
    expect(snapshot!.state).toEqual({ total: 5 });
  });

  it("should NOT save the deferred snapshot if the owning UoW rolls back", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();
    const infrastructure = {
      commandBus: new InMemoryCommandBus(),
      eventBus: new EventEmitterEventBus(),
      queryBus: new InMemoryQueryBus(),
    };
    const uowStorage = new AsyncLocalStorage<UnitOfWork>();
    const metadataStorage = new AsyncLocalStorage<MetadataContext>();
    const enricher = new MetadataEnricher(metadataStorage);
    const strategy = new OptimisticConcurrencyStrategy(0);
    const snapshotStore = new InMemorySnapshotStore();
    const snapshotStrategy = everyNEvents(1);

    const executor = new CommandLifecycleExecutor(
      new GlobalAggregatePersistenceResolver(persistence),
      infrastructure,
      createInMemoryUnitOfWork,
      strategy,
      uowStorage,
      enricher,
      () => ({ store: snapshotStore, strategy: snapshotStrategy }),
    );

    const uow = createInMemoryUnitOfWork();
    await uowStorage.run(uow, async () => {
      await executor.execute("Accumulator", Accumulator, {
        name: "Add",
        payload: { n: 5 },
        targetAggregateId: "acc1",
      });
    });

    await uow.rollback();
    await runUowCompletionHooks(uow, false);

    expect(await snapshotStore.load("Accumulator", "acc1")).toBeNull();
  });
});
```

### execute delegates to concurrency strategy for retry on ConcurrencyError

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import { describe, it, expect, vi } from "vitest";
import { defineAggregate, ConcurrencyError } from "@noddde/core";
import type {
  AggregateTypes,
  DefineCommands,
  DefineEvents,
  Infrastructure,
  UnitOfWork,
  Event,
} from "@noddde/core";
import {
  InMemoryEventSourcedAggregatePersistence,
  InMemoryCommandBus,
  EventEmitterEventBus,
  InMemoryQueryBus,
  createInMemoryUnitOfWork,
} from "@noddde/engine";
import { CommandLifecycleExecutor } from "../../../executors/command-lifecycle-executor";
import { MetadataEnricher } from "../../../executors/metadata-enricher";
import type { MetadataContext } from "../../../domain";
import type { ConcurrencyStrategy } from "../../../concurrency-strategy";

type SimpleState = { value: number };
type SimpleEvent = DefineEvents<{ Updated: { v: number } }>;
type SimpleCommand = DefineCommands<{ Update: { v: number } }>;
type SimpleTypes = AggregateTypes & {
  state: SimpleState;
  events: SimpleEvent;
  commands: SimpleCommand;
  infrastructure: Infrastructure;
};

const SimpleAgg = defineAggregate<SimpleTypes>({
  initialState: { value: 0 },
  decide: {
    Update: (command) => ({
      name: "Updated",
      payload: { v: command.payload.v },
    }),
  },
  evolve: {
    Updated: (payload) => ({ value: payload.v }),
  },
});

describe("CommandLifecycleExecutor", () => {
  it("should invoke concurrency strategy which wraps the attempt", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();
    const eventBus = new EventEmitterEventBus();
    const infrastructure = {
      commandBus: new InMemoryCommandBus(),
      eventBus,
      queryBus: new InMemoryQueryBus(),
    };
    const uowStorage = new AsyncLocalStorage<UnitOfWork>();
    const metadataStorage = new AsyncLocalStorage<MetadataContext>();
    const enricher = new MetadataEnricher(metadataStorage);

    const executeCalls: string[] = [];
    const mockStrategy: ConcurrencyStrategy = {
      async execute(
        aggregateName: string,
        aggregateId: any,
        attempt: () => Promise<Event[]>,
      ) {
        executeCalls.push(`${aggregateName}:${aggregateId}`);
        return attempt();
      },
    };

    const executor = new CommandLifecycleExecutor(
      persistence,
      infrastructure,
      createInMemoryUnitOfWork,
      mockStrategy,
      uowStorage,
      enricher,
    );

    await executor.execute("SimpleAgg", SimpleAgg, {
      name: "Update",
      payload: { v: 42 },
      targetAggregateId: "s1",
    });

    expect(executeCalls).toEqual(["SimpleAgg:s1"]);
  });
});
```
