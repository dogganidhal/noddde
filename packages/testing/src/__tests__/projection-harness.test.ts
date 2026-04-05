/* eslint-disable no-unused-vars */
import { describe, expect, it } from "vitest";
import type { DefineEvents, DefineQueries } from "@noddde/core";
import { defineProjection } from "@noddde/core";
import { testProjection } from "@noddde/testing";

// ---- Shared counter projection ----

type CounterEvent = DefineEvents<{
  Incremented: { amount: number };
  Decremented: { amount: number };
}>;

type CounterView = { total: number; eventCount: number };

type CounterQuery = DefineQueries<{
  GetTotal: { result: number };
}>;

type CounterProjectionDef = {
  events: CounterEvent;
  queries: CounterQuery;
  view: CounterView;
  ports: {};
};

const CounterProjection = defineProjection<CounterProjectionDef>({
  on: {
    Incremented: {
      reduce: (event, view) => ({
        total: (view?.total ?? 0) + event.payload.amount,
        eventCount: (view?.eventCount ?? 0) + 1,
      }),
    },
    Decremented: {
      reduce: (event, view) => ({
        total: (view?.total ?? 0) - event.payload.amount,
        eventCount: (view?.eventCount ?? 0) + 1,
      }),
    },
  },
  queryHandlers: {},
});

// ---- Async projection ----

type AsyncEvent = DefineEvents<{
  ItemAdded: { item: string };
}>;

type AsyncView = { items: string[] };

type AsyncProjectionDef = {
  events: AsyncEvent;
  queries: never;
  view: AsyncView;
  ports: {};
};

const AsyncProjection = defineProjection<AsyncProjectionDef>({
  on: {
    ItemAdded: {
      reduce: async (event, view) => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return {
          items: [...(view?.items ?? []), event.payload.item],
        };
      },
    },
  },
  queryHandlers: {},
});

// ---- Error projection ----

type ErrorEvent = DefineEvents<{
  Bad: { value: string };
}>;

type ErrorProjectionDef = {
  events: ErrorEvent;
  queries: never;
  view: { value: string };
  ports: {};
};

const ErrorProjection = defineProjection<ErrorProjectionDef>({
  on: {
    Bad: {
      reduce: () => {
        throw new Error("Reducer failed");
      },
    },
  },
  queryHandlers: {},
});

// ---- Partial projection (not all events handled) ----

type PartialEvent = DefineEvents<{
  Handled: { x: number };
  Unhandled: { y: number };
}>;

type PartialProjectionDef = {
  events: PartialEvent;
  queries: never;
  view: { x: number };
  ports: {};
};

const PartialProjection = defineProjection<PartialProjectionDef>({
  on: {
    Handled: {
      reduce: (event, view) => ({ x: (view?.x ?? 0) + event.payload.x }),
    },
  },
  queryHandlers: {},
});

// ---- Tests ----

describe("testProjection", () => {
  it("should apply events through reducers and return final view", async () => {
    const result = await testProjection(CounterProjection)
      .given(
        { name: "Incremented", payload: { amount: 5 } },
        { name: "Incremented", payload: { amount: 3 } },
        { name: "Decremented", payload: { amount: 2 } },
      )
      .execute();

    expect(result.view).toEqual({ total: 6, eventCount: 3 });
    expect(result.error).toBeUndefined();
  });

  it("should pass undefined as initial view when initialView not called", async () => {
    const result = await testProjection(CounterProjection)
      .given({ name: "Incremented", payload: { amount: 10 } })
      .execute();

    // Reducer uses (view?.total ?? 0) so it handles undefined
    expect(result.view).toEqual({ total: 10, eventCount: 1 });
  });

  it("should use provided initial view", async () => {
    const result = await testProjection(CounterProjection)
      .initialView({ total: 100, eventCount: 5 })
      .given({ name: "Incremented", payload: { amount: 7 } })
      .execute();

    expect(result.view).toEqual({ total: 107, eventCount: 6 });
  });

  it("should handle async reducers", async () => {
    const result = await testProjection(AsyncProjection)
      .given(
        { name: "ItemAdded", payload: { item: "apple" } },
        { name: "ItemAdded", payload: { item: "banana" } },
      )
      .execute();

    expect(result.view).toEqual({ items: ["apple", "banana"] });
  });

  it("should accumulate events from multiple given() calls", async () => {
    const result = await testProjection(CounterProjection)
      .given({ name: "Incremented", payload: { amount: 1 } })
      .given({ name: "Incremented", payload: { amount: 2 } })
      .given({ name: "Incremented", payload: { amount: 3 } })
      .execute();

    expect(result.view).toEqual({ total: 6, eventCount: 3 });
  });

  it("should capture error when reducer throws", async () => {
    const result = await testProjection(ErrorProjection)
      .given({ name: "Bad", payload: { value: "x" } })
      .execute();

    expect(result.error).toBeDefined();
    expect(result.error!.message).toBe("Reducer failed");
  });

  it("should pass full event object to reducer (not just payload)", async () => {
    // The CounterProjection reducers access event.payload.amount,
    // which proves they receive the full event object
    const result = await testProjection(CounterProjection)
      .given({ name: "Incremented", payload: { amount: 42 } })
      .execute();

    expect(result.view.total).toBe(42);
  });

  it("should return view unchanged for events with passthrough reducers", async () => {
    const result = await testProjection(PartialProjection)
      .initialView({ x: 10 })
      .given(
        { name: "Handled", payload: { x: 5 } },
        { name: "Unhandled", payload: { y: 99 } },
      )
      .execute();

    expect(result.view).toEqual({ x: 15 });
  });
});
