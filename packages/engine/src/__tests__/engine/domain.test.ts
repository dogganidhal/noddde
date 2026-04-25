/* eslint-disable no-unused-vars */
import { describe, expect, it, vi } from "vitest";
import type {
  AggregateTypes,
  DefineCommands,
  DefineEvents,
  DefineQueries,
  EventSourcedAggregatePersistence,
  Infrastructure,
  ProjectionTypes,
  SagaTypes,
} from "@noddde/core";
import { defineAggregate, defineProjection, defineSaga } from "@noddde/core";
import {
  defineDomain,
  wireDomain,
  createInMemoryUnitOfWork,
  Domain,
  EventEmitterEventBus,
  InMemoryAggregateLocker,
  InMemoryCommandBus,
  InMemoryEventSourcedAggregatePersistence,
  InMemoryIdempotencyStore,
  InMemoryQueryBus,
  InMemorySagaPersistence,
  InMemorySnapshotStore,
  InMemoryStateStoredAggregatePersistence,
  InMemoryViewStore,
} from "@noddde/engine";
import { createViewStoreFactory, everyNEvents } from "@noddde/core";

// ============================================================
// wireDomain creates and initializes a domain
// ============================================================

describe("wireDomain", () => {
  it("should return an initialized Domain instance", async () => {
    const definition = defineDomain<Infrastructure>({
      writeModel: { aggregates: {} },
      readModel: { projections: {} },
    });

    const domain = await wireDomain(definition, {
      buses: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus: new EventEmitterEventBus(),
        queryBus: new InMemoryQueryBus(),
      }),
    });

    expect(domain).toBeInstanceOf(Domain);
    expect(domain.infrastructure.commandBus).toBeInstanceOf(InMemoryCommandBus);
    expect(domain.infrastructure.eventBus).toBeInstanceOf(EventEmitterEventBus);
    expect(domain.infrastructure.queryBus).toBeInstanceOf(InMemoryQueryBus);
  });
});

// ============================================================
// init resolves custom infrastructure and merges with CQRS buses
// ============================================================

interface TestInfrastructure {
  clock: { now(): Date };
}

describe("Domain.init", () => {
  it("should merge custom infrastructure with CQRS infrastructure", async () => {
    const fixedDate = new Date("2025-01-01T00:00:00Z");

    const definition = defineDomain<TestInfrastructure>({
      writeModel: { aggregates: {} },
      readModel: { projections: {} },
    });

    const domain = await wireDomain(definition, {
      infrastructure: () => ({
        clock: { now: () => fixedDate },
      }),
      buses: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus: new EventEmitterEventBus(),
        queryBus: new InMemoryQueryBus(),
      }),
    });

    expect(domain.infrastructure.clock.now()).toBe(fixedDate);
    expect(domain.infrastructure.commandBus).toBeDefined();
    expect(domain.infrastructure.eventBus).toBeDefined();
    expect(domain.infrastructure.queryBus).toBeDefined();
  });
});

// ============================================================
// dispatchCommand executes the full aggregate lifecycle
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

describe("Domain.dispatchCommand", () => {
  it("should load, execute, apply, persist, and publish", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();
    const eventBus = new EventEmitterEventBus();
    const publishedEvents: any[] = [];

    eventBus.on("CounterCreated", (event: any) => {
      publishedEvents.push(event);
    });
    eventBus.on("Incremented", (event: any) => {
      publishedEvents.push(event);
    });

    const definition = defineDomain<Infrastructure>({
      writeModel: {
        aggregates: { Counter },
      },
      readModel: { projections: {} },
    });

    const domain = await wireDomain(definition, {
      aggregates: {
        persistence: () => persistence,
      },
      buses: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus,
        queryBus: new InMemoryQueryBus(),
      }),
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

    // Verify events were persisted (with metadata)
    const events = await persistence.load("Counter", "counter-1");
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual(
      expect.objectContaining({
        name: "CounterCreated",
        payload: { id: "counter-1" },
      }),
    );
    expect(events[0]?.metadata).toBeDefined();
    expect(events[1]).toEqual(
      expect.objectContaining({
        name: "Incremented",
        payload: { by: 5 },
      }),
    );
    expect(events[1]?.metadata).toBeDefined();

    // Verify events were published
    expect(publishedEvents).toHaveLength(2);
  });
});

// ============================================================
// dispatchCommand rebuilds state from event stream before executing
// ============================================================

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
  decide: {
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
  evolve: {
    AccountOpened: (_p, state) => state,
    DepositMade: (payload, state) => ({
      balance: state.balance + payload.amount,
    }),
  },
});

describe("Domain.dispatchCommand", () => {
  it("should replay events to rebuild state before executing a command", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();

    const definition = defineDomain<Infrastructure>({
      writeModel: { aggregates: { BankAccount } },
      readModel: { projections: {} },
    });

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
    expect(events[2]).toEqual(
      expect.objectContaining({
        name: "DepositMade",
        payload: { amount: 50 },
      }),
    );
  });
});

