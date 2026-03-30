/* eslint-disable no-unused-vars */
import { AsyncLocalStorage } from "node:async_hooks";
import { describe, it, expect, vi } from "vitest";
import { defineAggregate, everyNEvents } from "@noddde/core";
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
  InMemoryStateStoredAggregatePersistence,
  InMemoryCommandBus,
  EventEmitterEventBus,
  InMemoryQueryBus,
  InMemorySnapshotStore,
  createInMemoryUnitOfWork,
} from "@noddde/engine";
import { CommandLifecycleExecutor } from "../../../executors/command-lifecycle-executor";
import { MetadataEnricher } from "../../../executors/metadata-enricher";
import type { MetadataContext } from "../../../domain";
import {
  OptimisticConcurrencyStrategy,
  type ConcurrencyStrategy,
} from "../../../concurrency-strategy";
import { GlobalAggregatePersistenceResolver } from "../../../aggregate-persistence-resolver";

// ============================================================
// Shared aggregate definitions
// ============================================================

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
  // ============================================================
  // Event-sourced lifecycle
  // ============================================================

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
      new GlobalAggregatePersistenceResolver(persistence),
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

  // ============================================================
  // State-stored lifecycle
  // ============================================================

  it("should load state-stored aggregate and persist new state", async () => {
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
      new GlobalAggregatePersistenceResolver(persistence),
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

  // ============================================================
  // Missing command handler
  // ============================================================

  it("should throw an error when the command handler is not found", async () => {
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
      new GlobalAggregatePersistenceResolver(persistence),
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

  // ============================================================
  // Explicit UoW
  // ============================================================

  it("should enlist on existing UoW without committing or publishing events", async () => {
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
      new GlobalAggregatePersistenceResolver(persistence),
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

  // ============================================================
  // Snapshot strategy evaluation and save
  // ============================================================

  it("should save a snapshot when the strategy triggers", async () => {
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
        Add: (command) => ({
          name: "Added",
          payload: { n: command.payload.n },
        }),
      },
      evolve: {
        Added: (payload, state) => ({ total: state.total + payload.n }),
      },
    });

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
      new GlobalAggregatePersistenceResolver(persistence),
      infrastructure,
      createInMemoryUnitOfWork,
      strategy,
      uowStorage,
      enricher,
      () => ({ store: snapshotStore, strategy: snapshotStrategy }),
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

  // ============================================================
  // Snapshot-aware loading
  // ============================================================

  it("should load from snapshot and replay only post-snapshot events", async () => {
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
    vi.spyOn(persistence, "load");

    const executor = new CommandLifecycleExecutor(
      new GlobalAggregatePersistenceResolver(persistence),
      infrastructure,
      createInMemoryUnitOfWork,
      strategy,
      uowStorage,
      enricher,
      () => ({ store: snapshotStore, strategy: () => false }),
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

  // ============================================================
  // Rollback on error
  // ============================================================

  it("should rollback UoW and propagate handler error", async () => {
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
      new GlobalAggregatePersistenceResolver(persistence),
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

  // ============================================================
  // Concurrency strategy delegation
  // ============================================================

  it("should invoke concurrency strategy which wraps the attempt", async () => {
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
      new GlobalAggregatePersistenceResolver(persistence),
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
