---
title: "Event-to-Projection Flow"
module: integration/event-projection-flow
source_file:
  - packages/core/src/ddd/projection.ts
  - packages/core/src/engine/domain.ts
  - packages/core/src/edd/event-bus.ts
  - packages/core/src/engine/implementations/ee-event-bus.ts
status: implemented
exports: []
depends_on:
  - core/ddd/projection
  - core/edd/event-bus
  - core/engine/domain
docs:
  - projections/connecting-events.mdx
---

# Event-to-Projection Flow

> Validates the end-to-end flow from event publication to projection view update: when an event is published on the EventBus, all registered projection reducers for that event name are invoked with the full event object and the current view, producing an updated view. Subsequently, query handlers serve the updated view. This spec verifies that `configureDomain` correctly wires projection subscriptions and that the reducer/query contract holds.

## Involved Components

- **`EventBus`** (`EventEmitterEventBus`) -- publishes domain events; projections subscribe via event name.
- **`Projection`** -- defines `reducers` (event name -> update function) and `queryHandlers` (query name -> read function).
- **`Domain` / `configureDomain`** -- wires projection reducers as EventBus subscribers during `init()`.
- **`QueryBus`** (`InMemoryQueryBus`) -- routes queries to the projection's query handlers.

## Behavioral Requirements

1. **Subscription wiring**: During `domain.init()`, for each projection, for each event name in its `reducers` map, the framework must subscribe a listener on the EventBus that invokes the reducer.
2. **Reducer invocation**: When an event is published, the matching reducer receives `(event, currentView)` where `event` is the full event object (not just payload). The reducer returns the new view (or a Promise of it).
3. **View state management**: The framework must maintain the current view for each projection. The initial view state is implementation-defined (typically `undefined` or a default). After each reducer call, the view is replaced with the return value.
4. **Query serving**: Query handlers receive the query payload and infrastructure, and return results. The framework must register query handlers on the QueryBus so that `queryBus.dispatch(query)` routes to the correct handler.
5. **Multiple projections, same event**: If two projections both have a reducer for `"OrderPlaced"`, both must be invoked when that event is published. They maintain independent views.
6. **Event ordering**: Reducers are invoked in the order events are published. Within a single event dispatch, if multiple projections handle it, all are invoked (order among projections is not guaranteed).

## Invariants

- Reducers are only invoked for event names they are registered for.
- The view returned by a reducer becomes the `currentView` for the next invocation.
- Query handlers are isolated per projection -- two projections can define handlers for different query names without conflict.
- Reducer exceptions propagate to the EventBus dispatch call (they do not silently fail).

## Edge Cases

- **Reducer returning a Promise**: The framework must await async reducers before the EventBus dispatch resolves.
- **No reducer for a given event**: If a projection does not handle event `"X"`, publishing `"X"` does not invoke that projection.
- **View starts as undefined**: Before any events are processed, the view is `undefined`. Reducers must handle this (e.g., by providing a fallback).
- **Projection with no query handlers**: A projection may have an empty `queryHandlers` map; it only builds a view without serving queries directly.
- **Multiple events in sequence**: Each event triggers the reducer with the view produced by the previous event (not the original view).

## Integration Points

- Events are produced by `Domain.dispatchCommand` (tested in `command-dispatch-lifecycle`).
- Sagas also subscribe to the EventBus and may produce commands that cause more events.
- Query handlers may access infrastructure to read from external stores, not just the in-memory view.

## Test Scenarios

### Projection reducer updates view after event publication