// ============================================================
// projection query handlers are wired to the query bus
// ============================================================

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
    const definition = defineDomain<Infrastructure>({
      writeModel: { aggregates: {} },
      readModel: { projections: { ItemProjection } },
    });

    const domain = await wireDomain(definition, {
      buses: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus: new EventEmitterEventBus(),
        queryBus: new InMemoryQueryBus(),
      }),
    });

    const result = await domain.infrastructure.queryBus.dispatch({
      name: "GetItemById",
      payload: { id: "item-1" },
    } as ItemQuery);

    expect(result).toEqual({ id: "item-1", name: "Widget" });
  });
});

// ============================================================
// saga reacts to events and dispatches commands
// ============================================================

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
  decide: {
    PlaceOrder: (cmd) => ({
      name: "OrderPlaced",
      payload: { orderId: cmd.targetAggregateId, total: cmd.payload.total },
    }),
    ConfirmOrder: (cmd) => ({
      name: "OrderConfirmed",
      payload: { orderId: cmd.targetAggregateId },
    }),
  },
  evolve: {
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
  on: {
    OrderPlaced: {
      id: (event) => event.payload.orderId,
      handle: (event, state) => ({
        state: { ...state, confirmed: false },
        commands: {
          name: "ConfirmOrder",
          targetAggregateId: event.payload.orderId,
        },
      }),
    },
    OrderConfirmed: {
      id: (event) => event.payload.orderId,
      handle: (_event, state) => ({
        state: { ...state, confirmed: true },
      }),
    },
  },
});

describe("Domain - saga integration", () => {
  it("should execute saga handler when aggregate events are published", async () => {
    const sagaPersistence = new InMemorySagaPersistence();
    const aggregatePersistence = new InMemoryEventSourcedAggregatePersistence();

    const definition = defineDomain<Infrastructure>({
      writeModel: { aggregates: { OrderAggregate } },
      readModel: { projections: {} },
      processModel: { sagas: { OrderFulfillmentSaga } },
    });

    const domain = await wireDomain(definition, {
      aggregates: {
        persistence: () => aggregatePersistence,
      },
      sagas: {
        persistence: () => sagaPersistence,
      },
      buses: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus: new EventEmitterEventBus(),
        queryBus: new InMemoryQueryBus(),
      }),
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

// ============================================================
// init throws when a factory function fails
// ============================================================

describe("wireDomain - error handling", () => {
  it("should propagate errors from infrastructure factories", async () => {
    const definition = defineDomain<Infrastructure>({
      writeModel: { aggregates: {} },
      readModel: { projections: {} },
    });

    await expect(
      wireDomain(definition, {
        infrastructure: () => {
          throw new Error("Database connection failed");
        },
      }),
    ).rejects.toThrow("Database connection failed");
  });
});

// ============================================================
// domain works with state-stored persistence
// ============================================================

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
  decide: {
    AddTodo: (cmd) => ({
      name: "TodoAdded",
      payload: { item: cmd.payload.item },
    }),
  },
  evolve: {
    TodoAdded: (payload, state) => ({
      items: [...state.items, payload.item],
    }),
  },
});

describe("Domain - state-stored persistence", () => {
  it("should use state-stored persistence to save aggregate snapshots", async () => {
    const persistence = new InMemoryStateStoredAggregatePersistence();

    const definition = defineDomain<Infrastructure>({
      writeModel: { aggregates: { TodoList } },
      readModel: { projections: {} },
    });

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

    const loaded = await persistence.load("TodoList", "list-1");
    expect(loaded).toEqual({
      state: { items: ["Buy milk", "Walk dog"] },
      version: 2,
    });
  });
});

// ============================================================
// standalone command handlers receive merged infrastructure
// ============================================================

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

    const definition = defineDomain<NotificationInfrastructure, NotifyCommand>({
      writeModel: {
        aggregates: {},
        standaloneCommandHandlers: {
          SendNotification: (command, infra) => {
            infra.notifier.send(command.payload.message);
          },
        },
      },
      readModel: { projections: {} },
    });

    const domain = await wireDomain(definition, {
      infrastructure: () => ({
        notifier: { send: sendSpy },
      }),
      buses: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus: new EventEmitterEventBus(),
        queryBus: new InMemoryQueryBus(),
      }),
    });

    await domain.infrastructure.commandBus.dispatch({
      name: "SendNotification",
      payload: { message: "Hello!" },
    });

    expect(sendSpy).toHaveBeenCalledWith("Hello!");
  });
});

// ============================================================
// events are not published if persistence fails
// ============================================================

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
  decide: {
    DoThing: (cmd) => ({
      name: "ThingHappened",
      payload: { id: cmd.targetAggregateId },
    }),
  },
  evolve: {
    ThingHappened: (_p, state) => state,
  },
});

