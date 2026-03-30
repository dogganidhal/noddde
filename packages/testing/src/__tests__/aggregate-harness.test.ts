/* eslint-disable no-unused-vars */
import { describe, expect, it } from "vitest";
import type { DefineCommands, DefineEvents } from "@noddde/core";
import { defineAggregate } from "@noddde/core";
import { testAggregate, evolveAggregate } from "@noddde/testing";

// ---- Shared counter aggregate ----

type CounterState = { count: number };

type CounterEvent = DefineEvents<{
  Incremented: { amount: number };
  Decremented: { amount: number };
}>;

type CounterCommand = DefineCommands<{
  Increment: { amount: number };
  Decrement: { amount: number };
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
    Increment: (command, state) => ({
      name: "Incremented",
      payload: { amount: command.payload.amount },
    }),
    Decrement: (command, state) => {
      if (state.count - command.payload.amount < 0) {
        throw new Error("Count cannot go below zero");
      }
      return {
        name: "Decremented",
        payload: { amount: command.payload.amount },
      };
    },
  },
  evolve: {
    Incremented: (payload, state) => ({ count: state.count + payload.amount }),
    Decremented: (payload, state) => ({ count: state.count - payload.amount }),
  },
});

// ---- Async aggregate for async tests ----

type AsyncEvent = DefineEvents<{
  Done: { result: string };
}>;

type AsyncCommand = DefineCommands<{
  DoAsync: { value: string };
}>;

type AsyncTypes = {
  state: { result: string | null };
  events: AsyncEvent;
  commands: AsyncCommand;
  infrastructure: {};
};

const AsyncAggregate = defineAggregate<AsyncTypes>({
  initialState: { result: null },
  decide: {
    DoAsync: async (command) => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return {
        name: "Done" as const,
        payload: { result: command.payload.value.toUpperCase() },
      };
    },
  },
  evolve: {
    Done: (payload) => ({ result: payload.result }),
  },
});

// ---- Aggregate with infrastructure ----

type InfraEvent = DefineEvents<{
  TimestampRecorded: { timestamp: number };
}>;

type InfraCommand = DefineCommands<{
  RecordTimestamp: void;
}>;

type ClockInfra = { clock: { now: () => number } };

type InfraTypes = {
  state: { timestamp: number | null };
  events: InfraEvent;
  commands: InfraCommand;
  infrastructure: ClockInfra;
};

const InfraAggregate = defineAggregate<InfraTypes>({
  initialState: { timestamp: null },
  decide: {
    RecordTimestamp: (_command, _state, infrastructure) => ({
      name: "TimestampRecorded",
      payload: { timestamp: infrastructure.clock.now() },
    }),
  },
  evolve: {
    TimestampRecorded: (payload) => ({ timestamp: payload.timestamp }),
  },
});

// ---- Multi-event aggregate ----

type MultiEvent = DefineEvents<{
  Stepped: { step: number };
}>;

type MultiCommand = DefineCommands<{
  StepTwice: { base: number };
}>;

type MultiTypes = {
  state: { steps: number[] };
  events: MultiEvent;
  commands: MultiCommand;
  infrastructure: {};
};

const MultiAggregate = defineAggregate<MultiTypes>({
  initialState: { steps: [] },
  decide: {
    StepTwice: (command) => [
      { name: "Stepped", payload: { step: command.payload.base } },
      { name: "Stepped", payload: { step: command.payload.base + 1 } },
    ],
  },
  evolve: {
    Stepped: (payload, state) => ({ steps: [...state.steps, payload.step] }),
  },
});

// ---- Tests ----

describe("evolveAggregate", () => {
  it("should return initialState when no events are provided", () => {
    const state = evolveAggregate(Counter, []);
    expect(state).toEqual({ count: 0 });
  });

  it("should replay events through apply handlers", () => {
    const state = evolveAggregate(Counter, [
      { name: "Incremented", payload: { amount: 5 } },
      { name: "Incremented", payload: { amount: 3 } },
      { name: "Decremented", payload: { amount: 2 } },
    ]);
    expect(state).toEqual({ count: 6 });
  });

  it("should accept a custom starting state", () => {
    const state = evolveAggregate(
      Counter,
      [{ name: "Incremented", payload: { amount: 10 } }],
      { count: 100 },
    );
    expect(state).toEqual({ count: 110 });
  });

  it("should handle multiple events in order", () => {
    const state = evolveAggregate(Counter, [
      { name: "Incremented", payload: { amount: 1 } },
      { name: "Incremented", payload: { amount: 2 } },
      { name: "Incremented", payload: { amount: 3 } },
    ]);
    expect(state).toEqual({ count: 6 });
  });
});

