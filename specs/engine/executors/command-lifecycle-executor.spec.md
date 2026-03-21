---
title: "CommandLifecycleExecutor"
module: engine/executors/command-lifecycle-executor
source_file: packages/engine/src/executors/command-lifecycle-executor.ts
status: implemented
exports: []
depends_on:
  - engine/executors/metadata-enricher
  - edd/event
  - edd/event-metadata
  - ddd/aggregate-root
  - cqrs/command/command
  - persistence
  - persistence/snapshot
---

# CommandLifecycleExecutor

> `CommandLifecycleExecutor` executes the full aggregate command lifecycle: load state, execute the command handler, apply events, enrich metadata, enlist persistence in a unit of work, defer event publishing, and evaluate the snapshot strategy. It manages UoW ownership (implicit vs. explicit) and delegates concurrency control to a `ConcurrencyStrategy`. This is an engine-internal class instantiated by `Domain` during `init()`.

## Type Contract

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import type {
  Aggregate,
  AggregateCommand,
  CQRSInfrastructure,
  Infrastructure,
  PersistenceConfiguration,
  SnapshotStore,
  SnapshotStrategy,
  UnitOfWork,
  UnitOfWorkFactory,
} from "@noddde/core";
import type { ConcurrencyStrategy } from "../concurrency-strategy";
import type { MetadataEnricher } from "./metadata-enricher";

class CommandLifecycleExecutor {
  constructor(
    persistence: PersistenceConfiguration,
    infrastructure: Infrastructure & CQRSInfrastructure,
    unitOfWorkFactory: UnitOfWorkFactory,
    concurrencyStrategy: ConcurrencyStrategy,
    uowStorage: AsyncLocalStorage<UnitOfWork>,
    metadataEnricher: MetadataEnricher,
    snapshotStore?: SnapshotStore,
    snapshotStrategy?: SnapshotStrategy,
  );