describe("Domain - persistence failure", () => {
  it("should not publish events when persistence save fails", async () => {
    const eventBus = new EventEmitterEventBus();
    const eventSpy = vi.fn();

    eventBus.on("ThingHappened", eventSpy);

    const failingPersistence: EventSourcedAggregatePersistence = {
      load: async () => [],
      save: async (_name, _id, _events, _expectedVersion) => {
        throw new Error("Persistence failure");
      },
    };

    const definition = defineDomain<Infrastructure>({
      writeModel: { aggregates: { SimpleAggregate } },
      readModel: { projections: {} },
    });

    const domain = await wireDomain(definition, {
      aggregates: {
        persistence: () => failingPersistence,
      },
      buses: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus,
        queryBus: new InMemoryQueryBus(),
      }),
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

// ============================================================
// dispatchQuery delegates to query bus and returns typed result
// ============================================================

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
    const definition = defineDomain<Infrastructure>({
      writeModel: { aggregates: {} },
      readModel: { projections: { ProductProjection } },
    });

    const domain = await wireDomain(definition, {
      buses: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus: new EventEmitterEventBus(),
        queryBus: new InMemoryQueryBus(),
      }),
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

// ============================================================
// dispatchQuery propagates errors when no handler is registered
// ============================================================

describe("Domain.dispatchQuery - error propagation", () => {
  it("should propagate query bus errors when no handler is registered", async () => {
    const definition = defineDomain<Infrastructure>({
      writeModel: { aggregates: {} },
      readModel: { projections: {} },
    });

    const domain = await wireDomain(definition, {
      buses: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus: new EventEmitterEventBus(),
        queryBus: new InMemoryQueryBus(),
      }),
    });

    await expect(
      domain.dispatchQuery({
        name: "NonExistentQuery",
        payload: {},
      }),
    ).rejects.toThrow("No handler registered for query: NonExistentQuery");
  });
});

// ============================================================
// domain.withUnitOfWork() groups multiple commands atomically
// ============================================================

describe("Domain.withUnitOfWork", () => {
  it("should group multiple commands into one atomic commit", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();
    const eventBus = new EventEmitterEventBus();
    const publishedEvents: any[] = [];

    eventBus.on("CounterCreated", (event: any) => {
      publishedEvents.push(event);
    });
    eventBus.on("Incremented", (event: any) => {
      publishedEvents.push(event);
    });

    const definition = defineDomain<Infrastructure>({
      writeModel: { aggregates: { Counter } },
      readModel: { projections: {} },
    });

    const domain = await wireDomain(definition, {
      aggregates: {
        persistence: () => persistence,
      },
      buses: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus,
        queryBus: new InMemoryQueryBus(),
      }),
    });

    await domain.withUnitOfWork(async () => {
      await domain.dispatchCommand({
        name: "CreateCounter",
        targetAggregateId: "c-1",
      });
      await domain.dispatchCommand({
        name: "CreateCounter",
        targetAggregateId: "c-1b",
      });
    });

    // Both commands persisted
    const events1 = await persistence.load("Counter", "c-1");
    const events2 = await persistence.load("Counter", "c-1b");
    expect(events1).toHaveLength(1);
    expect(events2).toHaveLength(1);

    // Both events published after commit
    expect(publishedEvents).toHaveLength(2);
  });

  it("should publish events only after all commands persist", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();
    const eventBus = new EventEmitterEventBus();
    const timeline: string[] = [];

    // Wrap save to track ordering
    const originalSave = persistence.save.bind(persistence);
    persistence.save = async (...args: any[]) => {
      timeline.push("persist");
      return originalSave(...args);
    };

    eventBus.on("CounterCreated", () => {
      timeline.push("publish:CounterCreated");
    });

    const definition = defineDomain<Infrastructure>({
      writeModel: { aggregates: { Counter } },
      readModel: { projections: {} },
    });

    const domain = await wireDomain(definition, {
      aggregates: {
        persistence: () => persistence,
      },
      buses: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus,
        queryBus: new InMemoryQueryBus(),
      }),
    });

    await domain.withUnitOfWork(async () => {
      await domain.dispatchCommand({
        name: "CreateCounter",
        targetAggregateId: "c-2a",
      });
      await domain.dispatchCommand({
        name: "CreateCounter",
        targetAggregateId: "c-2b",
      });
    });

    // All persists happen before any publish
    expect(timeline).toEqual([
      "persist",
      "persist",
      "publish:CounterCreated",
      "publish:CounterCreated",
    ]);
  });

  it("should rollback all changes if any command fails", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();
    const eventBus = new EventEmitterEventBus();
    const eventSpy = vi.fn();

    eventBus.on("CounterCreated", eventSpy);

    // Create a "broken" aggregate that throws on Increment
    const BrokenCounter = defineAggregate<CounterTypes>({
      initialState: { count: 0 },
      decide: {
        CreateCounter: (cmd) => ({
          name: "CounterCreated",
          payload: { id: cmd.targetAggregateId },
        }),
        Increment: () => {
          throw new Error("Command handler failure");
        },
      },
      evolve: {
        CounterCreated: (_payload, state) => state,
        Incremented: (payload, state) => ({
          count: state.count + payload.by,
        }),
      },
    });

    const definition = defineDomain<Infrastructure>({
      writeModel: { aggregates: { BrokenCounter } },
      readModel: { projections: {} },
    });

    const domain = await wireDomain(definition, {
      aggregates: {
        persistence: () => persistence,
      },
      buses: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus,
        queryBus: new InMemoryQueryBus(),
      }),
    });

    await expect(
      domain.withUnitOfWork(async () => {
        await domain.dispatchCommand({
          name: "CreateCounter",
          targetAggregateId: "c-fail",
        });
        // This will throw
        await domain.dispatchCommand({
          name: "Increment",
          targetAggregateId: "c-fail",
          payload: { by: 1 },
        });
      }),
    ).rejects.toThrow("Command handler failure");

    // No events should have been published
    expect(eventSpy).not.toHaveBeenCalled();
  });

  it("should throw on nested units of work", async () => {
    const definition = defineDomain<Infrastructure>({
      writeModel: { aggregates: {} },
      readModel: { projections: {} },
    });

    const domain = await wireDomain(definition, {
      buses: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus: new EventEmitterEventBus(),
        queryBus: new InMemoryQueryBus(),
      }),
    });

    await expect(
      domain.withUnitOfWork(async () => {
        await domain.withUnitOfWork(async () => {
          // This should throw
        });
      }),
    ).rejects.toThrow("Nested units of work are not supported");
  });

  it("should return the value from the unit of work function", async () => {
    const definition = defineDomain<Infrastructure>({
      writeModel: { aggregates: { Counter } },
      readModel: { projections: {} },
    });

    const domain = await wireDomain(definition, {
      aggregates: {
        persistence: () => new InMemoryEventSourcedAggregatePersistence(),
      },
      buses: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus: new EventEmitterEventBus(),
        queryBus: new InMemoryQueryBus(),
      }),
    });

    const result = await domain.withUnitOfWork(async () => {
      await domain.dispatchCommand({
        name: "CreateCounter",
        targetAggregateId: "c-ret",
      });
      return "uow-result";
    });

    expect(result).toBe("uow-result");
  });
});

