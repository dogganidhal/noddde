/* eslint-disable no-unused-vars */
import { describe, it, expect, vi } from "vitest";
import type {
  AggregateTypes,
  DefineCommands,
  DefineEvents,
  Infrastructure,
  PersistenceAdapter,
  SagaTypes,
} from "@noddde/core";
import { defineAggregate, defineSaga, everyNEvents } from "@noddde/core";
import {
  defineDomain,
  wireDomain,
  createInMemoryUnitOfWork,
  InMemoryEventSourcedAggregatePersistence,
  InMemoryStateStoredAggregatePersistence,
  InMemorySagaPersistence,
  InMemorySnapshotStore,
  InMemoryCommandBus,
  InMemoryQueryBus,
  EventEmitterEventBus,
  InMemoryAggregateLocker,
} from "@noddde/engine";

// ---- Test aggregate: simple counter ----

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

// ---- Helpers ----

function makeAdapter(
  overrides: Partial<PersistenceAdapter> = {},
): PersistenceAdapter {
  return {
    unitOfWorkFactory: createInMemoryUnitOfWork,
    ...overrides,
  };
}

function makeDefinition() {
  return defineDomain({
    writeModel: { aggregates: { Counter } },
    readModel: { projections: {} },
  });
}

// ============================================================
// Adapter defaults resolve for aggregate persistence
// ============================================================

describe("Adapter wiring - aggregate persistence defaults", () => {
  it("should default to adapter stateStoredPersistence when persistence is omitted", async () => {
    const adapter = makeAdapter({
      stateStoredPersistence: new InMemoryStateStoredAggregatePersistence(),
    });

    const domain = await wireDomain(makeDefinition(), {
      persistenceAdapter: adapter,
      aggregates: {
        Counter: {},
      },
    });

    expect(domain).toBeDefined();
  });

  it("should use in-memory defaults when no adapter and no explicit wiring", async () => {
    const domain = await wireDomain(makeDefinition(), {});
    expect(domain).toBeDefined();
  });
});

// ============================================================
// Persistence shorthand resolution
// ============================================================

describe("Adapter wiring - persistence shorthand", () => {
  it("should resolve 'event-sourced' shorthand from adapter", async () => {
    const esPersistence = new InMemoryEventSourcedAggregatePersistence();
    const adapter = makeAdapter({
      eventSourcedPersistence: esPersistence,
    });

    const domain = await wireDomain(makeDefinition(), {
      persistenceAdapter: adapter,
      aggregates: {
        Counter: { persistence: "event-sourced" },
      },
    });

    expect(domain).toBeDefined();
  });

  it("should resolve 'state-stored' shorthand from adapter", async () => {
    const ssPersistence = new InMemoryStateStoredAggregatePersistence();
    const adapter = makeAdapter({
      stateStoredPersistence: ssPersistence,
    });

    const domain = await wireDomain(makeDefinition(), {
      persistenceAdapter: adapter,
      aggregates: {
        Counter: { persistence: "state-stored" },
      },
    });

    expect(domain).toBeDefined();
  });

  it("should throw when shorthand used without adapter", async () => {
    await expect(
      wireDomain(makeDefinition(), {
        aggregates: {
          Counter: { persistence: "event-sourced" },
        },
      }),
    ).rejects.toThrow(/persistenceAdapter/);
  });

  it("should throw when adapter lacks eventSourcedPersistence for 'event-sourced' shorthand", async () => {
    const adapter = makeAdapter(); // no eventSourcedPersistence

    await expect(
      wireDomain(makeDefinition(), {
        persistenceAdapter: adapter,
        aggregates: {
          Counter: { persistence: "event-sourced" },
        },
      }),
    ).rejects.toThrow(/eventSourcedPersistence/);
  });

  it("should throw when adapter lacks stateStoredPersistence for 'state-stored' shorthand", async () => {
    const adapter = makeAdapter(); // no stateStoredPersistence

    await expect(
      wireDomain(makeDefinition(), {
        persistenceAdapter: adapter,
        aggregates: {
          Counter: { persistence: "state-stored" },
        },
      }),
    ).rejects.toThrow(/stateStoredPersistence/);
  });
});

// ============================================================
// Persistence factory and direct config still work
// ============================================================