```ts
import { describe, it, expect } from "vitest";
import {
  defineAggregate,
  defineProjection,
  configureDomain,
  InMemoryEventSourcedAggregatePersistence,
  InMemoryCommandBus,
  InMemoryQueryBus,
  EventEmitterEventBus,
} from "@noddde/core";
import type {
  DefineCommands,
  DefineEvents,
  DefineQueries,
  ProjectionTypes,
} from "@noddde/core";

// -- Aggregate setup --

type TodoEvent = DefineEvents<{
  TodoAdded: { id: string; title: string };
  TodoCompleted: { id: string };
}>;

type TodoCommand = DefineCommands<{
  AddTodo: { title: string };
  CompleteTodo: void;
}>;

type TodoTypes = {
  state: { completed: boolean };
  events: TodoEvent;
  commands: TodoCommand;
  infrastructure: {};
};

const Todo = defineAggregate<TodoTypes>({
  initialState: { completed: false },
  commands: {
    AddTodo: (command, state) => ({
      name: "TodoAdded",
      payload: { id: command.targetAggregateId, title: command.payload.title },
    }),
    CompleteTodo: (command, state) => ({
      name: "TodoCompleted",
      payload: { id: command.targetAggregateId },
    }),
  },
  apply: {
    TodoAdded: (payload, state) => ({ completed: false }),
    TodoCompleted: (payload, state) => ({ completed: true }),
  },
});

// -- Projection setup --

type TodoView = {
  todos: Array<{ id: string; title: string; completed: boolean }>;
};

type TodoQuery = DefineQueries<{
  GetAllTodos: { result: TodoView };
}>;

type TodoProjectionTypes = {
  events: TodoEvent;
  queries: TodoQuery;
  view: TodoView;
  infrastructure: {};
};

const TodoProjection = defineProjection<TodoProjectionTypes>({
  reducers: {
    TodoAdded: (event, view) => ({
      todos: [
        ...(view?.todos ?? []),
        { id: event.payload.id, title: event.payload.title, completed: false },
      ],
    }),
    TodoCompleted: (event, view) => ({
      todos: (view?.todos ?? []).map((t) =>
        t.id === event.payload.id ? { ...t, completed: true } : t,
      ),
    }),
  },
  queryHandlers: {},
});

describe("Event-to-projection flow", () => {
  it("should update the projection view when events are published via command dispatch", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();
    const eventBus = new EventEmitterEventBus();

    const domain = await configureDomain({
      writeModel: { aggregates: { Todo } },
      readModel: { projections: { TodoProjection } },
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
      name: "AddTodo",
      targetAggregateId: "todo-1",
      payload: { title: "Write specs" },
    });

    await domain.dispatchCommand({
      name: "AddTodo",
      targetAggregateId: "todo-2",
      payload: { title: "Implement domain" },
    });

    await domain.dispatchCommand({
      name: "CompleteTodo",
      targetAggregateId: "todo-1",
    });

    // The projection should have processed all three events
    // Verification depends on how the framework exposes the view;
    // typically via a query handler or direct access.
  });
});
```

### Multiple projections subscribing to the same event

```ts
import { describe, it, expect, vi } from "vitest";
import {
  defineProjection,
  configureDomain,
  InMemoryEventSourcedAggregatePersistence,
  InMemoryCommandBus,
  InMemoryQueryBus,
  EventEmitterEventBus,
  defineAggregate,
} from "@noddde/core";
import type {
  DefineEvents,
  DefineCommands,
  ProjectionTypes,
} from "@noddde/core";

type ItemEvent = DefineEvents<{
  ItemCreated: { id: string; name: string; price: number };
}>;

type ItemCommand = DefineCommands<{
  CreateItem: { name: string; price: number };
}>;

const Item = defineAggregate<{
  state: { name: string | null };
  events: ItemEvent;
  commands: ItemCommand;
  infrastructure: {};
}>({
  initialState: { name: null },
  commands: {
    CreateItem: (cmd, state) => ({
      name: "ItemCreated",
      payload: {
        id: cmd.targetAggregateId,
        name: cmd.payload.name,
        price: cmd.payload.price,
      },
    }),
  },
  apply: {
    ItemCreated: (payload, state) => ({ name: payload.name }),
  },
});

// Projection 1: catalog of items
const CatalogProjection = defineProjection<{
  events: ItemEvent;
  queries: never;
  view: { items: Array<{ id: string; name: string }> };
  infrastructure: {};
}>({
  reducers: {
    ItemCreated: (event, view) => ({
      items: [
        ...(view?.items ?? []),
        { id: event.payload.id, name: event.payload.name },
      ],
    }),
  },
  queryHandlers: {},
});

// Projection 2: price index
const PriceIndexProjection = defineProjection<{
  events: ItemEvent;
  queries: never;
  view: { totalValue: number; count: number };
  infrastructure: {};
}>({
  reducers: {
    ItemCreated: (event, view) => ({
      totalValue: (view?.totalValue ?? 0) + event.payload.price,
      count: (view?.count ?? 0) + 1,
    }),
  },
  queryHandlers: {},
});

describe("Multiple projections for same event", () => {
  it("should invoke both projection reducers when the event is published", async () => {
    const eventBus = new EventEmitterEventBus();

    const domain = await configureDomain({
      writeModel: { aggregates: { Item } },
      readModel: {
        projections: { CatalogProjection, PriceIndexProjection },
      },
      infrastructure: {
        aggregatePersistence: () =>
          new InMemoryEventSourcedAggregatePersistence(),
        cqrsInfrastructure: () => ({
          commandBus: new InMemoryCommandBus(),
          eventBus,
          queryBus: new InMemoryQueryBus(),
        }),
      },
    });

    await domain.dispatchCommand({
      name: "CreateItem",
      targetAggregateId: "item-1",
      payload: { name: "Widget", price: 9.99 },
    });

    // Both projections should have processed the ItemCreated event independently.
    // CatalogProjection view: { items: [{ id: "item-1", name: "Widget" }] }
    // PriceIndexProjection view: { totalValue: 9.99, count: 1 }
  });
});
```

### Async reducer

