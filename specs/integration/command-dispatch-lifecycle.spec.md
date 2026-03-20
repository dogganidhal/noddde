---
title: "Command Dispatch Lifecycle"
module: integration/command-dispatch-lifecycle
source_file:
  - packages/core/src/engine/domain.ts
  - packages/core/src/ddd/aggregate-root.ts
  - packages/core/src/engine/implementations/in-memory-aggregate-persistence.ts
  - packages/core/src/engine/implementations/ee-event-bus.ts
  - packages/core/src/engine/implementations/in-memory-command-bus.ts
status: implemented
exports: []
depends_on:
  - core/ddd/aggregate-root
  - core/engine/domain
  - core/engine/implementations/in-memory-aggregate-persistence
  - core/edd/event-bus
docs:
  - commands/dispatching.mdx
---

# Command Dispatch Lifecycle

> Validates the full command dispatch lifecycle end-to-end: `domain.dispatchCommand(cmd)` routes to the correct aggregate by name, loads state from persistence, executes the command handler, collects returned events, applies events to derive new state, persists the result (events or state depending on persistence strategy), publishes events via the EventBus, and returns the `targetAggregateId`. This spec exercises both event-sourced and state-stored persistence strategies using real in-memory implementations.

## Involved Components

- **`Domain.dispatchCommand`** -- entry point; orchestrates the full lifecycle.
- **`Aggregate`** -- provides `initialState`, `commands` (decide), and `apply` (evolve).
- **`EventSourcedAggregatePersistence` / `StateStoredAggregatePersistence`** -- load prior state/events, persist after command.
- **`EventBus`** -- publishes events produced by the command handler.
- **`configureDomain`** -- factory that wires everything together and calls `init()`.

## Behavioral Requirements

1. **Routing**: The framework must match the command `name` to the correct aggregate's command handler map. If no aggregate declares a handler for a given command name, the dispatch must fail.
2. **State loading (event-sourced)**: Before executing the handler, the framework must call `persistence.load(aggregateName, aggregateId)` to retrieve the event stream, then replay those events through the aggregate's `apply` handlers starting from `initialState` to reconstruct current state.
3. **State loading (state-stored)**: Before executing the handler, the framework must call `persistence.load(aggregateName, aggregateId)`. If `undefined`/`null` is returned, `initialState` is used.
4. **Command execution**: The resolved command handler is invoked with `(command, currentState, infrastructure)`. It may return a single event, an array of events, or a Promise resolving to either.
5. **Apply phase**: Each returned event is applied sequentially through the corresponding `apply` handler. The apply handler receives `(event.payload, state)` and returns the new state. This is pure and synchronous.
6. **Persistence (event-sourced)**: After applying, the new events (not all historical events) are appended via `persistence.save(aggregateName, aggregateId, newEvents)`.
7. **Persistence (state-stored)**: After applying, the final state is saved via `persistence.save(aggregateName, aggregateId, newState)`.
8. **Event publishing**: Each event produced by the command handler must be published on the EventBus via `eventBus.dispatch(event)`.
9. **Return value**: `dispatchCommand` resolves with the `targetAggregateId` from the command.

## Invariants

- The aggregate's `initialState` is never mutated.
- Events are applied in the order they are returned by the command handler.
- Events are persisted before (or atomically with) being published, to avoid publishing events that were not durably stored.
- The apply handler for each event name must exist in the aggregate's `apply` map.
- Command handlers receive the fully reconstructed state, not stale or partial state.
- After dispatching N commands that each produce 1 event, loading the aggregate must reconstruct a state equivalent to applying all N events from `initialState`.

## Edge Cases

- **First command (no prior state)**: When no events/state exist in persistence, the command handler receives `initialState`. After the command, events/state are persisted normally.
- **Command handler returns a single event (not wrapped in array)**: The framework must normalize to an array.
- **Command handler returns multiple events**: All events are applied in order, all are persisted, and all are published.
- **Async command handler**: The command handler returns a `Promise<Event[]>`. The framework must await it.
- **Command handler returns an empty array**: No events are applied, persisted, or published. The aggregate state is unchanged. `dispatchCommand` still returns the aggregateId.
- **Multiple aggregates**: Two aggregates with different command names coexist; dispatching a command routes to the correct one.
- **Snapshot-aware dispatch**: When a snapshot store is configured, the engine loads the snapshot, replays only post-snapshot events, and produces the correct state. After enough events, a snapshot is saved per the strategy.
- **Snapshot fallback**: When the persistence does not implement `PartialEventLoad`, the engine falls back to `load()` + `slice()` and still produces correct state.
- **No snapshot configured**: Behavior is identical to the non-snapshot path (no regression).

## Integration Points