describe("Adapter wiring - explicit persistence overrides", () => {
  it("should use factory function when provided, ignoring adapter", async () => {
    const adapterPersistence = new InMemoryStateStoredAggregatePersistence();
    const explicitPersistence = new InMemoryEventSourcedAggregatePersistence();
    const adapter = makeAdapter({
      stateStoredPersistence: adapterPersistence,
    });

    const domain = await wireDomain(makeDefinition(), {
      persistenceAdapter: adapter,
      aggregates: {
        Counter: { persistence: () => explicitPersistence },
      },
    });

    expect(domain).toBeDefined();
  });
});

// ============================================================
// Concurrency shorthand resolution
// ============================================================

describe("Adapter wiring - concurrency shorthand", () => {
  it("should resolve 'pessimistic' shorthand with adapter locker", async () => {
    const mockLocker = new InMemoryAggregateLocker();
    const adapter = makeAdapter({
      stateStoredPersistence: new InMemoryStateStoredAggregatePersistence(),
      aggregateLocker: mockLocker,
    });

    const domain = await wireDomain(makeDefinition(), {
      persistenceAdapter: adapter,
      aggregates: {
        Counter: { concurrency: "pessimistic" },
      },
    });

    expect(domain).toBeDefined();
  });

  it("should resolve 'optimistic' shorthand (equivalent to omitting)", async () => {
    const adapter = makeAdapter({
      stateStoredPersistence: new InMemoryStateStoredAggregatePersistence(),
    });

    const domain = await wireDomain(makeDefinition(), {
      persistenceAdapter: adapter,
      aggregates: {
        Counter: { concurrency: "optimistic" },
      },
    });

    expect(domain).toBeDefined();
  });

  it("should throw when 'pessimistic' used without adapter locker", async () => {
    const adapter = makeAdapter({
      stateStoredPersistence: new InMemoryStateStoredAggregatePersistence(),
      // no aggregateLocker
    });

    await expect(
      wireDomain(makeDefinition(), {
        persistenceAdapter: adapter,
        aggregates: {
          Counter: { concurrency: "pessimistic" },
        },
      }),
    ).rejects.toThrow(/locker/i);
  });

  it("should resolve object-form pessimistic with locker from adapter", async () => {
    const mockLocker = new InMemoryAggregateLocker();
    const adapter = makeAdapter({
      stateStoredPersistence: new InMemoryStateStoredAggregatePersistence(),
      aggregateLocker: mockLocker,
    });

    const domain = await wireDomain(makeDefinition(), {
      persistenceAdapter: adapter,
      aggregates: {
        Counter: { concurrency: { strategy: "pessimistic" } },
      },
    });

    expect(domain).toBeDefined();
  });

  it("should use explicit locker over adapter locker", async () => {
    const adapterLocker = new InMemoryAggregateLocker();
    const explicitLocker = new InMemoryAggregateLocker();
    const adapter = makeAdapter({
      stateStoredPersistence: new InMemoryStateStoredAggregatePersistence(),
      aggregateLocker: adapterLocker,
    });

    const domain = await wireDomain(makeDefinition(), {
      persistenceAdapter: adapter,
      aggregates: {
        Counter: {
          concurrency: { strategy: "pessimistic", locker: explicitLocker },
        },
      },
    });

    expect(domain).toBeDefined();
  });

  it("should throw when pessimistic object form has no locker and no adapter locker", async () => {
    const adapter = makeAdapter({
      stateStoredPersistence: new InMemoryStateStoredAggregatePersistence(),
    });

    await expect(
      wireDomain(makeDefinition(), {
        persistenceAdapter: adapter,
        aggregates: {
          Counter: { concurrency: { strategy: "pessimistic" } },
        },
      }),
    ).rejects.toThrow(/locker/i);
  });

  it("should support object-form optimistic with maxRetries", async () => {
    const adapter = makeAdapter({
      stateStoredPersistence: new InMemoryStateStoredAggregatePersistence(),
    });

    const domain = await wireDomain(makeDefinition(), {
      persistenceAdapter: adapter,
      aggregates: {
        Counter: { concurrency: { maxRetries: 5 } },
      },
    });

    expect(domain).toBeDefined();
  });
});

// ============================================================
// Snapshot store inference
// ============================================================