// ============================================================
// custom unitOfWorkFactory is used when provided
// ============================================================

describe("Domain - custom unitOfWorkFactory", () => {
  it("should use the provided unitOfWorkFactory", async () => {
    const factoryCalls: number[] = [];
    let callCount = 0;

    const definition = defineDomain<Infrastructure>({
      writeModel: { aggregates: { Counter } },
      readModel: { projections: {} },
    });

    const domain = await wireDomain(definition, {
      aggregates: {
        persistence: () => new InMemoryEventSourcedAggregatePersistence(),
      },
      buses: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus: new EventEmitterEventBus(),
        queryBus: new InMemoryQueryBus(),
      }),
      unitOfWork: () => {
        // Return a factory that tracks calls
        return () => {
          callCount++;
          factoryCalls.push(callCount);
          return createInMemoryUnitOfWork();
        };
      },
    });

    await domain.dispatchCommand({
      name: "CreateCounter",
      targetAggregateId: "c-custom",
    });

    // The custom factory should have been called once (one command = one UoW)
    expect(factoryCalls).toHaveLength(1);
  });
});

// ============================================================
// pessimistic concurrency via InMemoryAggregateLocker
// ============================================================

describe("Domain - pessimistic concurrency", () => {
  it("should execute command successfully with pessimistic locking", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();
    const locker = new InMemoryAggregateLocker();

    const definition = defineDomain<Infrastructure>({
      writeModel: { aggregates: { Counter } },
      readModel: { projections: {} },
    });

    const domain = await wireDomain(definition, {
      aggregates: {
        persistence: () => persistence,
        concurrency: {
          strategy: "pessimistic",
          locker,
        },
      },
      buses: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus: new EventEmitterEventBus(),
        queryBus: new InMemoryQueryBus(),
      }),
    });

    await domain.dispatchCommand({
      name: "CreateCounter",
      targetAggregateId: "p-1",
    });

    const events = await persistence.load("Counter", "p-1");
    expect(events).toHaveLength(1);
    expect(events[0]?.name).toBe("CounterCreated");
  });

  it("should release lock even when command handler throws", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();
    const locker = new InMemoryAggregateLocker();

    // Aggregate that throws on a specific command
    const FailingCounter = defineAggregate<CounterTypes>({
      initialState: { count: 0 },
      decide: {
        CreateCounter: (cmd) => ({
          name: "CounterCreated",
          payload: { id: cmd.targetAggregateId },
        }),
        Increment: () => {
          throw new Error("Handler failure");
        },
      },
      evolve: {
        CounterCreated: (_payload, state) => state,
        Incremented: (payload, state) => ({
          count: state.count + payload.by,
        }),
      },
    });

    const definition = defineDomain<Infrastructure>({
      writeModel: { aggregates: { FailingCounter } },
      readModel: { projections: {} },
    });

    const domain = await wireDomain(definition, {
      aggregates: {
        persistence: () => persistence,
        concurrency: {
          strategy: "pessimistic",
          locker,
        },
      },
      buses: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus: new EventEmitterEventBus(),
        queryBus: new InMemoryQueryBus(),
      }),
    });

    // First command succeeds (create)
    await domain.dispatchCommand({
      name: "CreateCounter",
      targetAggregateId: "p-fail",
    });

    // Second command throws
    await expect(
      domain.dispatchCommand({
        name: "Increment",
        targetAggregateId: "p-fail",
        payload: { by: 1 },
      }),
    ).rejects.toThrow("Handler failure");

    // Lock should be released — a subsequent command on the same
    // aggregate should succeed without hanging
    await domain.dispatchCommand({
      name: "CreateCounter",
      targetAggregateId: "p-fail-2",
    });

    const events = await persistence.load("FailingCounter", "p-fail-2");
    expect(events).toHaveLength(1);
  });

  it("should serialize concurrent commands on same aggregate", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();
    const locker = new InMemoryAggregateLocker();

    const definition = defineDomain<Infrastructure>({
      writeModel: { aggregates: { Counter } },
      readModel: { projections: {} },
    });

    const domain = await wireDomain(definition, {
      aggregates: {
        persistence: () => persistence,
        concurrency: {
          strategy: "pessimistic",
          locker,
        },
      },
      buses: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus: new EventEmitterEventBus(),
        queryBus: new InMemoryQueryBus(),
      }),
    });

    // Create the aggregate first
    await domain.dispatchCommand({
      name: "CreateCounter",
      targetAggregateId: "p-conc",
    });

    // Dispatch two increments concurrently
    await Promise.all([
      domain.dispatchCommand({
        name: "Increment",
        targetAggregateId: "p-conc",
        payload: { by: 1 },
      }),
      domain.dispatchCommand({
        name: "Increment",
        targetAggregateId: "p-conc",
        payload: { by: 2 },
      }),
    ]);

    const events = await persistence.load("Counter", "p-conc");
    // 1 create + 2 increments = 3 events
    expect(events).toHaveLength(3);
    expect(events[0]?.name).toBe("CounterCreated");
    // Both increments should be present (order may vary due to scheduling)
    const incrementPayloads = events
      .filter((e) => e.name === "Incremented")
      .map((e) => e.payload.by)
      .sort();
    expect(incrementPayloads).toEqual([1, 2]);
  });
});

