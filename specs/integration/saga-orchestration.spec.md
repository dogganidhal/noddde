---
title: "Saga Orchestration"
module: integration/saga-orchestration
source_file:
  - packages/core/src/ddd/saga.ts
  - packages/core/src/engine/domain.ts
  - packages/core/src/engine/implementations/in-memory-saga-persistence.ts
  - packages/core/src/edd/event-bus.ts
  - packages/core/src/cqrs/command/command-bus.ts
status: ready
exports: []
depends_on:
  - core/ddd/saga
  - core/engine/domain
  - core/engine/implementations/in-memory-saga-persistence
  - core/edd/event-bus
  - core/cqrs/command/command-bus
---

# Saga Orchestration

> Validates the full saga orchestration lifecycle: when a domain event is published on the EventBus, the framework uses the saga's `associations` map to extract the saga instance ID from the event, loads the saga state from persistence, invokes the matching handler with `(event, state, infrastructure & CQRSInfrastructure)`, persists the new saga state, and dispatches any returned commands via the CommandBus. This spec covers saga creation via `startedBy` events, state transitions across multiple events, and command dispatch.

## Involved Components

- **`Saga`** -- defines `initialState`, `startedBy`, `associations`, and `handlers`.
- **`SagaPersistence`** (`InMemorySagaPersistence`) -- loads/saves saga instance state by `(sagaName, sagaId)`.
- **`EventBus`** (`EventEmitterEventBus`) -- sagas subscribe to events by name during `domain.init()`.
- **`CommandBus`** -- receives commands returned by saga handlers.
- **`Domain` / `configureDomain`** -- wires saga event subscriptions during initialization.

## Behavioral Requirements

1. **Subscription wiring**: During `domain.init()`, for each saga, for each event name in its `handlers` map, the framework subscribes a listener on the EventBus.
2. **Association resolution**: When an event arrives, the framework calls `saga.associations[event.name](event)` to extract the saga instance ID.
3. **State loading**: The framework calls `sagaPersistence.load(sagaName, sagaId)` to retrieve the current saga state.
4. **Saga creation (`startedBy`)**: If the event name is in `saga.startedBy` AND no saga state exists (load returns `undefined`/`null`), a new saga instance is created with `saga.initialState`.
5. **Non-starter event with no instance**: If the event name is NOT in `saga.startedBy` AND no saga state exists, the event is silently ignored (no handler invocation, no error).
6. **Handler invocation**: The matching handler is invoked with `(event, state, infrastructure)` where `infrastructure` includes both custom infrastructure and CQRS buses. It returns `{ state, commands? }`.
7. **State persistence**: After the handler returns, the new `state` from the reaction is saved via `sagaPersistence.save(sagaName, sagaId, newState)`.
8. **Command dispatch**: If the reaction includes `commands`, each command is dispatched via `commandBus.dispatch(command)`. A single command or an array of commands may be returned.
9. **No commands**: If `commands` is `undefined` or omitted, no commands are dispatched. The saga state is still persisted.

## Invariants

- The saga's `initialState` is never mutated.
- Saga state changes are persisted before commands are dispatched (to avoid dispatching commands for a state transition that was not durably recorded).
- Each saga instance is independent -- two instances of the same saga with different IDs maintain separate state.
- Events not handled by the saga (no entry in `handlers`) are ignored.
- The `associations` map must have an entry for every event in `handlers`.

## Edge Cases

- **`startedBy` event creates a new instance**: When an event in `startedBy` arrives and no saga instance exists, `initialState` is used and the handler is invoked.
- **`startedBy` event for an existing instance**: When an event in `startedBy` arrives but a saga instance already exists, the existing state is used (no re-initialization).
- **Non-`startedBy` event with no instance**: The event is silently dropped.
- **Handler returns no commands**: Only state is persisted; no CommandBus interaction.
- **Handler returns a single command (not array)**: The framework normalizes to dispatch it.
- **Handler returns multiple commands**: All commands are dispatched in order.
- **Multiple sagas reacting to the same event**: Each saga independently loads state, invokes its handler, persists state, and dispatches commands.

## Integration Points

- Events are produced by `Domain.dispatchCommand` (tested in `command-dispatch-lifecycle`).
- Commands dispatched by sagas re-enter the command dispatch lifecycle, potentially producing more events (creating feedback loops in complex workflows).
- Saga infrastructure includes CQRS buses, so handlers can also dispatch queries if needed.

## Test Scenarios

### Two-step saga: OrderPlaced triggers payment, PaymentReceived completes

```ts
import { describe, it, expect, vi } from "vitest";
import {
  defineSaga,
  defineAggregate,
  configureDomain,
  InMemoryEventSourcedAggregatePersistence,
  InMemorySagaPersistence,
  InMemoryCommandBus,
  InMemoryQueryBus,
  EventEmitterEventBus,
} from "@noddde/core";
import type { DefineCommands, DefineEvents, SagaTypes } from "@noddde/core";

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

describe("Saga orchestration - two-step fulfillment", () => {
  it("should create saga on OrderPlaced and dispatch RequestPayment", async () => {
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
```

### Non-startedBy event with no existing instance is ignored

```ts
import { describe, it, expect, vi } from "vitest";
import {
  defineSaga,
  configureDomain,
  InMemorySagaPersistence,
  InMemoryCommandBus,
  InMemoryQueryBus,
  EventEmitterEventBus,
} from "@noddde/core";

// Reuse OrderFulfillmentSaga from above

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
```

### Handler returning no commands only persists state

```ts
import { describe, it, expect, vi } from "vitest";
import {
  defineSaga,
  configureDomain,
  InMemorySagaPersistence,
  InMemoryCommandBus,
  InMemoryQueryBus,
  EventEmitterEventBus,
} from "@noddde/core";
import type { DefineEvents, SagaTypes } from "@noddde/core";

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

describe("Handler returning no commands", () => {
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
```

### startedBy event for an already-existing instance uses existing state

```ts
import { describe, it, expect } from "vitest";
import {
  defineSaga,
  configureDomain,
  InMemorySagaPersistence,
  InMemoryCommandBus,
  InMemoryQueryBus,
  EventEmitterEventBus,
} from "@noddde/core";
import type { DefineEvents } from "@noddde/core";

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

describe("startedBy event with existing instance", () => {
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
```
