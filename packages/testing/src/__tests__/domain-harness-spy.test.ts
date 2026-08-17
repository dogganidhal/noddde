import { describe, it, expect } from "vitest";
import type { DefineCommands, DefineEvents } from "@noddde/core";
import { defineAggregate, defineSaga } from "@noddde/core";
import { testDomain } from "@noddde/testing";

describe("testDomain command spy — unhandled commands", () => {
  it("should suppress a dispatch to a command with no registered handler and record it as unhandled", async () => {
    const { domain, spy } = await testDomain({});

    await domain.infrastructure.commandBus.dispatch({
      name: "NoSuchCommand",
      targetAggregateId: "x-1",
      payload: {},
    });

    expect(spy.dispatchedCommands).toHaveLength(1);
    expect(spy.unhandledCommands).toHaveLength(1);
    expect(spy.unhandledCommands[0]).toEqual(
      expect.objectContaining({ name: "NoSuchCommand" }),
    );
    expect(spy.commandErrors).toHaveLength(0);
  });
});

type LockedThingState = { locked: boolean };
type LockedThingEvents = DefineEvents<{ Touched: { by: string } }>;
type LockedThingCommands = DefineCommands<{ Touch: { by: string } }>;
type LockedThingTypes = {
  state: LockedThingState;
  events: LockedThingEvents;
  commands: LockedThingCommands;
  infrastructure: {};
};

const LockedThing = defineAggregate<LockedThingTypes>({
  initialState: { locked: true },
  decide: {
    Touch: (_command, state) => {
      if (state.locked) {
        throw new Error("cannot touch a locked thing");
      }
      return { name: "Touched", payload: { by: "test" } };
    },
  },
  evolve: {
    Touched: (_payload, state) => state,
  },
});

describe("testDomain command spy — thrown errors", () => {
  it("should rethrow a business-rule error from a directly-dispatched command and record it in commandErrors", async () => {
    const { domain, spy } = await testDomain({
      aggregates: { LockedThing },
    });

    await expect(
      domain.dispatchCommand({
        name: "Touch",
        targetAggregateId: "t-1",
        payload: { by: "test" },
      }),
    ).rejects.toThrow("cannot touch a locked thing");

    expect(spy.dispatchedCommands).toHaveLength(1);
    expect(spy.commandErrors).toHaveLength(1);
    expect(spy.commandErrors[0]!.error.message).toBe(
      "cannot touch a locked thing",
    );
    expect(spy.commandErrors[0]!.command).toEqual(
      expect.objectContaining({ name: "Touch" }),
    );
    expect(spy.unhandledCommands).toHaveLength(0);
  });
});

type SagaEvents = DefineEvents<{
  OrderPlaced: { orderId: string };
}>;
type SagaCommands = DefineCommands<{
  RequestPayment: { orderId: string };
}>;
type SagaTypes = {
  state: { status: string };
  events: SagaEvents;
  commands: SagaCommands;
  infrastructure: {};
};

const PaymentSaga = defineSaga<SagaTypes>({
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
          payload: { orderId: event.payload.orderId },
        },
      }),
    },
  },
});

describe("testDomain command spy — saga reaction errors", () => {
  it("should record a saga reaction command's business-rule error in commandErrors without vanishing", async () => {
    // No handler is registered for RequestPayment, so this exercises the
    // unhandled-command path even though it arrives via a saga reaction —
    // confirming the spy records it rather than silently discarding all
    // information about the failed reaction.
    const { domain, spy } = await testDomain({
      sagas: { PaymentSaga },
    });

    await domain.infrastructure.eventBus.dispatch({
      name: "OrderPlaced",
      payload: { orderId: "o-1" },
    });

    expect(spy.dispatchedCommands).toContainEqual(
      expect.objectContaining({ name: "RequestPayment" }),
    );
    expect(spy.unhandledCommands).toContainEqual(
      expect.objectContaining({ name: "RequestPayment" }),
    );
  });
});

type CounterState = { count: number };
type CounterEvent = DefineEvents<{ Incremented: { amount: number } }>;
type CounterCommand = DefineCommands<{ Increment: { amount: number } }>;
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

describe("testDomain command spy — success path", () => {
  it("should not record a successfully dispatched command as unhandled or errored", async () => {
    const { domain, spy } = await testDomain({
      aggregates: { Counter },
    });

    await domain.dispatchCommand({
      name: "Increment",
      targetAggregateId: "c-1",
      payload: { amount: 5 },
    });

    expect(spy.dispatchedCommands).toHaveLength(1);
    expect(spy.unhandledCommands).toHaveLength(0);
    expect(spy.commandErrors).toHaveLength(0);
  });
});