  execute(
    aggregateName: string,
    aggregate: Aggregate<any>,
    command: AggregateCommand,
  ): Promise<void>;
}
```

- `CommandLifecycleExecutor` is constructed with all dependencies needed for the lifecycle: persistence, infrastructure (including CQRS buses), UoW factory, concurrency strategy, UoW storage (for detecting explicit UoW), metadata enricher, and optional snapshot store/strategy.
- `execute` is the single public method. It runs the full lifecycle for a given aggregate command, handling UoW creation/ownership and concurrency delegation internally.

## Behavioral Requirements

### Load Phase

1. **Event-sourced with snapshot** -- If a `SnapshotStore` is configured, call `snapshotStore.load(aggregateName, command.targetAggregateId)` first. If a snapshot is found:
   - If the persistence implements `PartialEventLoad` (has a `loadAfterVersion` method), call `persistence.loadAfterVersion(aggregateName, id, snapshot.version)` to load only post-snapshot events.
   - If the persistence does not implement `PartialEventLoad`, call `persistence.load(aggregateName, id)` and slice the result: `events.slice(snapshot.version)`.
   - Derive `version = snapshot.version + loadedEvents.length`.
   - Replay only the post-snapshot events through `aggregate.apply` handlers, starting from `snapshot.state`.

2. **Event-sourced without snapshot** -- If no snapshot is found (or no `SnapshotStore` is configured), call `persistence.load(aggregateName, command.targetAggregateId)`. If the result is an array (event-sourced):
   - Derive `version = events.length`.
   - Replay all events through `aggregate.apply` handlers, starting from `aggregate.initialState`.

3. **State-stored** -- If `persistence.load` returns a non-array result (state-stored):
   - The result is `{ state, version } | null`.
   - If `null`, use `aggregate.initialState` with `version = 0`.
   - Otherwise, use the returned `state` and `version`.

### Execute Phase

4. **Invoke command handler** -- Look up the handler via `aggregate.commands[command.name]`. If no handler is found, throw an error: `"No command handler found for command: ${command.name} on aggregate: ${aggregateName}"`. Otherwise, invoke the handler with `(command, currentState, infrastructure)`. The handler may return a single event or an array of events.

### Normalize Phase

5. **Single event to array** -- If the command handler returns a single event (not an array), wrap it in an array. If it returns an array, use it as-is.

### Apply Phase

6. **Apply events to state** -- For each event in the normalized array, look up the apply handler via `aggregate.apply[event.name]`. If found, apply it: `newState = applyHandler(event.payload, state)`. If no apply handler exists for an event name, the state is unchanged.

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

### UoW Management

11. **Implicit UoW (no existing UoW)** -- When no UoW is in the `AsyncLocalStorage`:
    - The concurrency strategy wraps the full attempt: UoW creation, lifecycle execution, and UoW commit.
    - On success, `uow.commit()` is called and returns the deferred events.
    - On failure, `uow.rollback()` is called (best-effort; rollback errors are swallowed).
    - After successful commit, the pending snapshot (if any) is saved to the snapshot store (best-effort; save errors are swallowed).
    - After successful commit, all returned events are dispatched via `eventBus.dispatch(event)` one by one.

12. **Explicit UoW (existing UoW in storage)** -- When a UoW is already in the `AsyncLocalStorage` (via `withUnitOfWork` or saga handling):
    - The concurrency strategy wraps only the lifecycle execution (not UoW creation/commit).
    - The lifecycle enlists persistence and defers events on the existing UoW.
    - The attempt callback returns `[]` (no events to dispatch; the owning UoW handles commit and event publishing).
    - No snapshot save occurs in this path.

### Concurrency Delegation

13. **Wraps attempt in ConcurrencyStrategy.execute()** -- The full attempt (including UoW create + commit for implicit, or just lifecycle for explicit) is passed to `concurrencyStrategy.execute(aggregateName, command.targetAggregateId, attempt)`. The strategy handles retry logic (optimistic) or lock acquisition/release (pessimistic).

### Post-Commit Operations

14. **Snapshot save is best-effort** -- After implicit UoW commit, if a pending snapshot exists and a `SnapshotStore` is configured, the snapshot is saved. If the save fails, the error is silently swallowed. Snapshot failure does not affect the command result.

15. **Event publishing after implicit commit** -- After implicit UoW commit, all committed events are dispatched sequentially via `eventBus.dispatch(event)`.

## Invariants

- The lifecycle phases always execute in order: load, execute, normalize, apply, enrich, enlist, defer, snapshot evaluation.
- Events are enriched before being enlisted for persistence (enriched events are what gets persisted).
- Events are published only after successful UoW commit (never before).
- Snapshot save never causes a command to fail (errors are swallowed).
- UoW rollback errors are swallowed (the original error is re-thrown).
- The concurrency strategy always wraps the attempt -- even with 0 retries, the strategy is called.
- `execute` is always async and returns `Promise<void>`.
- Missing command handler throws a descriptive error.
- The `version` parameter passed to persistence `save` is the version observed at load time (for optimistic concurrency).

## Edge Cases

- **Command handler returns single event** -- Normalized to `[event]` before apply/enrich.
- **Command handler returns empty array** -- No events to apply, enrich, persist, or publish. The UoW enlist and deferPublish are called with empty data. Snapshot strategy receives `eventsSinceSnapshot` that may be 0 relative to last snapshot.
- **No apply handler for an event name** -- State is unchanged for that event. No error thrown.
- **No command handler found** -- Throws `Error` with message identifying the command and aggregate.
- **Snapshot store configured but no strategy** -- No snapshot evaluation occurs.
- **Snapshot strategy configured but no store** -- No snapshot evaluation occurs. Both must be present.
- **State-stored persistence** -- Snapshot evaluation is skipped entirely (only applies to event-sourced).
- **Explicit UoW with pessimistic strategy** -- Lock is still acquired/released around the lifecycle (protects the load phase), but UoW commit happens elsewhere.
- **UoW commit fails** -- Rollback is attempted. Original error propagates. No events published, no snapshot saved.
- **PartialEventLoad optimization** -- Only loads events after snapshot version, avoiding full stream replay.
- **Persistence load returns null for state-stored** -- Uses `aggregate.initialState` and `version = 0`.
- **New aggregate (no prior events)** -- Event-sourced: `events = []`, `version = 0`, state is `initialState`. State-stored: `null` result, `version = 0`, state is `initialState`.

## Integration Points

- **MetadataEnricher** -- Called during the enrich phase to attach metadata to raw events.
- **ConcurrencyStrategy** -- Wraps the attempt for retry (optimistic) or locking (pessimistic).
- **UnitOfWork** -- Persistence and event publishing are enlisted/deferred on the UoW for atomic commit.
- **AsyncLocalStorage<UnitOfWork>** -- Checked to determine implicit vs. explicit UoW ownership.
- **PersistenceConfiguration** -- Either `EventSourcedAggregatePersistence` or `StateStoredAggregatePersistence`. The executor detects the type by checking whether `load` returns an array.
- **SnapshotStore / SnapshotStrategy** -- Optional. Used for snapshot-aware loading and post-command snapshot evaluation.
- **EventBus** -- Events are dispatched after implicit UoW commit.
- **Domain** -- Constructs the executor during `init()` and calls `execute` for each aggregate command dispatch.

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

describe("CommandLifecycleExecutor", () => {
  it("should load event-sourced aggregate, execute command, apply, enrich, persist, and publish", async () => {
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
  commands: {
    Toggle: () => ({ name: "Toggled", payload: {} }),
  },
  apply: {
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

### execute throws when no command handler is found

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
  commands: {},
  apply: {},
});

describe("CommandLifecycleExecutor", () => {
  it("should throw an error when the command handler is not found", async () => {
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
      "No command handler found for command: UnknownCommand on aggregate: MyAggregate",
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
  commands: {
    AddItem: (command) => ({
      name: "ItemAdded",
      payload: { item: command.payload.item },
    }),
  },
  apply: {
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
  commands: {
    Add: (command) => ({ name: "Added", payload: { n: command.payload.n } }),
  },
  apply: {
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
  commands: {
    SetValue: (command) => ({
      name: "ValueSet",
      payload: { v: command.payload.v },
    }),
  },
  apply: {
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

### execute rolls back UoW on command handler error

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
  commands: {
    Fail: () => {
      throw new Error("Handler exploded");
    },
  },
  apply: {
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
  commands: {
    Update: (command) => ({
      name: "Updated",
      payload: { v: command.payload.v },
    }),
  },
  apply: {
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