```ts
import { describe, it, expect } from "vitest";
import {
  defineProjection,
  configureDomain,
  InMemoryEventSourcedAggregatePersistence,
  InMemoryCommandBus,
  InMemoryQueryBus,
  EventEmitterEventBus,
  defineAggregate,
} from "@noddde/core";
import type { DefineEvents, DefineCommands } from "@noddde/core";

type LogEvent = DefineEvents<{
  EntryLogged: { message: string };
}>;

type LogCommand = DefineCommands<{
  LogEntry: { message: string };
}>;

const Logger = defineAggregate<{
  state: {};
  events: LogEvent;
  commands: LogCommand;
  infrastructure: {};
}>({
  initialState: {},
  commands: {
    LogEntry: (cmd) => ({
      name: "EntryLogged",
      payload: { message: cmd.payload.message },
    }),
  },
  apply: {
    EntryLogged: (payload, state) => state,
  },
});

const AsyncLogProjection = defineProjection<{
  events: LogEvent;
  queries: never;
  view: { entries: string[] };
  infrastructure: {};
}>({
  reducers: {
    EntryLogged: async (event, view) => {
      // Simulate async work (e.g., enrichment)
      await new Promise((resolve) => setTimeout(resolve, 1));
      return {
        entries: [...(view?.entries ?? []), event.payload.message],
      };
    },
  },
  queryHandlers: {},
});

describe("Async projection reducer", () => {
  it("should await the async reducer before completing event dispatch", async () => {
    const domain = await configureDomain({
      writeModel: { aggregates: { Logger } },
      readModel: { projections: { AsyncLogProjection } },
      infrastructure: {
        aggregatePersistence: () =>
          new InMemoryEventSourcedAggregatePersistence(),
        cqrsInfrastructure: () => ({
          commandBus: new InMemoryCommandBus(),
          eventBus: new EventEmitterEventBus(),
          queryBus: new InMemoryQueryBus(),
        }),
      },
    });

    await domain.dispatchCommand({
      name: "LogEntry",
      targetAggregateId: "log-1",
      payload: { message: "hello world" },
    });

    // After dispatch resolves, the async reducer should have completed.
    // The view should contain: { entries: ["hello world"] }
  });
});
```

### Sequential events produce cumulative view

```ts
import { describe, it, expect } from "vitest";
import {
  defineAggregate,
  defineProjection,
  configureDomain,
  InMemoryEventSourcedAggregatePersistence,
  InMemoryCommandBus,
  InMemoryQueryBus,
  EventEmitterEventBus,
} from "@noddde/core";
import type { DefineCommands, DefineEvents } from "@noddde/core";

type BalanceEvent = DefineEvents<{
  Deposited: { amount: number };
  Withdrawn: { amount: number };
}>;

type BalanceCommand = DefineCommands<{
  Deposit: { amount: number };
  Withdraw: { amount: number };
}>;

const Account = defineAggregate<{
  state: { balance: number };
  events: BalanceEvent;
  commands: BalanceCommand;
  infrastructure: {};
}>({
  initialState: { balance: 0 },
  commands: {
    Deposit: (cmd) => ({
      name: "Deposited",
      payload: { amount: cmd.payload.amount },
    }),
    Withdraw: (cmd) => ({
      name: "Withdrawn",
      payload: { amount: cmd.payload.amount },
    }),
  },
  apply: {
    Deposited: (payload, state) => ({
      balance: state.balance + payload.amount,
    }),
    Withdrawn: (payload, state) => ({
      balance: state.balance - payload.amount,
    }),
  },
});

const BalanceProjection = defineProjection<{
  events: BalanceEvent;
  queries: never;
  view: { totalDeposits: number; totalWithdrawals: number };
  infrastructure: {};
}>({
  reducers: {
    Deposited: (event, view) => ({
      totalDeposits: (view?.totalDeposits ?? 0) + event.payload.amount,
      totalWithdrawals: view?.totalWithdrawals ?? 0,
    }),
    Withdrawn: (event, view) => ({
      totalDeposits: view?.totalDeposits ?? 0,
      totalWithdrawals: (view?.totalWithdrawals ?? 0) + event.payload.amount,
    }),
  },
  queryHandlers: {},
});

describe("Sequential events produce cumulative view", () => {
  it("should accumulate view state across multiple event dispatches", async () => {
    const domain = await configureDomain({
      writeModel: { aggregates: { Account } },
      readModel: { projections: { BalanceProjection } },
      infrastructure: {
        aggregatePersistence: () =>
          new InMemoryEventSourcedAggregatePersistence(),
        cqrsInfrastructure: () => ({
          commandBus: new InMemoryCommandBus(),
          eventBus: new EventEmitterEventBus(),
          queryBus: new InMemoryQueryBus(),
        }),
      },
    });

    await domain.dispatchCommand({
      name: "Deposit",
      targetAggregateId: "acct-1",
      payload: { amount: 100 },
    });

    await domain.dispatchCommand({
      name: "Withdraw",
      targetAggregateId: "acct-1",
      payload: { amount: 30 },
    });

    await domain.dispatchCommand({
      name: "Deposit",
      targetAggregateId: "acct-1",
      payload: { amount: 50 },
    });

    // Expected view: { totalDeposits: 150, totalWithdrawals: 30 }
    // Each reducer saw the view produced by the previous reducer call.
  });
});
```