- Projections subscribe to the EventBus and will receive the events published during dispatch (tested in `event-projection-flow`).
- Sagas subscribe to the EventBus and will receive the events published during dispatch (tested in `saga-orchestration`).
- The infrastructure passed to command handlers includes both custom infrastructure and CQRS buses.

## Test Scenarios

### Full lifecycle with event-sourced persistence and a counter aggregate

```ts
import { describe, it, expect, vi } from "vitest";
import {
  defineAggregate,
  configureDomain,
  InMemoryEventSourcedAggregatePersistence,
  InMemoryCommandBus,
  InMemoryQueryBus,
  EventEmitterEventBus,
} from "@noddde/core";
import type {
  DefineCommands,
  DefineEvents,
  AggregateTypes,
} from "@noddde/core";

type CounterState = { count: number };

type CounterEvent = DefineEvents<{
  Incremented: { amount: number };
  Decremented: { amount: number };
}>;

type CounterCommand = DefineCommands<{
  Increment: { amount: number };
  Decrement: { amount: number };
}>;

type CounterTypes = {
  state: CounterState;
  events: CounterEvent;
  commands: CounterCommand;
  infrastructure: {};
};

const Counter = defineAggregate<CounterTypes>({
  initialState: { count: 0 },
  commands: {
    Increment: (command, state) => ({
      name: "Incremented",
      payload: { amount: command.payload.amount },
    }),
    Decrement: (command, state) => ({
      name: "Decremented",
      payload: { amount: command.payload.amount },
    }),
  },
  apply: {
    Incremented: (payload, state) => ({ count: state.count + payload.amount }),
    Decremented: (payload, state) => ({ count: state.count - payload.amount }),
  },
});

describe("Command dispatch lifecycle (event-sourced)", () => {
  it("should dispatch a command, persist events, and return aggregateId", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();
    const eventBus = new EventEmitterEventBus();

    const domain = await configureDomain({
      writeModel: { aggregates: { Counter } },
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

    const aggregateId = await domain.dispatchCommand({
      name: "Increment",
      targetAggregateId: "counter-1",
      payload: { amount: 5 },
    });

    expect(aggregateId).toBe("counter-1");

    // Verify events were persisted
    const events = await persistence.load("Counter", "counter-1");
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      name: "Incremented",
      payload: { amount: 5 },
    });
  });

  it("should reconstruct state from prior events on subsequent commands", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();
    const eventBus = new EventEmitterEventBus();

    const domain = await configureDomain({
      writeModel: { aggregates: { Counter } },
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

    await domain.dispatchCommand({
      name: "Increment",
      targetAggregateId: "counter-1",
      payload: { amount: 3 },
    });

    await domain.dispatchCommand({
      name: "Increment",
      targetAggregateId: "counter-1",
      payload: { amount: 7 },
    });

    // Verify all events were appended
    const events = await persistence.load("Counter", "counter-1");
    expect(events).toHaveLength(2);
    expect(events[0].payload.amount).toBe(3);
    expect(events[1].payload.amount).toBe(7);
  });

  it("should publish events on the EventBus after dispatch", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();
    const eventBus = new EventEmitterEventBus();
    const dispatchSpy = vi.spyOn(eventBus, "dispatch");

    const domain = await configureDomain({
      writeModel: { aggregates: { Counter } },
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

    await domain.dispatchCommand({
      name: "Increment",
      targetAggregateId: "counter-1",
      payload: { amount: 1 },
    });

    expect(dispatchSpy).toHaveBeenCalledWith({
      name: "Incremented",
      payload: { amount: 1 },
    });
  });
});
```

### First command uses initialState

```ts
import { describe, it, expect } from "vitest";
import {
  defineAggregate,
  configureDomain,
  InMemoryStateStoredAggregatePersistence,
  InMemoryCommandBus,
  InMemoryQueryBus,
  EventEmitterEventBus,
} from "@noddde/core";
import type { DefineCommands, DefineEvents } from "@noddde/core";

// Reuse CounterTypes from above scenario

describe("First command with state-stored persistence", () => {
  it("should use initialState when no prior state exists", async () => {
    const persistence = new InMemoryStateStoredAggregatePersistence();

    const domain = await configureDomain({
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
      targetAggregateId: "counter-1",
      payload: { amount: 10 },
    });

    // State-stored persistence saves the final state, not events
    const state = await persistence.load("Counter", "counter-1");
    expect(state).toEqual({ count: 10 });
  });

  it("should accumulate state across multiple commands", async () => {
    const persistence = new InMemoryStateStoredAggregatePersistence();

    const domain = await configureDomain({
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
      targetAggregateId: "counter-1",
      payload: { amount: 3 },
    });

    await domain.dispatchCommand({
      name: "Decrement",
      targetAggregateId: "counter-1",
      payload: { amount: 1 },
    });

    const state = await persistence.load("Counter", "counter-1");
    expect(state).toEqual({ count: 2 });
  });
});
```

