/* eslint-disable no-unused-vars */
import { describe, it, expect } from "vitest";
import { expectTypeOf } from "vitest";
import {
  defineDomain,
  wireDomain,
  Domain,
  InMemoryViewStore,
} from "@noddde/engine";
import {
  defineAggregate,
  defineProjection,
  type AggregateTypes,
  type Command,
  type DefineCommands,
  type DefineEvents,
  type DefineQueries,
  type ProjectionTypes,
  type Infrastructure,
  type InferAggregateMapCommands,
  type InferProjectionMapQueries,
  type QueryResult,
} from "@noddde/core";

// ===== Shared test fixtures =====

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

type TodoState = { done: boolean };
type TodoEvent = DefineEvents<{ TodoCreated: { title: string } }>;
type TodoCommand = DefineCommands<{ CreateTodo: { title: string } }>;
type TodoTypes = AggregateTypes & {
  state: TodoState;
  events: TodoEvent;
  commands: TodoCommand;
  infrastructure: Infrastructure;
};

const Todo = defineAggregate<TodoTypes>({
  initialState: { done: false },
  decide: {
    CreateTodo: (cmd) => ({
      name: "TodoCreated",
      payload: { title: cmd.payload.title },
    }),
  },
  evolve: {
    TodoCreated: () => ({ done: false }),
  },
});

type ItemEvent = DefineEvents<{ ItemAdded: { id: string; name: string } }>;
type ItemView = { id: string; name: string };
type ItemQuery = DefineQueries<{
  GetItem: { payload: { id: string }; result: ItemView | null };
}>;
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
      reduce: (event) => ({ id: event.payload.id, name: event.payload.name }),
    },
  },
  queryHandlers: {
    GetItem: (payload, { views }) => views.load(payload.id),
  },
  initialView: { id: "", name: "" },
});

type OrderEvent = DefineEvents<{
  OrderPlaced: { orderId: string; total: number };
}>;
type OrderView = { orderId: string; total: number };
type OrderQuery = DefineQueries<{
  GetOrder: { payload: { orderId: string }; result: OrderView | null };
}>;
type OrderProjectionTypes = ProjectionTypes & {
  events: OrderEvent;
  queries: OrderQuery;
  view: OrderView;
  infrastructure: Infrastructure;
};

const OrderProjection = defineProjection<OrderProjectionTypes>({
  on: {
    OrderPlaced: {
      id: (event) => event.payload.orderId,
      reduce: (event) => ({
        orderId: event.payload.orderId,
        total: event.payload.total,
      }),
    },
  },
  queryHandlers: {
    GetOrder: (payload, { views }) => views.load(payload.orderId),
  },
  initialView: { orderId: "", total: 0 },
});

// ===== Tests =====

describe("typed dispatch - aggregate commands", () => {
  it("should accept commands from registered aggregates", async () => {
    const definition = defineDomain({
      writeModel: { aggregates: { Counter, Todo } },
      readModel: { projections: { ItemProjection } },
    });

    const domain = await wireDomain(definition);

    // These should compile — valid aggregate commands
    await domain.dispatchCommand({
      name: "Increment",
      targetAggregateId: "c-1",
      payload: { by: 5 },
    });
    await domain.dispatchCommand({
      name: "CreateTodo",
      targetAggregateId: "t-1",
      payload: { title: "Test" },
    });
  });

  it("should reject commands not in any aggregate (type-level)", async () => {
    const definition = defineDomain({
      writeModel: { aggregates: { Counter } },
      readModel: { projections: {} },
    });

    const domain = await wireDomain(definition);

    // Type-level check only: the @ts-expect-error below should
    // trigger a TS error once dispatchCommand is narrowed to
    // only accept registered commands. Currently this is a
    // no-op at runtime — the assertion is compile-time only.
    const fn = () => {
      // @ts-expect-error — "FooBar" is not a registered command
      domain.dispatchCommand({
        name: "FooBar",
        targetAggregateId: "x",
        payload: {},
      });
    };
    // We don't call fn() — the check is purely type-level
    expect(fn).toBeDefined();
  });

  it("should return targetAggregateId for aggregate commands", async () => {
    const definition = defineDomain({
      writeModel: { aggregates: { Counter } },
      readModel: { projections: {} },
    });

    const domain = await wireDomain(definition);

    const result = await domain.dispatchCommand({
      name: "Increment",
      targetAggregateId: "c-1",
      payload: { by: 1 },
    });

    expectTypeOf(result).toEqualTypeOf<string>();
  });
});

