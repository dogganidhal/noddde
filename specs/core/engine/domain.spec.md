---
title: "Domain, DomainConfiguration & configureDomain"
module: engine/domain
source_file: packages/core/src/engine/domain.ts
status: implemented
exports: [Domain, DomainConfiguration, configureDomain]
depends_on:
  - engine/implementations/ee-event-bus
  - engine/implementations/in-memory-command-bus
  - engine/implementations/in-memory-query-bus
  - engine/implementations/in-memory-aggregate-persistence
  - engine/implementations/in-memory-saga-persistence
  - ddd/aggregate-root
  - ddd/projection
  - ddd/saga
  - cqrs/command/command
  - cqrs/query/query
  - edd/event
  - infrastructure
docs:
  - domain-configuration/overview.mdx
  - domain-configuration/write-model.mdx
  - domain-configuration/read-model.mdx
  - domain-configuration/infrastructure.mdx
---

# Domain, DomainConfiguration & configureDomain

> The `Domain` class is the central runtime of a noddde application. It wires together aggregates, projections, sagas, persistence, and CQRS buses into a running system. `DomainConfiguration` is the declarative configuration object that describes the entire domain. `configureDomain` is the async factory function that creates and initializes a `Domain` instance. Together they form the bootstrap and command dispatch lifecycle of the framework.

## Type Contract

```ts
type DomainConfiguration<
  TInfrastructure extends Infrastructure,
  TStandaloneCommand extends Command = Command,
  TStandaloneQuery extends Query<any> = Query<any>,
> = {
  writeModel: {
    aggregates: AggregateMap;
    standaloneCommandHandlers?: StandaloneCommandHandlerMap<TInfrastructure, TStandaloneCommand>;
  };
  readModel: {
    projections: ProjectionMap;
    standaloneQueryHandlers?: StandaloneQueryHandlerMap<TInfrastructure, TStandaloneQuery>;
  };
  processModel?: {
    sagas: SagaMap;
  };
  infrastructure: {
    aggregatePersistence?: () => PersistenceConfiguration | Promise<PersistenceConfiguration>;
    sagaPersistence?: () => SagaPersistence | Promise<SagaPersistence>;
    provideInfrastructure?: () => Promise<TInfrastructure> | TInfrastructure;
    cqrsInfrastructure?: (infrastructure: TInfrastructure) => CQRSInfrastructure | Promise<CQRSInfrastructure>;
  };
};

class Domain<
  TInfrastructure extends Infrastructure,
  TStandaloneCommand extends Command = Command,
  TStandaloneQuery extends Query<any> = Query<any>,
> {
  get infrastructure(): TInfrastructure & CQRSInfrastructure;
  init(): Promise<void>;
  dispatchCommand<TCommand extends AggregateCommand<any>>(command: TCommand): Promise<TCommand["targetAggregateId"]>;
}

const configureDomain: <TInfrastructure, TStandaloneCommand, TStandaloneQuery>(
  configuration: DomainConfiguration<TInfrastructure, TStandaloneCommand, TStandaloneQuery>,
) => Promise<Domain<TInfrastructure, TStandaloneCommand, TStandaloneQuery>>;
```

- `DomainConfiguration` is fully generic over the infrastructure, standalone command, and standalone query types.
- `Domain` stores the resolved infrastructure as `TInfrastructure & CQRSInfrastructure` -- custom dependencies merged with the CQRS buses.
- `dispatchCommand` returns the `targetAggregateId` of the handled command, allowing callers to know which aggregate processed it.
- `configureDomain` is the primary entry point. It constructs a `Domain` and calls `init()` before returning.

## Behavioral Requirements

### Domain.init() -- Initialization Sequence

The `init()` method must execute the following steps in order:

1. **Resolve custom infrastructure** -- Call `configuration.infrastructure.provideInfrastructure()` if provided. Store the result. If not provided, use `{}` as the default infrastructure.
2. **Resolve CQRS infrastructure** -- Call `configuration.infrastructure.cqrsInfrastructure(infrastructure)` if provided, passing the resolved custom infrastructure. Store the `CommandBus`, `EventBus`, and `QueryBus`. If not provided, create default in-memory implementations (`InMemoryCommandBus`, `EventEmitterEventBus`, `InMemoryQueryBus`).
3. **Merge infrastructure** -- Combine custom infrastructure and CQRS infrastructure into `this._infrastructure` as `TInfrastructure & CQRSInfrastructure`.
4. **Resolve aggregate persistence** -- Call `configuration.infrastructure.aggregatePersistence()` if provided. Store as `this._persistence`. If not provided, use a default in-memory persistence.
5. **Resolve saga persistence** -- Call `configuration.infrastructure.sagaPersistence()` if provided. Required if `processModel` is configured.
6. **Register command handlers** -- For each aggregate in `writeModel.aggregates`, register a command handler on the command bus for each command name defined in `Aggregate.commands`. The registered handler encapsulates the full command lifecycle (load, execute, apply, persist, publish).
7. **Register standalone command handlers** -- For each handler in `writeModel.standaloneCommandHandlers`, register it on the command bus, wrapping it to receive the merged infrastructure.
8. **Register query handlers** -- For each projection in `readModel.projections`, register each query handler from `Projection.queryHandlers` on the query bus.
9. **Register standalone query handlers** -- For each handler in `readModel.standaloneQueryHandlers`, register it on the query bus.
10. **Register event listeners for projections** -- For each projection, subscribe to each event name in `Projection.reducers` on the event bus. When an event arrives, invoke the reducer to update the projection's view.
11. **Register event listeners for sagas** -- For each saga in `processModel.sagas`, subscribe to each event name in `Saga.handlers` on the event bus. When an event arrives, execute the saga event handling lifecycle.

### Domain.dispatchCommand() -- Command Dispatch Lifecycle

The `dispatchCommand` method executes the following lifecycle for aggregate commands:

1. **Route** -- Look up the aggregate whose `commands` map contains a handler for `command.name`. If no aggregate handles this command, check standalone command handlers.
2. **Load** -- Using the resolved persistence:
   - **Event-sourced**: Call `persistence.load(aggregateName, command.targetAggregateId)` to get the event stream. Replay all events through `Aggregate.apply` handlers, starting from `Aggregate.initialState`, to rebuild the current state.
   - **State-stored**: Call `persistence.load(aggregateName, command.targetAggregateId)` to get the state snapshot. If `null`/`undefined`, use `Aggregate.initialState`.
3. **Execute** -- Invoke the aggregate's command handler: `aggregate.commands[command.name](command, currentState, infrastructure)`. The handler returns one or more events.
4. **Apply** -- For each returned event, apply it to the state via `aggregate.apply[event.name](event.payload, state)` to compute the new state. This ensures the aggregate's in-memory state is consistent with the events.
5. **Persist** -- Save the results:
   - **Event-sourced**: Call `persistence.save(aggregateName, command.targetAggregateId, newEvents)` to append the new events.
   - **State-stored**: Call `persistence.save(aggregateName, command.targetAggregateId, newState)` to store the updated state.
6. **Publish** -- For each new event, call `eventBus.dispatch(event)`. This triggers projections and sagas.
7. **Return** -- Return `command.targetAggregateId`.

### Saga Event Handling Lifecycle

When an event arrives on the event bus for a registered saga:

1. **Derive saga instance ID** -- Call `saga.associations[event.name](event)` to get the saga instance ID.
2. **Load saga state** -- Call `sagaPersistence.load(sagaName, sagaId)`.
3. **Bootstrap or resume** -- If state is `null`/`undefined`:
   - If `event.name` is in `saga.startedBy`, use `saga.initialState` as the current state.
   - Otherwise, ignore the event (the saga has not been started yet).