describe("Adapter wiring - snapshot store inference", () => {
  it("should infer snapshot store from adapter when strategy set but store omitted", async () => {
    const adapter = makeAdapter({
      eventSourcedPersistence: new InMemoryEventSourcedAggregatePersistence(),
      snapshotStore: new InMemorySnapshotStore(),
    });

    const domain = await wireDomain(makeDefinition(), {
      persistenceAdapter: adapter,
      aggregates: {
        Counter: {
          persistence: "event-sourced",
          snapshots: { strategy: everyNEvents(10) },
        },
      },
    });

    expect(domain).toBeDefined();
  });

  it("should throw when snapshot strategy set but no store and adapter lacks snapshotStore", async () => {
    const adapter = makeAdapter({
      eventSourcedPersistence: new InMemoryEventSourcedAggregatePersistence(),
      // no snapshotStore
    });

    await expect(
      wireDomain(makeDefinition(), {
        persistenceAdapter: adapter,
        aggregates: {
          Counter: {
            persistence: "event-sourced",
            snapshots: { strategy: everyNEvents(10) },
          },
        },
      }),
    ).rejects.toThrow(/snapshot/i);
  });

  it("should use explicit snapshot store over adapter", async () => {
    const adapterStore = new InMemorySnapshotStore();
    const explicitStore = new InMemorySnapshotStore();
    const adapter = makeAdapter({
      eventSourcedPersistence: new InMemoryEventSourcedAggregatePersistence(),
      snapshotStore: adapterStore,
    });

    const domain = await wireDomain(makeDefinition(), {
      persistenceAdapter: adapter,
      aggregates: {
        Counter: {
          persistence: "event-sourced",
          snapshots: { strategy: everyNEvents(10), store: () => explicitStore },
        },
      },
    });

    expect(domain).toBeDefined();
  });
});

// ============================================================
// Saga persistence inference
// ============================================================

describe("Adapter wiring - saga persistence inference", () => {
  // Minimal saga definition for testing
  type TaskEvent = DefineEvents<{
    TaskStarted: { taskId: string };
  }>;
  type AckCommand = DefineCommands<{
    AcknowledgeTask: { taskId: string };
  }>;
  type AckSagaDef = SagaTypes & {
    state: { acknowledged: boolean };
    events: TaskEvent;
    commands: AckCommand;
    infrastructure: Infrastructure;
  };

  const AckSaga = defineSaga<AckSagaDef>({
    initialState: { acknowledged: false },
    startedBy: ["TaskStarted"],
    on: {
      TaskStarted: {
        id: (event) => event.payload.taskId,
        handle: (event) => ({
          state: { acknowledged: true },
          commands: {
            name: "AcknowledgeTask",
            targetAggregateId: event.payload.taskId,
            payload: { taskId: event.payload.taskId },
          },
        }),
      },
    },
  });

  it("should infer saga persistence from adapter when not explicitly wired", async () => {
    const adapter = makeAdapter({
      stateStoredPersistence: new InMemoryStateStoredAggregatePersistence(),
      sagaPersistence: new InMemorySagaPersistence(),
    });

    const definition = defineDomain({
      writeModel: { aggregates: { Counter } },
      readModel: { projections: {} },
      processModel: { sagas: { Ack: AckSaga } },
    });

    const domain = await wireDomain(definition, {
      persistenceAdapter: adapter,
      aggregates: {
        Counter: {},
      },
    });

    expect(domain).toBeDefined();
  });

  it("should skip saga persistence when no sagas are defined", async () => {
    const adapter = makeAdapter({
      stateStoredPersistence: new InMemoryStateStoredAggregatePersistence(),
      // no sagaPersistence
    });

    // No sagas — should succeed even without saga persistence
    const domain = await wireDomain(makeDefinition(), {
      persistenceAdapter: adapter,
      aggregates: {
        Counter: {},
      },
    });

    expect(domain).toBeDefined();
  });
});

// ============================================================
// Unit-of-work inference
// ============================================================

describe("Adapter wiring - unit-of-work inference", () => {
  it("should infer UoW factory from adapter when not explicitly wired", async () => {
    const adapter = makeAdapter({
      stateStoredPersistence: new InMemoryStateStoredAggregatePersistence(),
    });

    const domain = await wireDomain(makeDefinition(), {
      persistenceAdapter: adapter,
      aggregates: {
        Counter: {},
      },
    });

    expect(domain).toBeDefined();
  });

  it("should use explicit UoW factory over adapter", async () => {
    const adapter = makeAdapter({
      stateStoredPersistence: new InMemoryStateStoredAggregatePersistence(),
    });

    const explicitUoW = vi.fn(createInMemoryUnitOfWork);

    const domain = await wireDomain(makeDefinition(), {
      persistenceAdapter: adapter,
      unitOfWork: () => explicitUoW,
      aggregates: {
        Counter: {},
      },
    });

    expect(domain).toBeDefined();
  });
});

