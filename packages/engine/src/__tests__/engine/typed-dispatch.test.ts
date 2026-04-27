/* eslint-disable no-unused-vars */
import { describe, it, expect } from "vitest";
import { expectTypeOf } from "vitest";
import { defineDomain, wireDomain, Domain } from "../../domain";
import { InMemoryViewStoreFactory } from "../../implementations/in-memory-view-store-factory";
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
  type ViewStore,
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
  viewStore: ViewStore<ItemView>;
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
  viewStore: ViewStore<OrderView>;
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

    // Type-level check: "FooBar" is not a valid command name.
    // The @ts-expect-error must be on the `name` line since that's
    // where the type error occurs (string literal mismatch).
    const fn = () => {
      domain.dispatchCommand({
        // @ts-expect-error — "FooBar" is not a registered command
        name: "FooBar",
        targetAggregateId: "x",
        payload: {},
      });
    };
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

describe("typed dispatch - standalone commands (runtime)", () => {
  it("should dispatch standalone commands at runtime", async () => {
    // Note: standalone handler typed dispatch (autocomplete on standalone
    // command names) is not yet supported — the type system cannot extract
    // handler types from DomainDefinition<any, any, ...>. Standalone commands
    // still work at runtime; this test verifies that.
    const definition = defineDomain<
      Infrastructure,
      { name: "SendNotification"; payload: { message: string } }
    >({
      writeModel: {
        aggregates: { Counter },
        standaloneCommandHandlers: {
          SendNotification: (cmd, infra) => {},
        },
      },
      readModel: { projections: {} },
    });

    const domain = await wireDomain(definition);

    // Runtime dispatch works (no type-level autocomplete for standalone commands yet)
    await domain.dispatchCommand({
      name: "SendNotification",
      payload: { message: "hello" },
    } as any);
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
        ItemProjection: { viewStore: new InMemoryViewStoreFactory() },
      },
    });

    // Dispatching via typed query variable preserves phantom result type
    const query: ItemQuery = { name: "GetItem", payload: { id: "item-1" } };
    const item = await domain.dispatchQuery(query);

    // Result type is inferred from the query's phantom type.
    // Using assignment check (expectTypeOf can't handle phantom conditional types).
    const _typeCheck: ItemView | null = item;
  });

  it("should accept queries from registered projections with typed results", async () => {
    const definition = defineDomain({
      writeModel: { aggregates: {} },
      readModel: { projections: { ItemProjection, OrderProjection } },
    });

    const domain = await wireDomain(definition, {
      projections: {
        ItemProjection: { viewStore: new InMemoryViewStoreFactory() },
        OrderProjection: { viewStore: new InMemoryViewStoreFactory() },
      },
    });

    // Query with typed result inference
    const itemQuery: ItemQuery = {
      name: "GetItem",
      payload: { id: "item-1" },
    };
    const item = await domain.dispatchQuery(itemQuery);
    // Using assignment check (expectTypeOf can't handle phantom conditional types)
    const _typeCheck: ItemView | null = item;
  });

  it("should reject queries not in any projection or standalone handler (type-level)", async () => {
    const definition = defineDomain({
      writeModel: { aggregates: {} },
      readModel: { projections: { ItemProjection } },
    });

    const domain = await wireDomain(definition, {
      projections: {
        ItemProjection: { viewStore: new InMemoryViewStoreFactory() },
      },
    });

    // Type-level check: "NonExistent" is not a valid query name.
    const fn = () => {
      domain.dispatchQuery({
        // @ts-expect-error — "NonExistent" is not a registered query
        name: "NonExistent",
        payload: {},
      });
    };
    expect(fn).toBeDefined();
  });
});

describe("InferAggregateMapCommands", () => {
  it("should extract command union from multi-aggregate map", () => {
    const aggregates = { Counter, Todo };
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
    const projections = { ItemProjection, OrderProjection };
    type Queries = InferProjectionMapQueries<typeof projections>;

    // Should be the union of ItemQuery | OrderQuery
    expectTypeOf<Queries>().toMatchTypeOf<
      { name: "GetItem" } | { name: "GetOrder" }
    >();
  });
});