4. **Execute handler** -- Call `saga.handlers[event.name](event, currentState, infrastructure)`. Returns a `SagaReaction` with new state and optional commands.
5. **Persist saga state** -- Call `sagaPersistence.save(sagaName, sagaId, reaction.state)`.
6. **Dispatch commands** -- For each command in `reaction.commands`, dispatch it through the command bus.

### configureDomain() -- Factory Function

1. Create a new `Domain` instance with the given configuration.
2. Call `domain.init()`.
3. Return the initialized domain.

## Invariants

- `Domain.infrastructure` must not be accessed before `init()` completes. The `!` non-null assertion on the private fields indicates they are set during init.
- `init()` must be called exactly once. Calling it multiple times may re-register handlers, causing duplicate processing.
- `configureDomain` always returns an initialized domain. If `init()` throws, the promise rejects.
- The command bus enforces single-handler-per-command-name. If two aggregates define handlers for the same command name, registration must fail.
- Events are published only after successful persistence. If persistence fails, events must not be published (to avoid inconsistency between the store and downstream subscribers).
- The order of event publication matches the order of events returned by the command handler.

## Edge Cases

- **No aggregates configured** -- `writeModel.aggregates` can be `{}`. The domain can still serve queries via standalone query handlers.
- **No projections configured** -- `readModel.projections` can be `{}`. The domain can still dispatch commands.
- **No sagas configured** -- `processModel` can be omitted. No saga listeners are registered.
- **No custom infrastructure** -- `provideInfrastructure` can be omitted. The domain uses `{}` as the custom infrastructure.
- **No CQRS infrastructure provided** -- `cqrsInfrastructure` can be omitted. The domain creates default in-memory buses.
- **No persistence provided** -- `aggregatePersistence` can be omitted. The domain uses a default in-memory persistence.
- **Command handler returns a single event** -- Must be normalized to an array before processing.
- **Command handler returns empty array** -- No events to apply, persist, or publish. The aggregate state remains unchanged.
- **Saga handler returns no commands** -- `reaction.commands` is `undefined` or empty. Only the saga state is persisted; no commands are dispatched.
- **init() factory throws** -- The error propagates through `configureDomain` and the domain is not usable.
- **Circular saga-command loops** -- A saga dispatches a command that produces an event that triggers the same saga. The framework does not prevent infinite loops; the saga handler must include termination logic (e.g., checking state to avoid re-dispatching).

## Integration Points

- **CQRS buses** -- The domain owns the command bus, query bus, and event bus. They are wired during init and exposed via `domain.infrastructure`.
- **Persistence** -- The domain owns aggregate and saga persistence. They are resolved during init from factory functions.
- **Aggregates** -- The domain reads `Aggregate.initialState`, `Aggregate.commands`, and `Aggregate.apply` to implement the command lifecycle.
- **Projections** -- The domain reads `Projection.reducers` and `Projection.queryHandlers` to wire event listeners and query handlers.
- **Sagas** -- The domain reads `Saga.initialState`, `Saga.startedBy`, `Saga.associations`, and `Saga.handlers` to wire event listeners and execute the saga lifecycle.
- **External consumers** -- Applications interact with the domain via `domain.dispatchCommand(command)` and `domain.infrastructure.queryBus.dispatch(query)`.

## Test Scenarios

### configureDomain creates and initializes a domain

```ts
import { describe, it, expect } from "vitest";
import {
  configureDomain,
  Domain,
  EventEmitterEventBus,
  InMemoryCommandBus,
  InMemoryQueryBus,
} from "@noddde/core";
import type { Infrastructure, CQRSInfrastructure } from "@noddde/core";

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
```

### init resolves custom infrastructure and merges with CQRS buses

```ts
import { describe, it, expect } from "vitest";
import {
  configureDomain,
  EventEmitterEventBus,
  InMemoryCommandBus,
  InMemoryQueryBus,
} from "@noddde/core";

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
```