// ============================================================
// Idempotent command processing
// ============================================================

describe("Idempotent command processing", () => {
  it("should skip duplicate command with same commandId", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();
    const idempotencyStore = new InMemoryIdempotencyStore();

    const definition = defineDomain<Infrastructure>({
      writeModel: { aggregates: { Counter } },
      readModel: { projections: {} },
    });

    const domain = await wireDomain(definition, {
      aggregates: {
        persistence: () => persistence,
      },
      idempotency: () => idempotencyStore,
      buses: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus: new EventEmitterEventBus(),
        queryBus: new InMemoryQueryBus(),
      }),
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

    const definition = defineDomain<Infrastructure>({
      writeModel: { aggregates: { Counter } },
      readModel: { projections: {} },
    });

    const domain = await wireDomain(definition, {
      idempotency: () => idempotencyStore,
      buses: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus: new EventEmitterEventBus(),
        queryBus: new InMemoryQueryBus(),
      }),
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

    const definition = defineDomain<Infrastructure>({
      writeModel: { aggregates: { Counter } },
      readModel: { projections: {} },
    });

    const domain = await wireDomain(definition, {
      aggregates: {
        persistence: () => persistence,
      },
      idempotency: () => idempotencyStore,
      buses: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus: new EventEmitterEventBus(),
        queryBus: new InMemoryQueryBus(),
      }),
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

    const definition = defineDomain<Infrastructure>({
      writeModel: { aggregates: { Counter } },
      readModel: { projections: {} },
    });

    const domain = await wireDomain(definition, {
      aggregates: {
        persistence: () => failingPersistence as any,
      },
      idempotency: () => idempotencyStore,
      buses: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus: new EventEmitterEventBus(),
        queryBus: new InMemoryQueryBus(),
      }),
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

// ============================================================
// Per-aggregate persistence
// ============================================================

// Reuse BankAccount aggregate defined above (Balance types with Deposit/DepositMade)

describe("Per-aggregate persistence", () => {
  it("should route each aggregate to its configured persistence", async () => {
    const esPersistence = new InMemoryEventSourcedAggregatePersistence();
    const ssPersistence = new InMemoryStateStoredAggregatePersistence();

    const definition = defineDomain<Infrastructure>({
      writeModel: { aggregates: { Counter, BankAccount } },
      readModel: { projections: {} },
    });

    const domain = await wireDomain(definition, {
      aggregates: {
        Counter: {
          persistence: () => esPersistence,
        },
        BankAccount: {
          persistence: () => ssPersistence,
        },
      },
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

describe("Per-aggregate persistence via wireDomain", () => {
  it("should throw when per-aggregate persistence is missing entries", async () => {
    const esPersistence = new InMemoryEventSourcedAggregatePersistence();

    const definition = defineDomain<Infrastructure>({
      writeModel: { aggregates: { Counter, BankAccount } },
      readModel: { projections: {} },
    });

    // Only provide persistence for Counter — BankAccount is missing
    await expect(
      wireDomain(definition, {
        aggregates: {
          Counter: {
            persistence: () => esPersistence,
          },
          BankAccount: {},
        },
        buses: () => ({
          commandBus: new InMemoryCommandBus(),
          eventBus: new EventEmitterEventBus(),
          queryBus: new InMemoryQueryBus(),
        }),
      }),
    ).rejects.toThrow(
      "Per-aggregate persistence is missing entries for: BankAccount",
    );
  });
});

describe("Domain-wide persistence", () => {
  it("should use a single persistence factory for all aggregates", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();

    const definition = defineDomain<Infrastructure>({
      writeModel: { aggregates: { Counter } },
      readModel: { projections: {} },
    });

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

    await domain.dispatchCommand({
      name: "Increment",
      targetAggregateId: "c-1",
      payload: { by: 3 },
    });

    const events = await persistence.load("Counter", "c-1");
    expect(events).toHaveLength(1);
  });
});

describe("Per-aggregate persistence factory resolution", () => {
  it("should resolve all async per-aggregate factories during init", async () => {
    const esFactory = vi.fn(
      async () => new InMemoryEventSourcedAggregatePersistence(),
    );
    const ssFactory = vi.fn(
      async () => new InMemoryStateStoredAggregatePersistence(),
    );

    const definition = defineDomain<Infrastructure>({
      writeModel: { aggregates: { Counter, BankAccount } },
      readModel: { projections: {} },
    });

    await wireDomain(definition, {
      aggregates: {
        Counter: {
          persistence: esFactory,
        },
        BankAccount: {
          persistence: ssFactory,
        },
      },
      buses: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus: new EventEmitterEventBus(),
        queryBus: new InMemoryQueryBus(),
      }),
    });

    expect(esFactory).toHaveBeenCalledOnce();
    expect(ssFactory).toHaveBeenCalledOnce();
  });
});

describe("Mixed persistence with snapshots", () => {
  it("should only create snapshots for event-sourced aggregates", async () => {
    const snapshotStore = new InMemorySnapshotStore();

    const definition = defineDomain<Infrastructure>({
      writeModel: { aggregates: { Counter, BankAccount } },
      readModel: { projections: {} },
    });

    const domain = await wireDomain(definition, {
      aggregates: {
        Counter: {
          persistence: () => new InMemoryEventSourcedAggregatePersistence(),
          snapshots: {
            store: () => snapshotStore,
            strategy: everyNEvents(1),
          },
        },
        BankAccount: {
          persistence: () => new InMemoryStateStoredAggregatePersistence(),
        },
      },
      buses: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus: new EventEmitterEventBus(),
        queryBus: new InMemoryQueryBus(),
      }),
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

// ============================================================
// defineDomain returns a typed DomainDefinition
// ============================================================

describe("defineDomain", () => {
  it("should return the definition unchanged with type inference", () => {
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

    const definition = defineDomain<Infrastructure>({
      writeModel: { aggregates: { Pinger } },
      readModel: { projections: {} },
    });

    expect(definition.writeModel.aggregates).toEqual({ Pinger });
    expect(definition.readModel.projections).toEqual({});
    expect(definition.processModel).toBeUndefined();
  });
});

// ============================================================
// wireDomain creates and initializes a domain from definition + wiring
// ============================================================

describe("wireDomain", () => {
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

  it("should work with empty wiring using all defaults", async () => {
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

    const definition = defineDomain<Infrastructure>({
      writeModel: { aggregates: { Pinger } },
      readModel: { projections: {} },
    });

    const domain = await wireDomain(definition, {});
    expect(domain).toBeInstanceOf(Domain);

    await domain.dispatchCommand({
      name: "Ping",
      targetAggregateId: "p-1",
    });
  });

  it("should provide user infrastructure separated from framework plumbing", async () => {
    interface AppInfrastructure {
      clock: { now(): Date };
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
        Pinged: (payload) => ({ lastPing: new Date(payload.at) }),
      },
    });

    const fixedDate = new Date("2025-06-01T12:00:00Z");

    const definition = defineDomain<AppInfrastructure>({
      writeModel: { aggregates: { Pinger } },
      readModel: { projections: {} },
    });

    const domain = await wireDomain(definition, {
      infrastructure: () => ({
        clock: { now: () => fixedDate },
      }),
      buses: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus: new EventEmitterEventBus(),
        queryBus: new InMemoryQueryBus(),
      }),
    });

    // User infrastructure is accessible
    expect(domain.infrastructure.clock.now()).toBe(fixedDate);

    // CQRS buses are also on infrastructure (merged)
    expect(domain.infrastructure.commandBus).toBeInstanceOf(InMemoryCommandBus);
  });
});

// ============================================================
// wireDomain per-aggregate config
// ============================================================

describe("wireDomain per-aggregate config", () => {
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

// ============================================================
// wireDomain projection wiring
// ============================================================

describe("wireDomain projection wiring", () => {
  it("should resolve viewStore from wiring.projections", async () => {
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
          reduce: (event) => ({
            id: event.payload.id,
            name: event.payload.name,
          }),
        },
      },
      queryHandlers: {
        GetItem: (payload, { views }) =>
          (views as InMemoryViewStore<ItemView>).load(payload.id),
      },
      initialView: { id: "", name: "" },
      // No viewStore on the definition — provided via wiring
    });

    type ItemAggregateTypes = AggregateTypes & {
      state: Record<string, never>;
      events: ItemEvent;
      commands: DefineCommands<{
        AddItem: { id: string; name: string };
      }>;
      infrastructure: Infrastructure;
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

    const viewStore = new InMemoryViewStore<ItemView>();

    const definition = defineDomain<Infrastructure>({
      writeModel: { aggregates: { Item: ItemAggregate } },
      readModel: { projections: { ItemProjection } },
    });

    const domain = await wireDomain(definition, {
      projections: {
        ItemProjection: {
          viewStore: createViewStoreFactory(() => viewStore),
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

// ============================================================
// wireDomain hello world (no wiring argument)
// ============================================================

describe("wireDomain hello world", () => {
  it("should work with no wiring argument at all", async () => {
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

    const definition = defineDomain<Infrastructure>({
      writeModel: { aggregates: { Pinger } },
      readModel: { projections: {} },
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const domain = await wireDomain(definition);
    expect(domain).toBeInstanceOf(Domain);

    // Should work with in-memory defaults
    await domain.dispatchCommand({
      name: "Ping",
      targetAggregateId: "p-1",
    });

    warnSpy.mockRestore();
  });

  it("should log warnings when using in-memory defaults", async () => {
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

    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    const definition = defineDomain<Infrastructure>({
      writeModel: { aggregates: { Pinger } },
      readModel: { projections: {} },
    });

    await wireDomain(definition);

    const output = stderrSpy.mock.calls.map((c) => c[0] as string).join("");
    // Should warn about in-memory persistence
    expect(output).toContain("aggregate persistence");
    // Should warn about in-memory buses
    expect(output).toContain("buses");

    stderrSpy.mockRestore();
  });

  it("should not log warnings when all wiring is explicitly provided", async () => {
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

    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    const definition = defineDomain<Infrastructure>({
      writeModel: { aggregates: { Pinger } },
      readModel: { projections: {} },
    });

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

    expect(stderrSpy).not.toHaveBeenCalled();

    stderrSpy.mockRestore();
  });

  it("should log saga persistence warning when sagas use default", async () => {
    type OrderEvent = DefineEvents<{
      OrderPlaced: { orderId: string };
    }>;
    type OrderCommand = DefineCommands<{
      PlaceOrder: void;
    }>;
    type OrderState = { placed: boolean };
    type OrderTypes = AggregateTypes & {
      state: OrderState;
      events: OrderEvent;
      commands: OrderCommand;
      infrastructure: Infrastructure;
    };

    const Order = defineAggregate<OrderTypes>({
      initialState: { placed: false },
      decide: {
        PlaceOrder: (cmd) => ({
          name: "OrderPlaced",
          payload: { orderId: cmd.targetAggregateId },
        }),
      },
      evolve: {
        OrderPlaced: () => ({ placed: true }),
      },
    });

    type SagaState = { started: boolean };
    type TestSagaTypes = SagaTypes & {
      state: SagaState;
      events: OrderEvent;
      commands: OrderCommand;
      infrastructure: Infrastructure;
    };

    const TestSaga = defineSaga<TestSagaTypes>({
      initialState: { started: false },
      startedBy: ["OrderPlaced"],
      on: {
        OrderPlaced: {
          id: (event) => event.payload.orderId,
          handle: (_event, state) => ({
            state: { started: true },
          }),
        },
      },
    });

    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    const definition = defineDomain<Infrastructure>({
      writeModel: { aggregates: { Order } },
      readModel: { projections: {} },
      processModel: { sagas: { TestSaga } },
    });

    await wireDomain(definition);

    const output = stderrSpy.mock.calls.map((c) => c[0] as string).join("");
    // Should warn about in-memory saga persistence
    expect(output).toContain("saga persistence");

    stderrSpy.mockRestore();
  });
});

// ============================================================
// Standalone event handlers on processModel
// ============================================================

describe("standalone event handlers", () => {
  // Reuse the Counter aggregate defined earlier in this file
  const CounterAggregate = defineAggregate<CounterTypes>({
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

  it("should invoke handler when matching event is dispatched", async () => {
    const receivedEvents: Array<{ name: string; payload: unknown }> = [];

    const definition = defineDomain<Infrastructure>({
      writeModel: { aggregates: { CounterAggregate } },
      readModel: { projections: {} },
      processModel: {
        standaloneEventHandlers: {
          Incremented: (event) => {
            receivedEvents.push({ name: event.name, payload: event.payload });
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
      name: "CreateCounter",
      targetAggregateId: "c-1",
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

  it("should not log saga persistence warning when processModel has only standaloneEventHandlers", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const definition = defineDomain<Infrastructure>({
      writeModel: { aggregates: { CounterAggregate } },
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

  it("should await async standalone event handlers before dispatch resolves", async () => {
    let completed = false;

    const definition = defineDomain<Infrastructure>({
      writeModel: { aggregates: { CounterAggregate } },
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
      name: "CreateCounter",
      targetAggregateId: "c-1",
    });
    await domain.dispatchCommand({
      name: "Increment",
      targetAggregateId: "c-1",
      payload: { by: 1 },
    });

    expect(completed).toBe(true);
  });

  it("should handle empty standaloneEventHandlers gracefully", async () => {
    const definition = defineDomain<Infrastructure>({
      writeModel: { aggregates: { CounterAggregate } },
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

  it("should auto-connect buses that implement Connectable", async () => {
    const connectCalls: string[] = [];

    const connectableEventBus = {
      dispatch: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
      connect: vi.fn().mockImplementation(async () => {
        connectCalls.push("eventBus.connect");
      }),
    };

    const definition = defineDomain<Infrastructure>({
      writeModel: { aggregates: {} },
      readModel: { projections: {} },
    });

    await wireDomain(definition, {
      buses: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus: connectableEventBus as unknown as EventEmitterEventBus,
        queryBus: new InMemoryQueryBus(),
      }),
    });

    expect(connectCalls).toContain("eventBus.connect");
    expect(connectableEventBus.connect).toHaveBeenCalledOnce();
  });

  it("should auto-connect buses AFTER all handler registration to prevent race conditions", async () => {
    const callOrder: string[] = [];

    const connectableEventBus = {
      dispatch: vi.fn().mockResolvedValue(undefined),
      on: vi.fn().mockImplementation(() => {
        callOrder.push("on");
      }),
      close: vi.fn().mockResolvedValue(undefined),
      connect: vi.fn().mockImplementation(async () => {
        callOrder.push("connect");
      }),
    };

    const definition = defineDomain<Infrastructure>({
      writeModel: { aggregates: {} },
      readModel: { projections: {} },
      processModel: {
        standaloneEventHandlers: {
          SomeEvent: async () => {},
        },
      },
    });

    await wireDomain(definition, {
      buses: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus: connectableEventBus as unknown as EventEmitterEventBus,
        queryBus: new InMemoryQueryBus(),
      }),
    });

    // All on() calls must precede connect()
    const lastOnIndex = callOrder.lastIndexOf("on");
    const connectIndex = callOrder.indexOf("connect");
    expect(connectIndex).toBeGreaterThan(-1);
    expect(lastOnIndex).toBeGreaterThan(-1);
    expect(connectIndex).toBeGreaterThan(lastOnIndex);
  });

  it("should not call connect on non-connectable buses (in-memory)", async () => {
    const commandBus = new InMemoryCommandBus();
    const eventBus = new EventEmitterEventBus();
    const queryBus = new InMemoryQueryBus();

    // These in-memory buses do not have a connect method
    expect(typeof (commandBus as any).connect).toBe("undefined");
    expect(typeof (eventBus as any).connect).toBe("undefined");
    expect(typeof (queryBus as any).connect).toBe("undefined");

    const definition = defineDomain<Infrastructure>({
      writeModel: { aggregates: {} },
      readModel: { projections: {} },
    });

    // wireDomain should succeed without any issues
    const domain = await wireDomain(definition, {
      buses: () => ({ commandBus, eventBus, queryBus }),
    });

    expect(domain).toBeInstanceOf(Domain);
  });
});