describe("typed dispatch - standalone commands", () => {
  type NotifyCommand = {
    name: "SendNotification";
    payload: { message: string };
  };

  it("should accept standalone commands from registered handlers", async () => {
    const definition = defineDomain<Infrastructure, NotifyCommand>({
      writeModel: {
        aggregates: { Counter },
        standaloneCommandHandlers: {
          SendNotification: (cmd, infra) => {},
        },
      },
      readModel: { projections: {} },
    });

    const domain = await wireDomain(definition);

    // Standalone command — should compile
    await domain.dispatchCommand({
      name: "SendNotification",
      payload: { message: "hello" },
    });

    // Aggregate command — should also compile
    await domain.dispatchCommand({
      name: "Increment",
      targetAggregateId: "c-1",
      payload: { by: 1 },
    });
  });

  it("should return void for standalone commands", async () => {
    const definition = defineDomain<Infrastructure, NotifyCommand>({
      writeModel: {
        aggregates: {},
        standaloneCommandHandlers: {
          SendNotification: (cmd, infra) => {},
        },
      },
      readModel: { projections: {} },
    });

    const domain = await wireDomain(definition);

    const result = await domain.dispatchCommand({
      name: "SendNotification",
      payload: { message: "hello" },
    });

    expectTypeOf(result).toEqualTypeOf<void>();
  });
});

describe("typed dispatch - queries", () => {
  it("should accept queries from registered projections", async () => {
    const definition = defineDomain({
      writeModel: { aggregates: {} },
      readModel: { projections: { ItemProjection } },
    });

    const domain = await wireDomain(definition, {
      projections: {
        ItemProjection: { viewStore: () => new InMemoryViewStore() },
      },
    });

    // Should compile — valid projection query
    const item = await domain.dispatchQuery({
      name: "GetItem",
      payload: { id: "item-1" },
    });

    // Result type should be inferred
    expectTypeOf(item).toEqualTypeOf<ItemView | null>();
  });

  it("should accept standalone queries from registered handlers", async () => {
    type HealthQuery = DefineQueries<{
      GetHealth: { payload: void; result: { status: string } };
    }>;

    const definition = defineDomain<Infrastructure, never, HealthQuery>({
      writeModel: { aggregates: {} },
      readModel: {
        projections: { ItemProjection },
        standaloneQueryHandlers: {
          GetHealth: (_payload) => ({ status: "ok" }),
        },
      },
    });

    const domain = await wireDomain(definition, {
      projections: {
        ItemProjection: { viewStore: () => new InMemoryViewStore() },
      },
    });

    // Standalone query — should compile
    const health = await domain.dispatchQuery({
      name: "GetHealth",
    });
    expectTypeOf(health).toEqualTypeOf<{ status: string }>();

    // Projection query — should also compile
    const item = await domain.dispatchQuery({
      name: "GetItem",
      payload: { id: "item-1" },
    });
    expectTypeOf(item).toEqualTypeOf<ItemView | null>();
  });

  it("should reject queries not in any projection or standalone handler (type-level)", async () => {
    const definition = defineDomain({
      writeModel: { aggregates: {} },
      readModel: { projections: { ItemProjection } },
    });

    const domain = await wireDomain(definition, {
      projections: {
        ItemProjection: { viewStore: () => new InMemoryViewStore() },
      },
    });

    // Type-level check only
    const fn = () => {
      // @ts-expect-error — "NonExistent" is not a registered query
      domain.dispatchQuery({
        name: "NonExistent",
        payload: {},
      });
    };
    expect(fn).toBeDefined();
  });
});

describe("InferAggregateMapCommands", () => {
  it("should extract command union from multi-aggregate map", () => {
    const aggregates = { Counter, Todo } as const;
    type Commands = InferAggregateMapCommands<typeof aggregates>;

    // Should be the union of CounterCommand | TodoCommand
    expectTypeOf<Commands>().toMatchTypeOf<
      | {
          name: "Increment";
          targetAggregateId: string;
          payload: { by: number };
        }
      | {
          name: "CreateTodo";
          targetAggregateId: string;
          payload: { title: string };
        }
    >();
  });
});

describe("InferProjectionMapQueries", () => {
  it("should extract query union from multi-projection map", () => {
    const projections = { ItemProjection, OrderProjection } as const;
    type Queries = InferProjectionMapQueries<typeof projections>;

    // Should be the union of ItemQuery | OrderQuery
    expectTypeOf<Queries>().toMatchTypeOf<
      { name: "GetItem" } | { name: "GetOrder" }
    >();
  });
});