describe("testAggregate", () => {
  it("should execute a command against initialState when no given events", async () => {
    const result = await testAggregate(Counter)
      .when({
        name: "Increment",
        targetAggregateId: "c-1",
        payload: { amount: 5 },
      })
      .execute();

    expect(result.events).toEqual([
      { name: "Incremented", payload: { amount: 5 } },
    ]);
    expect(result.state).toEqual({ count: 5 });
    expect(result.error).toBeUndefined();
  });

  it("should replay given events before executing command", async () => {
    const result = await testAggregate(Counter)
      .given(
        { name: "Incremented", payload: { amount: 10 } },
        { name: "Incremented", payload: { amount: 5 } },
      )
      .when({
        name: "Decrement",
        targetAggregateId: "c-1",
        payload: { amount: 3 },
      })
      .execute();

    expect(result.state).toEqual({ count: 12 });
    expect(result.events).toEqual([
      { name: "Decremented", payload: { amount: 3 } },
    ]);
  });

  it("should return produced events and final state", async () => {
    const result = await testAggregate(Counter)
      .when({
        name: "Increment",
        targetAggregateId: "c-1",
        payload: { amount: 42 },
      })
      .execute();

    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.name).toBe("Incremented");
    expect(result.state).toEqual({ count: 42 });
  });

  it("should handle command handler returning a single event", async () => {
    const result = await testAggregate(Counter)
      .when({
        name: "Increment",
        targetAggregateId: "c-1",
        payload: { amount: 1 },
      })
      .execute();

    expect(result.events).toHaveLength(1);
  });

  it("should handle command handler returning multiple events", async () => {
    const result = await testAggregate(MultiAggregate)
      .when({
        name: "StepTwice",
        targetAggregateId: "m-1",
        payload: { base: 10 },
      })
      .execute();

    expect(result.events).toHaveLength(2);
    expect(result.events[0]).toEqual({
      name: "Stepped",
      payload: { step: 10 },
    });
    expect(result.events[1]).toEqual({
      name: "Stepped",
      payload: { step: 11 },
    });
    expect(result.state).toEqual({ steps: [10, 11] });
  });

  it("should handle async command handler", async () => {
    const result = await testAggregate(AsyncAggregate)
      .when({
        name: "DoAsync",
        targetAggregateId: "a-1",
        payload: { value: "hello" },
      })
      .execute();

    expect(result.events).toEqual([
      { name: "Done", payload: { result: "HELLO" } },
    ]);
    expect(result.state).toEqual({ result: "HELLO" });
  });

  it("should capture error when command handler throws", async () => {
    const result = await testAggregate(Counter)
      .when({
        name: "Decrement",
        targetAggregateId: "c-1",
        payload: { amount: 5 },
      })
      .execute();

    expect(result.error).toBeDefined();
    expect(result.error!.message).toContain("cannot go below zero");
    expect(result.events).toEqual([]);
    expect(result.state).toEqual({ count: 0 });
  });

  it("should inject infrastructure into command handler", async () => {
    const result = await testAggregate(InfraAggregate)
      .when({
        name: "RecordTimestamp",
        targetAggregateId: "i-1",
      })
      .withInfrastructure({ clock: { now: () => 1234567890 } })
      .execute();

    expect(result.events).toEqual([
      { name: "TimestampRecorded", payload: { timestamp: 1234567890 } },
    ]);
    expect(result.state).toEqual({ timestamp: 1234567890 });
  });

  it("should accumulate events from multiple given() calls", async () => {
    const result = await testAggregate(Counter)
      .given({ name: "Incremented", payload: { amount: 10 } })
      .given({ name: "Incremented", payload: { amount: 20 } })
      .when({
        name: "Increment",
        targetAggregateId: "c-1",
        payload: { amount: 5 },
      })
      .execute();

    expect(result.state).toEqual({ count: 35 });
  });
});
