/* eslint-disable no-unused-vars */
import { describe, expect, it, vi } from "vitest";
import type { DefineCommands, DefineEvents } from "@noddde/core";
import { defineSaga } from "@noddde/core";
import {
  configureDomain,
  EventEmitterEventBus,
  InMemoryCommandBus,
  InMemoryQueryBus,
  InMemorySagaPersistence,
} from "@noddde/engine";

// ---- Shared saga definitions for the two-step fulfillment scenario ----

// -- Events from the Order aggregate --
type OrderEvent = DefineEvents<{
  OrderPlaced: { orderId: string; amount: number };
  OrderFulfilled: { orderId: string };
}>;

// -- Events from the Payment aggregate --
type PaymentEvent = DefineEvents<{
  PaymentReceived: { orderId: string; paymentId: string };
}>;

// -- Commands --
type PaymentCommand = DefineCommands<{
  RequestPayment: { orderId: string; amount: number };
}>;

type OrderCommand = DefineCommands<{
  FulfillOrder: void;
}>;

// -- Saga types --
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
  associations: {
    OrderPlaced: (event) => event.payload.orderId,
    PaymentReceived: (event) => event.payload.orderId,
    OrderFulfilled: (event) => event.payload.orderId,
  },
  handlers: {
    OrderPlaced: (event, state) => ({
      state: {
        status: "awaiting_payment",
        orderId: event.payload.orderId,
      },
      commands: {
        name: "RequestPayment",
        targetAggregateId: event.payload.orderId,
        payload: {
          orderId: event.payload.orderId,
          amount: event.payload.amount,
        },
      },
    }),
    PaymentReceived: (event, state) => ({
      state: { ...state, status: "fulfilled" },
      commands: {
        name: "FulfillOrder",
        targetAggregateId: event.payload.orderId,
      },
    }),
    OrderFulfilled: (event, state) => ({
      state, // no state change, saga complete
    }),
  },
});

// ---- Test scenarios ----

describe("Saga orchestration - two-step fulfillment", () => {
  it("should create saga on OrderPlaced and dispatch RequestPayment", async () => {
    const sagaPersistence = new InMemorySagaPersistence();
    const commandBus = new InMemoryCommandBus();
    const commandDispatchSpy = vi
      .spyOn(commandBus, "dispatch")
      .mockResolvedValue(undefined);
    const eventBus = new EventEmitterEventBus();

    const domain = await configureDomain({
      writeModel: { aggregates: {} },
      readModel: { projections: {} },
      processModel: { sagas: { OrderFulfillmentSaga } },
      infrastructure: {
        sagaPersistence: () => sagaPersistence,
        cqrsInfrastructure: () => ({
          commandBus,
          eventBus,
          queryBus: new InMemoryQueryBus(),
        }),
      },
    });

    // Simulate publishing the OrderPlaced event
    await eventBus.dispatch({
      name: "OrderPlaced",
      payload: { orderId: "order-1", amount: 99.99 },
    });

    // Verify saga state was created and persisted
    const sagaState = await sagaPersistence.load(
      "OrderFulfillmentSaga",
      "order-1",
    );
    expect(sagaState).toEqual({
      status: "awaiting_payment",
      orderId: "order-1",
    });

    // Verify the command was dispatched
    expect(commandDispatchSpy).toHaveBeenCalledWith({
      name: "RequestPayment",
      targetAggregateId: "order-1",
      payload: { orderId: "order-1", amount: 99.99 },
    });
  });

  it("should transition saga state on PaymentReceived and dispatch FulfillOrder", async () => {
    const sagaPersistence = new InMemorySagaPersistence();
    const commandBus = new InMemoryCommandBus();
    const commandDispatchSpy = vi
      .spyOn(commandBus, "dispatch")
      .mockResolvedValue(undefined);
    const eventBus = new EventEmitterEventBus();

    const domain = await configureDomain({
      writeModel: { aggregates: {} },
      readModel: { projections: {} },
      processModel: { sagas: { OrderFulfillmentSaga } },
      infrastructure: {
        sagaPersistence: () => sagaPersistence,
        cqrsInfrastructure: () => ({
          commandBus,
          eventBus,
          queryBus: new InMemoryQueryBus(),
        }),
      },
    });

    // Step 1: OrderPlaced creates the saga
    await eventBus.dispatch({
      name: "OrderPlaced",
      payload: { orderId: "order-2", amount: 50 },
    });

    // Step 2: PaymentReceived transitions to fulfilled
    await eventBus.dispatch({
      name: "PaymentReceived",
      payload: { orderId: "order-2", paymentId: "pay-1" },
    });

    const sagaState = await sagaPersistence.load(
      "OrderFulfillmentSaga",
      "order-2",
    );
    expect(sagaState).toEqual({
      status: "fulfilled",
      orderId: "order-2",
    });

    // Second call should be FulfillOrder
    expect(commandDispatchSpy).toHaveBeenCalledWith({
      name: "FulfillOrder",
      targetAggregateId: "order-2",
    });
  });
});