### Command handler returning multiple events

```ts
import { describe, it, expect, vi } from "vitest";
import {
  defineAggregate,
  configureDomain,
  InMemoryEventSourcedAggregatePersistence,
  InMemoryCommandBus,
  InMemoryQueryBus,
  EventEmitterEventBus,
} from "@noddde/core";
import type { DefineCommands, DefineEvents } from "@noddde/core";

type BatchCounterCommand = DefineCommands<{
  IncrementTwice: { amount: number };
}>;

type BatchCounterEvent = DefineEvents<{
  Incremented: { amount: number };
}>;

type BatchCounterTypes = {
  state: { count: number };
  events: BatchCounterEvent;
  commands: BatchCounterCommand;
  infrastructure: {};
};

const BatchCounter = defineAggregate<BatchCounterTypes>({
  initialState: { count: 0 },
  commands: {
    IncrementTwice: (command, state) => [
      { name: "Incremented", payload: { amount: command.payload.amount } },
      { name: "Incremented", payload: { amount: command.payload.amount } },
    ],
  },
  apply: {
    Incremented: (payload, state) => ({ count: state.count + payload.amount }),
  },
});

describe("Multiple events from one command", () => {
  it("should apply, persist, and publish all events in order", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();
    const eventBus = new EventEmitterEventBus();
    const dispatchSpy = vi.spyOn(eventBus, "dispatch");

    const domain = await configureDomain({
      writeModel: { aggregates: { BatchCounter } },
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

    await domain.dispatchCommand({
      name: "IncrementTwice",
      targetAggregateId: "batch-1",
      payload: { amount: 5 },
    });

    const events = await persistence.load("BatchCounter", "batch-1");
    expect(events).toHaveLength(2);
    expect(events[0].payload.amount).toBe(5);
    expect(events[1].payload.amount).toBe(5);

    expect(dispatchSpy).toHaveBeenCalledTimes(2);
  });
});
```

### Async command handler

```ts
import { describe, it, expect } from "vitest";
import {
  defineAggregate,
  configureDomain,
  InMemoryEventSourcedAggregatePersistence,
  InMemoryCommandBus,
  InMemoryQueryBus,
  EventEmitterEventBus,
} from "@noddde/core";
import type { DefineCommands, DefineEvents } from "@noddde/core";

type AsyncCommand = DefineCommands<{
  DoAsync: { value: string };
}>;

type AsyncEvent = DefineEvents<{
  AsyncDone: { result: string };
}>;

type AsyncTypes = {
  state: { result: string | null };
  events: AsyncEvent;
  commands: AsyncCommand;
  infrastructure: {};
};

const AsyncAggregate = defineAggregate<AsyncTypes>({
  initialState: { result: null },
  commands: {
    DoAsync: async (command, state) => {
      // Simulate async work
      await new Promise((resolve) => setTimeout(resolve, 1));
      return {
        name: "AsyncDone",
        payload: { result: command.payload.value.toUpperCase() },
      };
    },
  },
  apply: {
    AsyncDone: (payload, state) => ({ result: payload.result }),
  },
});

describe("Async command handler", () => {
  it("should await the command handler and process the result", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();

    const domain = await configureDomain({
      writeModel: { aggregates: { AsyncAggregate } },
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

    const id = await domain.dispatchCommand({
      name: "DoAsync",
      targetAggregateId: "async-1",
      payload: { value: "hello" },
    });

    expect(id).toBe("async-1");

    const events = await persistence.load("AsyncAggregate", "async-1");
    expect(events).toHaveLength(1);
    expect(events[0].payload.result).toBe("HELLO");
  });
});
```

### Snapshot-aware dispatch: snapshot triggers and subsequent command uses snapshot

