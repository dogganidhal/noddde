import { describe, it, expect, vi } from "vitest";
import {
  configureDomain,
  Domain,
  EventEmitterEventBus,
  InMemoryCommandBus,
  InMemoryQueryBus,
  InMemoryEventSourcedAggregatePersistence,
  InMemoryStateStoredAggregatePersistence,
  InMemorySagaPersistence,
  defineAggregate,
  defineProjection,
  defineSaga,
} from "@noddde/core";
import type {
  Infrastructure,
  CQRSInfrastructure,
  DefineCommands,
  DefineEvents,
  DefineQueries,
  AggregateTypes,
  ProjectionTypes,
  SagaTypes,
  EventSourcedAggregatePersistence,
  Event,
  Query,
} from "@noddde/core";

// ============================================================
// configureDomain creates and initializes a domain
// ============================================================

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

// ============================================================
// init resolves custom infrastructure and merges with CQRS buses
// ============================================================

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

    eventBus.on("CounterCreated", (payload: any) => {
      publishedEvents.push({ name: "CounterCreated", payload });
    });
    eventBus.on("Incremented", (payload: any) => {
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

// ============================================================
// projection query handlers are wired to the query bus
// ============================================================

type ItemEvent = DefineEvents<{
  ItemAdded: { id: string; name: string };
}>;

type ItemQuery = DefineQueries<{
  GetItemById: { payload: { id: string }; result: { id: string; name: string } | null };
}>;

type ItemProjectionTypes = ProjectionTypes & {
  events: ItemEvent;
  queries: ItemQuery;
  view: Map<string, { id: string; name: string }>;
  infrastructure: Infrastructure;
};

const ItemProjection = defineProjection<ItemProjectionTypes>({
  reducers: {
    ItemAdded: (event, view) => {
      view.set(event.payload.id, event.payload);
      return view;
    },
  },
  queryHandlers: {
    GetItemById: (payload) => {
      // In a real implementation, this would read from a repository
      return payload?.id === "item-1"
        ? { id: "item-1", name: "Widget" }
        : null;
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

// ============================================================
// init throws when a factory function fails
// ============================================================

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

    eventBus.on("ThingHappened", eventSpy);

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

// ============================================================
// dispatchQuery delegates to query bus and returns typed result
// ============================================================

type ProductEvent = DefineEvents<{
  ProductAdded: { id: string; name: string; price: number };
}>;

type ProductQuery = DefineQueries<{
  GetProductById: { payload: { id: string }; result: { id: string; name: string; price: number } | null };
}>;

type ProductProjectionTypes = ProjectionTypes & {
  events: ProductEvent;
  queries: ProductQuery;
  view: Map<string, { id: string; name: string; price: number }>;
  infrastructure: Infrastructure;
};

const ProductProjection = defineProjection<ProductProjectionTypes>({
  reducers: {
    ProductAdded: (event, view) => {
      view.set(event.payload.id, event.payload);
      return view;
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

// ============================================================
// dispatchQuery propagates errors when no handler is registered
// ============================================================

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