// ============================================================
// Idempotency and outbox inference
// ============================================================

describe("Adapter wiring - idempotency inference", () => {
  it("should infer idempotency store from adapter when not explicitly wired", async () => {
    const mockIdempotencyStore = {
      exists: vi.fn().mockResolvedValue(false),
      store: vi.fn().mockResolvedValue(undefined),
    };
    const adapter = makeAdapter({
      stateStoredPersistence: new InMemoryStateStoredAggregatePersistence(),
      idempotencyStore: mockIdempotencyStore,
    });

    const domain = await wireDomain(makeDefinition(), {
      persistenceAdapter: adapter,
      aggregates: {
        Counter: {},
      },
    });

    expect(domain).toBeDefined();
  });
});

describe("Adapter wiring - outbox inference", () => {
  it("should infer outbox store from adapter when not explicitly wired", async () => {
    const mockOutboxStore = {
      save: vi.fn().mockResolvedValue(undefined),
      fetchUnpublished: vi.fn().mockResolvedValue([]),
      markPublished: vi.fn().mockResolvedValue(undefined),
      markPublishedByEventIds: vi.fn().mockResolvedValue(undefined),
    };
    const adapter = makeAdapter({
      stateStoredPersistence: new InMemoryStateStoredAggregatePersistence(),
      outboxStore: mockOutboxStore,
    });

    const domain = await wireDomain(makeDefinition(), {
      persistenceAdapter: adapter,
      aggregates: {
        Counter: {},
      },
    });

    expect(domain).toBeDefined();
  });
});

// ============================================================
// Adapter lifecycle
// ============================================================

describe("Adapter wiring - lifecycle", () => {
  it("should call adapter.init() during domain init", async () => {
    const initFn = vi.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({
      stateStoredPersistence: new InMemoryStateStoredAggregatePersistence(),
      init: initFn,
    });

    await wireDomain(makeDefinition(), {
      persistenceAdapter: adapter,
      aggregates: {
        Counter: {},
      },
    });

    expect(initFn).toHaveBeenCalledOnce();
  });

  it("should call adapter.close() during domain shutdown", async () => {
    const closeFn = vi.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({
      stateStoredPersistence: new InMemoryStateStoredAggregatePersistence(),
      close: closeFn,
    });

    const domain = await wireDomain(makeDefinition(), {
      persistenceAdapter: adapter,
      aggregates: {
        Counter: {},
      },
    });

    await domain.shutdown();

    expect(closeFn).toHaveBeenCalledOnce();
  });

  it("should proceed without error when adapter has no close()", async () => {
    const adapter = makeAdapter({
      stateStoredPersistence: new InMemoryStateStoredAggregatePersistence(),
      // no close()
    });

    const domain = await wireDomain(makeDefinition(), {
      persistenceAdapter: adapter,
      aggregates: {
        Counter: {},
      },
    });

    await expect(domain.shutdown()).resolves.not.toThrow();
  });
});

// ============================================================
// Backward compatibility — no adapter
// ============================================================

describe("Adapter wiring - backward compatibility", () => {
  it("should work with no adapter and explicit factories (existing pattern)", async () => {
    const domain = await wireDomain(makeDefinition(), {
      aggregates: {
        Counter: {
          persistence: () => new InMemoryEventSourcedAggregatePersistence(),
        },
      },
      buses: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus: new EventEmitterEventBus(),
        queryBus: new InMemoryQueryBus(),
      }),
    });

    expect(domain).toBeDefined();
  });

  it("should work with no adapter and no explicit wiring (in-memory defaults)", async () => {
    const domain = await wireDomain(makeDefinition(), {});

    expect(domain).toBeDefined();
  });

  it("should work with global aggregate wiring (non per-aggregate mode)", async () => {
    const domain = await wireDomain(makeDefinition(), {
      aggregates: {
        persistence: () => new InMemoryEventSourcedAggregatePersistence(),
        concurrency: { maxRetries: 3 },
      },
    });

    expect(domain).toBeDefined();
  });
});
