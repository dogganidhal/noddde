/* eslint-disable no-unused-vars */
import { describe, expect, it, vi } from "vitest";
import type { DefineCommands, DefineEvents } from "@noddde/core";
import { defineSaga } from "@noddde/core";
import { testSaga } from "@noddde/testing";

// ---- Two-step fulfillment saga ----

type OrderEvent = DefineEvents<{
  OrderPlaced: { orderId: string; amount: number };
  OrderFulfilled: { orderId: string };
}>;

type PaymentEvent = DefineEvents<{
  PaymentReceived: { orderId: string; paymentId: string };
}>;

type PaymentCommand = DefineCommands<{
  RequestPayment: { orderId: string; amount: number };
}>;

type OrderCommand = DefineCommands<{
  FulfillOrder: void;
}>;

type FulfillmentState = {
  status: "pending" | "awaiting_payment" | "fulfilled";
  orderId: string | null;
};

type FulfillmentSagaDef = {
  state: FulfillmentState;
  events: OrderEvent | PaymentEvent;
  commands: PaymentCommand | OrderCommand;
  infrastructure: {};
};

const OrderFulfillmentSaga = defineSaga<FulfillmentSagaDef>({
  initialState: { status: "pending", orderId: null },
  startedBy: ["OrderPlaced"],
  on: {
    OrderPlaced: {
      id: (event) => event.payload.orderId,
      handle: (event, state) => ({
        state: { status: "awaiting_payment", orderId: event.payload.orderId },
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
    PaymentReceived: {
      id: (event) => event.payload.orderId,
      handle: (event, state) => ({
        state: { ...state, status: "fulfilled" },
        commands: {
          name: "FulfillOrder",
          targetAggregateId: event.payload.orderId,
        },
      }),
    },
    OrderFulfilled: {
      id: (event) => event.payload.orderId,
      handle: (_event, state) => ({
        state, // no state change
      }),
    },
  },
});

// ---- Saga with infrastructure ----

type NotifyEvent = DefineEvents<{
  TaskCompleted: { taskId: string; message: string };
}>;

type NotifySagaDef = {
  state: { notified: boolean };
  events: NotifyEvent;
  commands: never;
  infrastructure: { notifier: { send: (msg: string) => Promise<void> } };
};

const NotifySaga = defineSaga<NotifySagaDef>({
  initialState: { notified: false },
  startedBy: ["TaskCompleted"],
  on: {
    TaskCompleted: {
      id: (event) => event.payload.taskId,
      handle: async (event, state, infrastructure) => {
        await infrastructure.notifier.send(event.payload.message);
        return { state: { notified: true } };
      },
    },
  },
});

// ---- Saga that throws ----

type ErrorEvent = DefineEvents<{
  BadEvent: { value: string };
}>;

type ErrorSagaDef = {
  state: { ok: boolean };
  events: ErrorEvent;
  commands: never;
  infrastructure: {};
};

const ErrorSaga = defineSaga<ErrorSagaDef>({
  initialState: { ok: true },
  startedBy: ["BadEvent"],
  on: {
    BadEvent: {
      id: (event) => event.payload.value,
      handle: () => {
        throw new Error("Saga handler failed");
      },
    },
  },
});

// ---- Async saga ----

type AsyncEvent = DefineEvents<{
  SlowEvent: { id: string };
}>;

type AsyncSagaDef = {
  state: { processed: boolean };
  events: AsyncEvent;
  commands: never;
  infrastructure: {};
};

const AsyncSaga = defineSaga<AsyncSagaDef>({
  initialState: { processed: false },
  startedBy: ["SlowEvent"],
  on: {
    SlowEvent: {
      id: (event) => event.payload.id,
      handle: async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return { state: { processed: true } };
      },
    },
  },
});

// ---- Tests ----

describe("testSaga", () => {
  it("should process event against initialState when no givenState", async () => {
    const result = await testSaga(OrderFulfillmentSaga)
      .when({
        name: "OrderPlaced",
        payload: { orderId: "o-1", amount: 99.99 },
      })
      .execute();

    expect(result.state).toEqual({
      status: "awaiting_payment",
      orderId: "o-1",
    });
    expect(result.error).toBeUndefined();
  });

  it("should process event against provided state", async () => {
    const result = await testSaga(OrderFulfillmentSaga)
      .givenState({ status: "awaiting_payment", orderId: "o-1" })
      .when({
        name: "PaymentReceived",
        payload: { orderId: "o-1", paymentId: "p-1" },
      })
      .execute();

    expect(result.state).toEqual({
      status: "fulfilled",
      orderId: "o-1",
    });
  });

  it("should return new state and commands from reaction", async () => {
    const result = await testSaga(OrderFulfillmentSaga)
      .when({
        name: "OrderPlaced",
        payload: { orderId: "o-1", amount: 50 },
      })
      .execute();

    expect(result.commands).toEqual([
      {
        name: "RequestPayment",
        targetAggregateId: "o-1",
        payload: { orderId: "o-1", amount: 50 },
      },
    ]);
  });

  it("should normalize single command to array", async () => {
    const result = await testSaga(OrderFulfillmentSaga)
      .givenState({ status: "awaiting_payment", orderId: "o-2" })
      .when({
        name: "PaymentReceived",
        payload: { orderId: "o-2", paymentId: "p-2" },
      })
      .execute();

    expect(Array.isArray(result.commands)).toBe(true);
    expect(result.commands).toHaveLength(1);
    expect(result.commands[0]!.name).toBe("FulfillOrder");
  });

  it("should return empty commands array when handler returns no commands", async () => {
    const result = await testSaga(OrderFulfillmentSaga)
      .givenState({ status: "fulfilled", orderId: "o-3" })
      .when({
        name: "OrderFulfilled",
        payload: { orderId: "o-3" },
      })
      .execute();

    expect(result.commands).toEqual([]);
  });

  it("should provide no-op CQRSInfrastructure automatically", async () => {
    // This test just verifies the handler can execute without
    // manually providing commandBus/eventBus/queryBus
    const result = await testSaga(OrderFulfillmentSaga)
      .when({
        name: "OrderPlaced",
        payload: { orderId: "o-4", amount: 10 },
      })
      .execute();

    expect(result.error).toBeUndefined();
    expect(result.state.status).toBe("awaiting_payment");
  });

  it("should merge custom infrastructure with CQRS infrastructure", async () => {
    const mockNotifier = { send: vi.fn().mockResolvedValue(undefined) };

    const result = await testSaga(NotifySaga)
      .when({
        name: "TaskCompleted",
        payload: { taskId: "t-1", message: "Done!" },
      })
      .withInfrastructure({ notifier: mockNotifier })
      .execute();

    expect(result.state).toEqual({ notified: true });
    expect(mockNotifier.send).toHaveBeenCalledWith("Done!");
  });

  it("should allow overriding CQRS infrastructure", async () => {
    const mockDispatch = vi.fn().mockResolvedValue(undefined);

    const result = await testSaga(OrderFulfillmentSaga)
      .when({
        name: "OrderPlaced",
        payload: { orderId: "o-5", amount: 25 },
      })
      .withCQRSInfrastructure({
        commandBus: { dispatch: mockDispatch },
      })
      .execute();

    // The saga handler returns commands in the reaction, not via bus
    // But the overridden bus is available if the handler accesses it
    expect(result.error).toBeUndefined();
  });

  it("should handle async saga handler", async () => {
    const result = await testSaga(AsyncSaga)
      .when({ name: "SlowEvent", payload: { id: "s-1" } })
      .execute();

    expect(result.state).toEqual({ processed: true });
    expect(result.error).toBeUndefined();
  });

  it("should capture error when handler throws", async () => {
    const result = await testSaga(ErrorSaga)
      .when({ name: "BadEvent", payload: { value: "x" } })
      .execute();

    expect(result.error).toBeDefined();
    expect(result.error!.message).toBe("Saga handler failed");
    expect(result.commands).toEqual([]);
    expect(result.state).toEqual({ ok: true });
  });
});