```ts
import { describe, it, expect, vi } from "vitest";
import {
  defineAggregate,
  configureDomain,
  InMemoryEventSourcedAggregatePersistence,
  InMemorySnapshotStore,
  InMemoryCommandBus,
  InMemoryQueryBus,
  EventEmitterEventBus,
  everyNEvents,
} from "@noddde/core";
import type { DefineCommands, DefineEvents } from "@noddde/core";

type CounterState = { count: number };

type CounterEvent = DefineEvents<{
  Incremented: { amount: number };
}>;

type CounterCommand = DefineCommands<{
  Increment: { amount: number };
}>;

type CounterTypes = {
  state: CounterState;
  events: CounterEvent;
  commands: CounterCommand;
  infrastructure: {};
};

const Counter = defineAggregate<CounterTypes>({
  initialState: { count: 0 },
  commands: {
    Increment: (command, state) => ({
      name: "Incremented",
      payload: { amount: command.payload.amount },
    }),
  },
  apply: {
    Incremented: (payload, state) => ({ count: state.count + payload.amount }),
  },
});

describe("Snapshot-aware command dispatch", () => {
  it("should save a snapshot when the strategy triggers and use it for subsequent loads", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();
    const snapshotStore = new InMemorySnapshotStore();
    const eventBus = new EventEmitterEventBus();

    const domain = await configureDomain({
      writeModel: { aggregates: { Counter } },
      readModel: { projections: {} },
      infrastructure: {
        aggregatePersistence: () => persistence,
        snapshotStore: () => snapshotStore,
        snapshotStrategy: everyNEvents(3),
        cqrsInfrastructure: () => ({
          commandBus: new InMemoryCommandBus(),
          eventBus,
          queryBus: new InMemoryQueryBus(),
        }),
      },
    });

    // Dispatch 3 commands — snapshot should trigger after the 3rd
    await domain.dispatchCommand({
      name: "Increment",
      targetAggregateId: "counter-1",
      payload: { amount: 1 },
    });
    await domain.dispatchCommand({
      name: "Increment",
      targetAggregateId: "counter-1",
      payload: { amount: 2 },
    });
    await domain.dispatchCommand({
      name: "Increment",
      targetAggregateId: "counter-1",
      payload: { amount: 3 },
    });

    // Verify snapshot was saved at version 3 with state { count: 6 }
    const snapshot = await snapshotStore.load("Counter", "counter-1");
    expect(snapshot).not.toBeNull();
    expect(snapshot!.version).toBe(3);
    expect(snapshot!.state).toEqual({ count: 6 });

    // Spy on loadAfterVersion to verify it's used for subsequent commands
    const loadAfterVersionSpy = vi.spyOn(persistence, "loadAfterVersion");

    // Dispatch a 4th command — should use the snapshot
    await domain.dispatchCommand({
      name: "Increment",
      targetAggregateId: "counter-1",
      payload: { amount: 4 },
    });

    // Verify loadAfterVersion was called with snapshot version
    expect(loadAfterVersionSpy).toHaveBeenCalledWith("Counter", "counter-1", 3);

    // Verify the event stream has all 4 events
    const events = await persistence.load("Counter", "counter-1");
    expect(events).toHaveLength(4);
  });

  it("should produce correct state across snapshot boundaries", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();
    const snapshotStore = new InMemorySnapshotStore();

    const domain = await configureDomain({
      writeModel: { aggregates: { Counter } },
      readModel: { projections: {} },
      infrastructure: {
        aggregatePersistence: () => persistence,
        snapshotStore: () => snapshotStore,
        snapshotStrategy: everyNEvents(2),
        cqrsInfrastructure: () => ({
          commandBus: new InMemoryCommandBus(),
          eventBus: new EventEmitterEventBus(),
          queryBus: new InMemoryQueryBus(),
        }),
      },
    });

    // Dispatch 5 commands: snapshots at version 2 and 4
    for (let i = 1; i <= 5; i++) {
      await domain.dispatchCommand({
        name: "Increment",
        targetAggregateId: "counter-1",
        payload: { amount: i },
      });
    }

    // Verify final event stream (1+2+3+4+5 = 15 total)
    const events = await persistence.load("Counter", "counter-1");
    expect(events).toHaveLength(5);

    // Verify the latest snapshot exists
    const snapshot = await snapshotStore.load("Counter", "counter-1");
    expect(snapshot).not.toBeNull();
    // Snapshot should be at version 4 (last threshold crossing)
    // with state { count: 1+2+3+4 = 10 }
    expect(snapshot!.version).toBe(4);
    expect(snapshot!.state).toEqual({ count: 10 });
  });
});
```

### Snapshot-aware dispatch: no snapshot configured (no regression)

```ts
import { describe, it, expect } from "vitest";
import {
  defineAggregate,
  configureDomain,
  InMemoryEventSourcedAggregatePersistence,
  InMemoryCommandBus,
  InMemoryQueryBus,
  EventEmitterEventBus,
} from "@noddde/core";
import type { DefineCommands, DefineEvents } from "@noddde/core";

// Reuse Counter from above

describe("Command dispatch without snapshot (regression check)", () => {
  it("should work identically without snapshot store configured", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();

    const domain = await configureDomain({
      writeModel: { aggregates: { Counter } },
      readModel: { projections: {} },
      infrastructure: {
        aggregatePersistence: () => persistence,
        // No snapshotStore, no snapshotStrategy
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
      payload: { amount: 5 },
    });
    await domain.dispatchCommand({
      name: "Increment",
      targetAggregateId: "counter-1",
      payload: { amount: 3 },
    });

    const events = await persistence.load("Counter", "counter-1");
    expect(events).toHaveLength(2);
  });
});
```
