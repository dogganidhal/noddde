/* eslint-disable no-unused-vars */
import { describe, expect, it } from "vitest";
import type { DefineCommands, DefineEvents, DefineQueries } from "@noddde/core";
import {
  configureDomain,
  defineAggregate,
  defineProjection,
  EventEmitterEventBus,
  InMemoryCommandBus,
  InMemoryEventSourcedAggregatePersistence,
  InMemoryQueryBus,
} from "@noddde/core";

// ---- Scenario 1: Projection reducer updates view after event publication ----

describe("Event-to-projection flow", () => {
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
        payload: {
          id: command.targetAggregateId,
          title: command.payload.title,
        },
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
          {
            id: event.payload.id,
            title: event.payload.title,
            completed: false,
          },
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
    const view = domain.getProjectionView<TodoView>("TodoProjection");
    expect(view).toBeDefined();
    expect(view!.todos).toHaveLength(2);
    expect(view!.todos[0]).toEqual({
      id: "todo-1",
      title: "Write specs",
      completed: true,
    });
    expect(view!.todos[1]).toEqual({
      id: "todo-2",
      title: "Implement domain",
      completed: false,
    });
  });
});

// ---- Scenario 2: Multiple projections subscribing to the same event ----

describe("Multiple projections for same event", () => {
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
    const catalogView = domain.getProjectionView<{
      items: Array<{ id: string; name: string }>;
    }>("CatalogProjection");
    expect(catalogView).toEqual({
      items: [{ id: "item-1", name: "Widget" }],
    });

    const priceView = domain.getProjectionView<{
      totalValue: number;
      count: number;
    }>("PriceIndexProjection");
    expect(priceView).toEqual({ totalValue: 9.99, count: 1 });
  });
});

// ---- Scenario 3: Async reducer ----

describe("Async projection reducer", () => {
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
    const view = domain.getProjectionView<{ entries: string[] }>(
      "AsyncLogProjection",
    );
    expect(view).toEqual({ entries: ["hello world"] });
  });
});

// ---- Scenario 4: Sequential events produce cumulative view ----

describe("Sequential events produce cumulative view", () => {
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
    const view = domain.getProjectionView<{
      totalDeposits: number;
      totalWithdrawals: number;
    }>("BalanceProjection");
    expect(view).toEqual({ totalDeposits: 150, totalWithdrawals: 30 });
  });
});