describe("Non-starter event without existing saga instance", () => {
  it("should silently ignore the event without invoking the handler", async () => {
    const sagaPersistence = new InMemorySagaPersistence();
    const commandBus = new InMemoryCommandBus();
    const commandDispatchSpy = vi.spyOn(commandBus, "dispatch");
    const eventBus = new EventEmitterEventBus();

    const domain = await configureDomain({
      writeModel: { aggregates: {} },
      readModel: { projections: {} },
      processModel: { sagas: { OrderFulfillmentSaga } },
      infrastructure: {
        sagaPersistence: () => sagaPersistence,
        cqrsInfrastructure: () => ({
          commandBus,
          eventBus,
          queryBus: new InMemoryQueryBus(),
        }),
      },
    });

    // PaymentReceived is NOT in startedBy, and no saga instance exists
    await eventBus.dispatch({
      name: "PaymentReceived",
      payload: { orderId: "nonexistent-order", paymentId: "pay-x" },
    });

    // No saga state should have been created
    const state = await sagaPersistence.load(
      "OrderFulfillmentSaga",
      "nonexistent-order",
    );
    expect(state).toBeUndefined();

    // No commands should have been dispatched
    expect(commandDispatchSpy).not.toHaveBeenCalled();
  });
});

describe("Handler returning no commands", () => {
  type AckEvent = DefineEvents<{
    TaskStarted: { taskId: string };
    TaskAcknowledged: { taskId: string };
  }>;

  type AckSagaDef = {
    state: { acknowledged: boolean };
    events: AckEvent;
    commands: never;
    infrastructure: {};
  };

  const AckSaga = defineSaga<AckSagaDef>({
    initialState: { acknowledged: false },
    startedBy: ["TaskStarted"],
    associations: {
      TaskStarted: (event) => event.payload.taskId,
      TaskAcknowledged: (event) => event.payload.taskId,
    },
    handlers: {
      TaskStarted: (event, state) => ({
        state: { acknowledged: false },
        // no commands
      }),
      TaskAcknowledged: (event, state) => ({
        state: { acknowledged: true },
        // no commands
      }),
    },
  });

  it("should persist state without dispatching commands", async () => {
    const sagaPersistence = new InMemorySagaPersistence();
    const commandBus = new InMemoryCommandBus();
    const commandDispatchSpy = vi.spyOn(commandBus, "dispatch");
    const eventBus = new EventEmitterEventBus();

    await configureDomain({
      writeModel: { aggregates: {} },
      readModel: { projections: {} },
      processModel: { sagas: { AckSaga } },
      infrastructure: {
        sagaPersistence: () => sagaPersistence,
        cqrsInfrastructure: () => ({
          commandBus,
          eventBus,
          queryBus: new InMemoryQueryBus(),
        }),
      },
    });

    await eventBus.dispatch({
      name: "TaskStarted",
      payload: { taskId: "task-1" },
    });

    const state = await sagaPersistence.load("AckSaga", "task-1");
    expect(state).toEqual({ acknowledged: false });
    expect(commandDispatchSpy).not.toHaveBeenCalled();

    await eventBus.dispatch({
      name: "TaskAcknowledged",
      payload: { taskId: "task-1" },
    });

    const updatedState = await sagaPersistence.load("AckSaga", "task-1");
    expect(updatedState).toEqual({ acknowledged: true });
    expect(commandDispatchSpy).not.toHaveBeenCalled();
  });
});

describe("startedBy event with existing instance", () => {
  type RetryEvent = DefineEvents<{
    JobStarted: { jobId: string; attempt: number };
  }>;

  type RetrySagaDef = {
    state: { attempts: number };
    events: RetryEvent;
    commands: never;
    infrastructure: {};
  };

  const RetrySaga = defineSaga<RetrySagaDef>({
    initialState: { attempts: 0 },
    startedBy: ["JobStarted"],
    associations: {
      JobStarted: (event) => event.payload.jobId,
    },
    handlers: {
      JobStarted: (event, state) => ({
        state: { attempts: state.attempts + 1 },
      }),
    },
  });

  it("should use existing state, not reinitialize", async () => {
    const sagaPersistence = new InMemorySagaPersistence();
    const eventBus = new EventEmitterEventBus();

    await configureDomain({
      writeModel: { aggregates: {} },
      readModel: { projections: {} },
      processModel: { sagas: { RetrySaga } },
      infrastructure: {
        sagaPersistence: () => sagaPersistence,
        cqrsInfrastructure: () => ({
          commandBus: new InMemoryCommandBus(),
          eventBus,
          queryBus: new InMemoryQueryBus(),
        }),
      },
    });

    await eventBus.dispatch({
      name: "JobStarted",
      payload: { jobId: "job-1", attempt: 1 },
    });

    let state = await sagaPersistence.load("RetrySaga", "job-1");
    expect(state).toEqual({ attempts: 1 });

    // Dispatch the same startedBy event again for the same ID
    await eventBus.dispatch({
      name: "JobStarted",
      payload: { jobId: "job-1", attempt: 2 },
    });

    state = await sagaPersistence.load("RetrySaga", "job-1");
    // Should be 2, not re-initialized to 1
    expect(state).toEqual({ attempts: 2 });
  });
});
