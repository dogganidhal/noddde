/* eslint-disable no-unused-vars */
import { describe, expect, it } from "vitest";
import type {
  DefineCommands,
  DefineEvents,
  DefineQueries,
  ViewStore,
} from "@noddde/core";
import { defineAggregate, defineProjection, defineSaga } from "@noddde/core";
import { testDomain } from "@noddde/testing";
import { InMemoryViewStore } from "@noddde/engine";

// ---- Counter aggregate ----

type CounterState = { count: number };

type CounterEvent = DefineEvents<{
  Incremented: { amount: number };
}>;

type CounterCommand = DefineCommands<{
  Increment: { amount: number };
}>;

type CounterTypes = {
  state: CounterState;
  events: CounterEvent;
  commands: CounterCommand;
  infrastructure: {};
};

const Counter = defineAggregate<CounterTypes>({
  initialState: { count: 0 },
  decide: {
    Increment: (command) => ({
      name: "Incremented",
      payload: { amount: command.payload.amount },
    }),
  },
  evolve: {
    Incremented: (payload, state) => ({ count: state.count + payload.amount }),
  },
});

// ---- Counter projection ----

type CounterViewType = { total: number };

type CounterQuery = DefineQueries<{
  GetTotal: { result: number };
}>;

type CounterProjectionDef = {
  events: CounterEvent;
  queries: CounterQuery;
  view: CounterViewType;
  infrastructure: {};
  viewStore: ViewStore<CounterViewType>;
};

/**
 * Creates a fresh CounterProjection with its own InMemoryViewStore.
 * Each call returns an isolated pair to prevent state leakage across tests.
 */
function createCounterProjection() {
  const viewStore = new InMemoryViewStore<CounterViewType>();

  const projection = defineProjection<CounterProjectionDef>({
    on: {
      Incremented: {
        id: () => "global",
        reduce: (event, view) => ({
          total: (view?.total ?? 0) + event.payload.amount,
        }),
      },
    },
    queryHandlers: {
      GetTotal: async (_payload, { views }) => {
        const view = await views.load("global");
        return view?.total ?? 0;
      },
    },
    viewStore: () => viewStore,
  });

  return { projection, viewStore };
}

// ---- Simple saga for testing command spy ----

type SagaEvent = DefineEvents<{
  OrderPlaced: { orderId: string; amount: number };
}>;

type SagaCommand = DefineCommands<{
  RequestPayment: { orderId: string; amount: number };
}>;

type SagaState = { status: string };

type TestSagaDef = {
  state: SagaState;
  events: SagaEvent;
  commands: SagaCommand;
  infrastructure: {};
};

const TestSaga = defineSaga<TestSagaDef>({
  initialState: { status: "pending" },
  startedBy: ["OrderPlaced"],
  on: {
    OrderPlaced: {
      id: (event) => event.payload.orderId,
      handle: (event) => ({
        state: { status: "payment_requested" },
        commands: {
          name: "RequestPayment",
          targetAggregateId: event.payload.orderId,
          payload: {
            orderId: event.payload.orderId,
            amount: event.payload.amount,
          },
        },
      }),
    },
  },
});

// ---- Tests ----

describe("testDomain", () => {
  it("should create a domain with aggregates and projections", async () => {
    const { projection } = createCounterProjection();
    const { domain } = await testDomain({
      aggregates: { Counter },
      projections: { CounterProjection: projection },
    });

    expect(domain).toBeDefined();
    expect(domain.infrastructure).toBeDefined();
  });

  it("should capture published events in spy", async () => {
    const { domain, spy } = await testDomain({
      aggregates: { Counter },
    });

    await domain.dispatchCommand({
      name: "Increment",
      targetAggregateId: "c-1",
      payload: { amount: 5 },
    });

    expect(spy.publishedEvents).toHaveLength(1);
    expect(spy.publishedEvents[0]).toEqual(
      expect.objectContaining({
        name: "Incremented",
        payload: { amount: 5 },
      }),
    );
  });

  it("should capture dispatched commands in spy (from saga)", async () => {
    const { domain, spy } = await testDomain({
      aggregates: {},
      sagas: { TestSaga },
    });

    // Publish event via the event bus to trigger the saga
    await domain.infrastructure.eventBus.dispatch({
      name: "OrderPlaced",
      payload: { orderId: "o-1", amount: 42 },
    });

    expect(spy.dispatchedCommands).toContainEqual({
      name: "RequestPayment",
      targetAggregateId: "o-1",
      payload: { orderId: "o-1", amount: 42 },
    });
  });

  it("should pre-wire all in-memory implementations", async () => {
    const { domain } = await testDomain({
      aggregates: { Counter },
    });

    // Should be able to dispatch commands immediately
    const id = await domain.dispatchCommand({
      name: "Increment",
      targetAggregateId: "c-1",
      payload: { amount: 1 },
    });

    expect(id).toBe("c-1");
  });

  it("should support custom infrastructure", async () => {
    type CustomInfra = { logger: { log: (msg: string) => void } };

    const logs: string[] = [];
    const { domain } = await testDomain<CustomInfra>({
      aggregates: { Counter },
      infrastructure: { logger: { log: (msg) => logs.push(msg) } },
    });

    expect(domain.infrastructure.logger).toBeDefined();
  });

  it("should work without sagas", async () => {
    const { projection } = createCounterProjection();
    const { domain, spy } = await testDomain({
      aggregates: { Counter },
      projections: { CounterProjection: projection },
    });

    await domain.dispatchCommand({
      name: "Increment",
      targetAggregateId: "c-1",
      payload: { amount: 10 },
    });

    expect(spy.publishedEvents).toHaveLength(1);
  });

  it("should work with sagas", async () => {
    const { domain, spy } = await testDomain({
      aggregates: {},
      sagas: { TestSaga },
    });

    expect(spy.dispatchedCommands).toHaveLength(0);
  });

  it("should allow immediate command dispatch after creation", async () => {
    const { domain } = await testDomain({
      aggregates: { Counter },
    });

    // No setup needed — should work immediately
    const id = await domain.dispatchCommand({
      name: "Increment",
      targetAggregateId: "immediate-1",
      payload: { amount: 7 },
    });

    expect(id).toBe("immediate-1");
  });

  it("should update projection views on command dispatch", async () => {
    const { projection, viewStore } = createCounterProjection();
    const { domain } = await testDomain({
      aggregates: { Counter },
      projections: { CounterProjection: projection },
    });

    await domain.dispatchCommand({
      name: "Increment",
      targetAggregateId: "c-1",
      payload: { amount: 5 },
    });

    await domain.dispatchCommand({
      name: "Increment",
      targetAggregateId: "c-1",
      payload: { amount: 3 },
    });

    const view = await viewStore.load("global");
    expect(view).toEqual({ total: 8 });
  });

  it("should capture multiple events in order", async () => {
    const { domain, spy } = await testDomain({
      aggregates: { Counter },
    });

    await domain.dispatchCommand({
      name: "Increment",
      targetAggregateId: "c-1",
      payload: { amount: 1 },
    });

    await domain.dispatchCommand({
      name: "Increment",
      targetAggregateId: "c-2",
      payload: { amount: 2 },
    });

    expect(spy.publishedEvents).toHaveLength(2);
    expect(spy.publishedEvents[0]!.payload.amount).toBe(1);
    expect(spy.publishedEvents[1]!.payload.amount).toBe(2);
  });
});