### dispatchCommand executes the full aggregate lifecycle

```ts
import { describe, it, expect, vi } from "vitest";
import {
  configureDomain,
  defineAggregate,
  EventEmitterEventBus,
  InMemoryCommandBus,
  InMemoryQueryBus,
  InMemoryEventSourcedAggregatePersistence,
} from "@noddde/core";
import type {
  DefineCommands,
  DefineEvents,
  AggregateTypes,
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

    // @ts-expect-error -- accessing private for test observation
    eventBus.underlying.on("CounterCreated", (payload: any) => {
      publishedEvents.push({ name: "CounterCreated", payload });
    });
    // @ts-expect-error -- accessing private for test observation
    eventBus.underlying.on("Incremented", (payload: any) => {
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
```

### dispatchCommand rebuilds state from event stream before executing

```ts
import { describe, it, expect } from "vitest";
import {
  configureDomain,
  defineAggregate,
  EventEmitterEventBus,
  InMemoryCommandBus,
  InMemoryQueryBus,
  InMemoryEventSourcedAggregatePersistence,
} from "@noddde/core";
import type {
  DefineCommands,
  DefineEvents,
  AggregateTypes,
  Infrastructure,
} from "@noddde/core";

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
```

### projection query handlers are wired to the query bus

```ts
import { describe, it, expect, vi } from "vitest";
import {
  configureDomain,
  defineProjection,
  EventEmitterEventBus,
  InMemoryCommandBus,
  InMemoryQueryBus,
} from "@noddde/core";
import type {
  DefineEvents,
  DefineQueries,
  ProjectionTypes,
  Infrastructure,
  Query,
} from "@noddde/core";

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
```

### saga reacts to events and dispatches commands

```ts
import { describe, it, expect, vi } from "vitest";
import {
  configureDomain,
  defineAggregate,
  defineSaga,
  EventEmitterEventBus,
  InMemoryCommandBus,
  InMemoryQueryBus,
  InMemoryEventSourcedAggregatePersistence,
  InMemorySagaPersistence,
} from "@noddde/core";
import type {
  DefineCommands,
  DefineEvents,
  AggregateTypes,
  SagaTypes,
  Infrastructure,
} from "@noddde/core";

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
```

### init throws when a factory function fails

```ts
import { describe, it, expect } from "vitest";
import { configureDomain } from "@noddde/core";
import type { Infrastructure } from "@noddde/core";

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
```

### domain works with state-stored persistence

```ts
import { describe, it, expect } from "vitest";
import {
  configureDomain,
  defineAggregate,
  EventEmitterEventBus,
  InMemoryCommandBus,
  InMemoryQueryBus,
  InMemoryStateStoredAggregatePersistence,
} from "@noddde/core";
import type {
  DefineCommands,
  DefineEvents,
  AggregateTypes,
  Infrastructure,
} from "@noddde/core";

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
```

### standalone command handlers receive merged infrastructure

```ts
import { describe, it, expect, vi } from "vitest";
import {
  configureDomain,
  EventEmitterEventBus,
  InMemoryCommandBus,
  InMemoryQueryBus,
} from "@noddde/core";
import type { Infrastructure, CQRSInfrastructure } from "@noddde/core";

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
```

### events are not published if persistence fails

```ts
import { describe, it, expect, vi } from "vitest";
import {
  configureDomain,
  defineAggregate,
  EventEmitterEventBus,
  InMemoryCommandBus,
  InMemoryQueryBus,
} from "@noddde/core";
import type {
  DefineCommands,
  DefineEvents,
  AggregateTypes,
  Infrastructure,
  EventSourcedAggregatePersistence,
  Event,
} from "@noddde/core";

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

    // @ts-expect-error -- accessing private for observation
    eventBus.underlying.on("ThingHappened", eventSpy);

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
```
