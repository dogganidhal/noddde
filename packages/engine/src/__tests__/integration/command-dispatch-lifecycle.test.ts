/* eslint-disable no-unused-vars */
import { describe, expect, it, vi } from "vitest";
import type { DefineCommands, DefineEvents } from "@noddde/core";
import { defineAggregate } from "@noddde/core";
import {
  configureDomain,
  EventEmitterEventBus,
  InMemoryCommandBus,
  InMemoryEventSourcedAggregatePersistence,
  InMemoryQueryBus,
  InMemorySnapshotStore,
  InMemoryStateStoredAggregatePersistence,
} from "@noddde/engine";
import { everyNEvents } from "@noddde/core";

// ---- Shared counter aggregate ----

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

// ---- Test scenarios ----

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
    expect(events[0]).toEqual(
      expect.objectContaining({
        name: "Incremented",
        payload: { amount: 5 },
      }),
    );
    expect(events[0]?.metadata).toBeDefined();
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
    expect(events[0]!.payload.amount).toBe(3);
    expect(events[1]!.payload.amount).toBe(7);
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

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Incremented",
        payload: { amount: 1 },
      }),
    );
  });
});

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
    const loaded = await persistence.load("Counter", "counter-1");
    expect(loaded).toEqual({ state: { count: 10 }, version: 1 });
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

    const loaded = await persistence.load("Counter", "counter-1");
    expect(loaded).toEqual({ state: { count: 2 }, version: 2 });
  });
});

describe("Multiple events from one command", () => {
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
      Incremented: (payload, state) => ({
        count: state.count + payload.amount,
      }),
    },
  });

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
    expect(events[0]!.payload.amount).toBe(5);
    expect(events[1]!.payload.amount).toBe(5);

    expect(dispatchSpy).toHaveBeenCalledTimes(2);
  });
});

describe("Async command handler", () => {
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
          name: "AsyncDone" as const,
          payload: { result: command.payload.value.toUpperCase() },
        };
      },
    },
    apply: {
      AsyncDone: (payload, state) => ({ result: payload.result }),
    },
  });

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
    expect(events[0]!.payload.result).toBe("HELLO");
  });
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
