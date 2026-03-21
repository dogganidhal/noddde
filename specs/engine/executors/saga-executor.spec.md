---
title: "SagaExecutor"
module: engine/executors/saga-executor
source_file: packages/engine/src/executors/saga-executor.ts
status: implemented
exports: []
depends_on:
  - ddd/saga
  - edd/event
  - edd/event-metadata
  - cqrs/command/command
  - cqrs/command/command-bus
  - persistence
  - infrastructure
---

# SagaExecutor

> `SagaExecutor` executes the full saga event handling lifecycle: derive the saga instance ID from the event via associations, load the saga state, bootstrap (if the event is in `startedBy`) or ignore (if the saga has not started), execute the saga handler, persist the new saga state, and dispatch reaction commands -- all within an atomic unit of work. The saga's UoW spans both saga state persistence and all aggregate commands dispatched by the reaction, ensuring atomicity. This is an engine-internal class instantiated by `Domain` during `init()`.

## Type Contract

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import type {
  CQRSInfrastructure,
  Event,
  Infrastructure,
  Saga,
  SagaPersistence,
  UnitOfWork,
  UnitOfWorkFactory,
} from "@noddde/core";
import type { MetadataContext } from "../domain";

class SagaExecutor {
  constructor(
    infrastructure: Infrastructure & CQRSInfrastructure,
    sagaPersistence: SagaPersistence,
    unitOfWorkFactory: UnitOfWorkFactory,
    uowStorage: AsyncLocalStorage<UnitOfWork>,
    metadataStorage: AsyncLocalStorage<MetadataContext>,
  );

  execute(sagaName: string, saga: Saga<any, any>, event: Event): Promise<void>;
}
```

- `SagaExecutor` is constructed with the merged infrastructure (including CQRS buses), saga persistence, UoW factory, and `AsyncLocalStorage` instances for UoW and metadata context propagation.
- `execute` is the single public method. It processes a single event for a given saga definition, handling the full lifecycle internally.

## Behavioral Requirements

### Derive Saga Instance ID

1. **Association lookup** -- Look up the association function via `saga.associations[event.name]`. If no association function exists for this event name, return immediately (no-op). Otherwise, call the association function with the event to derive the saga instance ID.

### Load Saga State

2. **Load from persistence** -- Call `sagaPersistence.load(sagaName, sagaId)` to retrieve the current saga state.

### Bootstrap or Resume

3. **Bootstrap on startedBy event** -- If the loaded state is `null` or `undefined`:

   - If `event.name` is in `saga.startedBy`, use `saga.initialState` as the current state. This starts a new saga instance.
   - If `event.name` is not in `saga.startedBy`, return immediately (the saga has not been started yet and this event cannot start it).

4. **Resume on existing state** -- If the loaded state is non-null, use it as the current state regardless of whether the event is in `startedBy`.

### Execute Saga Handler

5. **Handler lookup and invocation** -- Look up the handler via `saga.handlers[event.name]`. If no handler exists, return immediately (no-op). Otherwise, invoke the handler with `(event, currentState, infrastructure)`. The handler returns a `SagaReaction` containing `state` (the new saga state) and optional `commands`.

### Propagate Correlation Metadata

6. **Build metadata context from triggering event** -- Construct a `MetadataContext` with:
   - `correlationId`: from `event.metadata?.correlationId`, or a new UUID v7 if not present.
   - `causationId`: from `event.metadata?.eventId`, or `event.name` if not present.
   - `userId`: from `event.metadata?.userId`.
     This ensures all commands dispatched by the saga carry the same correlation chain as the triggering event.

### Create Saga-Scoped UoW

7. **Create a new UoW** -- Call `unitOfWorkFactory()` to create a new UoW for this saga reaction. This UoW spans both the saga state persistence and any commands dispatched by the reaction.

8. **Run within UoW and metadata context** -- Use `uowStorage.run(uow, ...)` and `metadataStorage.run(sagaCtx, ...)` to make the UoW and metadata context available to all commands dispatched within the saga handler execution.

### Enlist Saga State Persistence

9. **Enlist state save** -- Call `uow.enlist(() => sagaPersistence.save(sagaName, sagaId, reaction.state))` to defer saga state persistence until UoW commit.

### Dispatch Reaction Commands

10. **Dispatch commands within UoW** -- If `reaction.commands` is defined:
    - Normalize to array: if `reaction.commands` is a single command, wrap in an array.
    - For each command, call `infrastructure.commandBus.dispatch(command)`.
    - Because the UoW is in the `AsyncLocalStorage`, aggregate command handlers invoked by the command bus will enlist their persistence on the same UoW, achieving atomicity.

### Commit Atomically

11. **Commit UoW** -- Call `uow.commit()` which executes all enlisted operations (saga state save + aggregate persistence saves) and returns the deferred events.

### Publish Deferred Events

12. **Publish events after commit** -- After successful commit, iterate over the returned events and dispatch each via `infrastructure.eventBus.dispatch(event)`. This triggers downstream projections and sagas.

### Rollback on Error

13. **Rollback on failure** -- If any step within the UoW scope throws, call `uow.rollback()` (best-effort; rollback errors are swallowed). The original error is re-thrown.

## Invariants

- The saga's UoW always spans saga state persistence and all aggregate commands dispatched by the reaction. They commit or rollback together.
- Events are published only after successful UoW commit (never before).
- The metadata context is set before any commands are dispatched, ensuring enriched events carry the saga's correlation chain.
- The `causationId` for events produced by saga-dispatched commands is the `eventId` of the triggering event (linking cause to effect).
- If `saga.associations[event.name]` is `undefined`, the event is silently ignored (no error).
- If `saga.handlers[event.name]` is `undefined`, the event is silently ignored (no error).
- If the saga has not started and the event is not in `startedBy`, the event is silently ignored.
- UoW rollback errors are swallowed; the original error is re-thrown.
- The executor creates its own UoW (not reusing an existing one). Saga reactions always have their own atomic boundary.

## Edge Cases

- **No association for event name** -- Returns immediately. No state load, no handler invocation.
- **No handler for event name** -- Returns immediately after association lookup. State may be loaded but no handler runs.
- **Saga not started and event not in startedBy** -- Returns immediately. No handler invocation, no state persistence.
- **Saga already started and receives a startedBy event** -- Uses the existing state (does not reset to `initialState`). The `startedBy` check only applies when state is `null`.
- **Reaction with no commands** -- Only saga state is persisted. No commands dispatched. UoW commits with just the state save.
- **Reaction with single command (not array)** -- Normalized to `[command]` before dispatching.
- **Reaction with multiple commands** -- Each dispatched sequentially. All aggregate changes enlist on the same UoW.
- **Command dispatch throws** -- UoW is rolled back. Saga state is not persisted. Error propagates.
- **sagaPersistence.save throws during commit** -- UoW commit fails. Error propagates after rollback attempt.
- **Triggering event has no metadata** -- `correlationId` defaults to a new UUID v7. `causationId` defaults to `event.name`. `userId` is `undefined`.
- **Triggering event has metadata** -- `correlationId`, `causationId` (from `eventId`), and `userId` are propagated.
- **Saga handler returns empty commands array** -- No commands dispatched (same as `undefined`).

## Integration Points

- **Domain** -- Constructs the `SagaExecutor` during `init()` and subscribes it to event bus events matching `saga.handlers` keys.
- **CommandBus** -- Saga dispatches commands through `infrastructure.commandBus.dispatch()`. This routes to aggregate command handlers registered by the Domain.
- **CommandLifecycleExecutor** -- When the saga dispatches commands, the command bus invokes the `CommandLifecycleExecutor`. Because the saga's UoW is in the `AsyncLocalStorage`, the executor uses the saga's UoW (explicit UoW path).
- **SagaPersistence** -- Saga state is loaded and saved via the persistence interface.
- **MetadataEnricher** -- Indirectly used: the metadata context set by the saga flows through `AsyncLocalStorage` to the `MetadataEnricher` in `CommandLifecycleExecutor`, ensuring correlation propagation.
- **EventBus** -- Events deferred by aggregate commands within the saga are published after UoW commit.

## Test Scenarios

### execute derives saga ID and runs handler for a startedBy event

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import { describe, it, expect } from "vitest";
import { defineSaga } from "@noddde/core";
import type {
  SagaTypes,
  DefineEvents,
  Infrastructure,
  CQRSInfrastructure,
  UnitOfWork,
} from "@noddde/core";
import {
  InMemoryCommandBus,
  EventEmitterEventBus,
  InMemoryQueryBus,
  InMemorySagaPersistence,
  createInMemoryUnitOfWork,
} from "@noddde/engine";
import { SagaExecutor } from "../../../executors/saga-executor";
import type { MetadataContext } from "../../../domain";

type OrderSagaState = { status: string };
type OrderSagaEvent = DefineEvents<{
  OrderPlaced: { orderId: string };
  PaymentReceived: { orderId: string };
}>;
type OrderSagaTypes = SagaTypes & {
  state: OrderSagaState;
  events: OrderSagaEvent;
  commands: never;
  infrastructure: Infrastructure & CQRSInfrastructure;
};

const OrderSaga = defineSaga<OrderSagaTypes>({
  initialState: { status: "new" },
  startedBy: ["OrderPlaced"],
  associations: {
    OrderPlaced: (event) => event.payload.orderId,
    PaymentReceived: (event) => event.payload.orderId,
  },
  handlers: {
    OrderPlaced: (event, state) => ({
      state: { status: "placed" },
    }),
    PaymentReceived: (event, state) => ({
      state: { status: "paid" },
    }),
  },
});

describe("SagaExecutor", () => {
  it("should bootstrap saga with initialState on startedBy event and persist new state", async () => {
    const sagaPersistence = new InMemorySagaPersistence();
    const infrastructure: Infrastructure & CQRSInfrastructure = {
      commandBus: new InMemoryCommandBus(),
      eventBus: new EventEmitterEventBus(),
      queryBus: new InMemoryQueryBus(),
    };
    const uowStorage = new AsyncLocalStorage<UnitOfWork>();
    const metadataStorage = new AsyncLocalStorage<MetadataContext>();

    const executor = new SagaExecutor(
      infrastructure,
      sagaPersistence,
      createInMemoryUnitOfWork,
      uowStorage,
      metadataStorage,
    );

    await executor.execute("OrderSaga", OrderSaga, {
      name: "OrderPlaced",
      payload: { orderId: "order-1" },
    });

    const state = await sagaPersistence.load("OrderSaga", "order-1");
    expect(state).toEqual({ status: "placed" });
  });
});
```

### execute ignores event when saga not started and event not in startedBy

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import { describe, it, expect } from "vitest";
import { defineSaga } from "@noddde/core";
import type {
  SagaTypes,
  DefineEvents,
  Infrastructure,
  CQRSInfrastructure,
  UnitOfWork,
} from "@noddde/core";
import {
  InMemoryCommandBus,
  EventEmitterEventBus,
  InMemoryQueryBus,
  InMemorySagaPersistence,
  createInMemoryUnitOfWork,
} from "@noddde/engine";
import { SagaExecutor } from "../../../executors/saga-executor";
import type { MetadataContext } from "../../../domain";

type MySagaState = { started: boolean };
type MySagaEvent = DefineEvents<{
  Started: { id: string };
  Continued: { id: string };
}>;
type MySagaTypes = SagaTypes & {
  state: MySagaState;
  events: MySagaEvent;
  commands: never;
  infrastructure: Infrastructure & CQRSInfrastructure;
};

const MySaga = defineSaga<MySagaTypes>({
  initialState: { started: false },
  startedBy: ["Started"],
  associations: {
    Started: (event) => event.payload.id,
    Continued: (event) => event.payload.id,
  },
  handlers: {
    Started: () => ({ state: { started: true } }),
    Continued: (event, state) => ({ state }),
  },
});

describe("SagaExecutor", () => {
  it("should ignore event when saga not started and event not in startedBy", async () => {
    const sagaPersistence = new InMemorySagaPersistence();
    const infrastructure: Infrastructure & CQRSInfrastructure = {
      commandBus: new InMemoryCommandBus(),
      eventBus: new EventEmitterEventBus(),
      queryBus: new InMemoryQueryBus(),
    };
    const uowStorage = new AsyncLocalStorage<UnitOfWork>();
    const metadataStorage = new AsyncLocalStorage<MetadataContext>();

    const executor = new SagaExecutor(
      infrastructure,
      sagaPersistence,
      createInMemoryUnitOfWork,
      uowStorage,
      metadataStorage,
    );

    // Dispatch "Continued" without prior "Started" — should be ignored
    await executor.execute("MySaga", MySaga, {
      name: "Continued",
      payload: { id: "s1" },
    });

    const state = await sagaPersistence.load("MySaga", "s1");
    expect(state).toBeUndefined();
  });
});
```

### execute returns immediately when no association exists for event name

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import { describe, it, expect, vi } from "vitest";
import { defineSaga } from "@noddde/core";
import type {
  SagaTypes,
  DefineEvents,
  Infrastructure,
  CQRSInfrastructure,
  UnitOfWork,
} from "@noddde/core";
import {
  InMemoryCommandBus,
  EventEmitterEventBus,
  InMemoryQueryBus,
  InMemorySagaPersistence,
  createInMemoryUnitOfWork,
} from "@noddde/engine";
import { SagaExecutor } from "../../../executors/saga-executor";
import type { MetadataContext } from "../../../domain";

type MinSagaState = {};
type MinSagaEvent = DefineEvents<{ Known: { id: string } }>;
type MinSagaTypes = SagaTypes & {
  state: MinSagaState;
  events: MinSagaEvent;
  commands: never;
  infrastructure: Infrastructure & CQRSInfrastructure;
};

const MinSaga = defineSaga<MinSagaTypes>({
  initialState: {},
  startedBy: ["Known"],
  associations: {
    Known: (event) => event.payload.id,
  },
  handlers: {
    Known: () => ({ state: {} }),
  },
});

describe("SagaExecutor", () => {
  it("should return immediately when no association exists for the event", async () => {
    const sagaPersistence = new InMemorySagaPersistence();
    const loadSpy = vi.spyOn(sagaPersistence, "load");
    const infrastructure: Infrastructure & CQRSInfrastructure = {
      commandBus: new InMemoryCommandBus(),
      eventBus: new EventEmitterEventBus(),
      queryBus: new InMemoryQueryBus(),
    };
    const uowStorage = new AsyncLocalStorage<UnitOfWork>();
    const metadataStorage = new AsyncLocalStorage<MetadataContext>();

    const executor = new SagaExecutor(
      infrastructure,
      sagaPersistence,
      createInMemoryUnitOfWork,
      uowStorage,
      metadataStorage,
    );

    // "Unknown" has no association in MinSaga
    await executor.execute("MinSaga", MinSaga, {
      name: "Unknown",
      payload: { id: "x" },
    });

    // Should not even load state
    expect(loadSpy).not.toHaveBeenCalled();
  });
});
```

### execute dispatches reaction commands within saga UoW

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import { describe, it, expect, vi } from "vitest";
import { defineSaga, defineAggregate } from "@noddde/core";
import type {
  SagaTypes,
  AggregateTypes,
  DefineCommands,
  DefineEvents,
  Infrastructure,
  CQRSInfrastructure,
  UnitOfWork,
  Command,
} from "@noddde/core";
import {
  InMemoryCommandBus,
  EventEmitterEventBus,
  InMemoryQueryBus,
  InMemorySagaPersistence,
  createInMemoryUnitOfWork,
} from "@noddde/engine";
import { SagaExecutor } from "../../../executors/saga-executor";
import type { MetadataContext } from "../../../domain";

type DispatchSagaState = { dispatched: boolean };
type DispatchSagaEvent = DefineEvents<{
  TriggerReceived: { id: string };
}>;
type DispatchSagaTypes = SagaTypes & {
  state: DispatchSagaState;
  events: DispatchSagaEvent;
  commands: never;
  infrastructure: Infrastructure & CQRSInfrastructure;
};

const DispatchSaga = defineSaga<DispatchSagaTypes>({
  initialState: { dispatched: false },
  startedBy: ["TriggerReceived"],
  associations: {
    TriggerReceived: (event) => event.payload.id,
  },
  handlers: {
    TriggerReceived: () => ({
      state: { dispatched: true },
      commands: {
        name: "DoSomething",
        payload: { value: 42 },
        targetAggregateId: "target-1",
      },
    }),
  },
});

describe("SagaExecutor", () => {
  it("should dispatch reaction commands through the command bus", async () => {
    const sagaPersistence = new InMemorySagaPersistence();
    const commandBus = new InMemoryCommandBus();
    const infrastructure: Infrastructure & CQRSInfrastructure = {
      commandBus,
      eventBus: new EventEmitterEventBus(),
      queryBus: new InMemoryQueryBus(),
    };
    const uowStorage = new AsyncLocalStorage<UnitOfWork>();
    const metadataStorage = new AsyncLocalStorage<MetadataContext>();

    const dispatchedCommands: Command[] = [];
    commandBus.register("DoSomething", async (command) => {
      dispatchedCommands.push(command);
    });

    const executor = new SagaExecutor(
      infrastructure,
      sagaPersistence,
      createInMemoryUnitOfWork,
      uowStorage,
      metadataStorage,
    );

    await executor.execute("DispatchSaga", DispatchSaga, {
      name: "TriggerReceived",
      payload: { id: "d1" },
    });

    expect(dispatchedCommands).toHaveLength(1);
    expect(dispatchedCommands[0]!.name).toBe("DoSomething");
    expect(dispatchedCommands[0]!.payload).toEqual({ value: 42 });

    // Saga state should also be persisted
    const state = await sagaPersistence.load("DispatchSaga", "d1");
    expect(state).toEqual({ dispatched: true });
  });
});
```

### execute propagates correlation metadata from triggering event

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import { describe, it, expect } from "vitest";
import { defineSaga } from "@noddde/core";
import type {
  SagaTypes,
  DefineEvents,
  Infrastructure,
  CQRSInfrastructure,
  UnitOfWork,
  Command,
} from "@noddde/core";
import {
  InMemoryCommandBus,
  EventEmitterEventBus,
  InMemoryQueryBus,
  InMemorySagaPersistence,
  createInMemoryUnitOfWork,
} from "@noddde/engine";
import { SagaExecutor } from "../../../executors/saga-executor";
import type { MetadataContext } from "../../../domain";

type CorrSagaState = {};
type CorrSagaEvent = DefineEvents<{ CorrEvent: { id: string } }>;
type CorrSagaTypes = SagaTypes & {
  state: CorrSagaState;
  events: CorrSagaEvent;
  commands: never;
  infrastructure: Infrastructure & CQRSInfrastructure;
};

const CorrSaga = defineSaga<CorrSagaTypes>({
  initialState: {},
  startedBy: ["CorrEvent"],
  associations: {
    CorrEvent: (event) => event.payload.id,
  },
  handlers: {
    CorrEvent: () => ({
      state: {},
      commands: {
        name: "DownstreamCmd",
        payload: {},
        targetAggregateId: "ds1",
      },
    }),
  },
});

describe("SagaExecutor", () => {
  it("should propagate correlationId and causationId from triggering event metadata", async () => {
    const sagaPersistence = new InMemorySagaPersistence();
    const commandBus = new InMemoryCommandBus();
    const metadataStorage = new AsyncLocalStorage<MetadataContext>();
    const uowStorage = new AsyncLocalStorage<UnitOfWork>();

    let capturedCtx: MetadataContext | undefined;
    commandBus.register("DownstreamCmd", async () => {
      capturedCtx = metadataStorage.getStore();
    });

    const infrastructure: Infrastructure & CQRSInfrastructure = {
      commandBus,
      eventBus: new EventEmitterEventBus(),
      queryBus: new InMemoryQueryBus(),
    };

    const executor = new SagaExecutor(
      infrastructure,
      sagaPersistence,
      createInMemoryUnitOfWork,
      uowStorage,
      metadataStorage,
    );

    await executor.execute("CorrSaga", CorrSaga, {
      name: "CorrEvent",
      payload: { id: "c1" },
      metadata: {
        eventId: "evt-123",
        timestamp: "2025-01-01T00:00:00Z",
        correlationId: "corr-abc",
        causationId: "cause-xyz",
        userId: "user-99",
      },
    });

    expect(capturedCtx).toBeDefined();
    expect(capturedCtx!.correlationId).toBe("corr-abc");
    expect(capturedCtx!.causationId).toBe("evt-123");
    expect(capturedCtx!.userId).toBe("user-99");
  });
});
```

### execute rolls back UoW when command dispatch throws

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import { describe, it, expect } from "vitest";
import { defineSaga } from "@noddde/core";
import type {
  SagaTypes,
  DefineEvents,
  Infrastructure,
  CQRSInfrastructure,
  UnitOfWork,
} from "@noddde/core";
import {
  InMemoryCommandBus,
  EventEmitterEventBus,
  InMemoryQueryBus,
  InMemorySagaPersistence,
  createInMemoryUnitOfWork,
} from "@noddde/engine";
import { SagaExecutor } from "../../../executors/saga-executor";
import type { MetadataContext } from "../../../domain";

type RbSagaState = { ran: boolean };
type RbSagaEvent = DefineEvents<{ RbTrigger: { id: string } }>;
type RbSagaTypes = SagaTypes & {
  state: RbSagaState;
  events: RbSagaEvent;
  commands: never;
  infrastructure: Infrastructure & CQRSInfrastructure;
};

const RbSaga = defineSaga<RbSagaTypes>({
  initialState: { ran: false },
  startedBy: ["RbTrigger"],
  associations: {
    RbTrigger: (event) => event.payload.id,
  },
  handlers: {
    RbTrigger: () => ({
      state: { ran: true },
      commands: {
        name: "FailingCmd",
        payload: {},
        targetAggregateId: "fail-1",
      },
    }),
  },
});

describe("SagaExecutor", () => {
  it("should rollback UoW and not persist saga state when command throws", async () => {
    const sagaPersistence = new InMemorySagaPersistence();
    const commandBus = new InMemoryCommandBus();
    commandBus.register("FailingCmd", async () => {
      throw new Error("Command failed");
    });
    const infrastructure: Infrastructure & CQRSInfrastructure = {
      commandBus,
      eventBus: new EventEmitterEventBus(),
      queryBus: new InMemoryQueryBus(),
    };
    const uowStorage = new AsyncLocalStorage<UnitOfWork>();
    const metadataStorage = new AsyncLocalStorage<MetadataContext>();

    const executor = new SagaExecutor(
      infrastructure,
      sagaPersistence,
      createInMemoryUnitOfWork,
      uowStorage,
      metadataStorage,
    );

    await expect(
      executor.execute("RbSaga", RbSaga, {
        name: "RbTrigger",
        payload: { id: "rb1" },
      }),
    ).rejects.toThrow("Command failed");

    // Saga state should NOT be persisted due to rollback
    const state = await sagaPersistence.load("RbSaga", "rb1");
    expect(state).toBeUndefined();
  });
});
```

### execute handles reaction with no commands (state-only update)

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import { describe, it, expect, vi } from "vitest";
import { defineSaga } from "@noddde/core";
import type {
  SagaTypes,
  DefineEvents,
  Infrastructure,
  CQRSInfrastructure,
  UnitOfWork,
} from "@noddde/core";
import {
  InMemoryCommandBus,
  EventEmitterEventBus,
  InMemoryQueryBus,
  InMemorySagaPersistence,
  createInMemoryUnitOfWork,
} from "@noddde/engine";
import { SagaExecutor } from "../../../executors/saga-executor";
import type { MetadataContext } from "../../../domain";

type NoCmdSagaState = { step: number };
type NoCmdSagaEvent = DefineEvents<{ StepEvent: { id: string } }>;
type NoCmdSagaTypes = SagaTypes & {
  state: NoCmdSagaState;
  events: NoCmdSagaEvent;
  commands: never;
  infrastructure: Infrastructure & CQRSInfrastructure;
};

const NoCmdSaga = defineSaga<NoCmdSagaTypes>({
  initialState: { step: 0 },
  startedBy: ["StepEvent"],
  associations: {
    StepEvent: (event) => event.payload.id,
  },
  handlers: {
    StepEvent: (event, state) => ({
      state: { step: state.step + 1 },
      // No commands
    }),
  },
});

describe("SagaExecutor", () => {
  it("should persist saga state without dispatching commands when reaction has none", async () => {
    const sagaPersistence = new InMemorySagaPersistence();
    const commandBus = new InMemoryCommandBus();
    const dispatchSpy = vi.spyOn(commandBus, "dispatch");
    const infrastructure: Infrastructure & CQRSInfrastructure = {
      commandBus,
      eventBus: new EventEmitterEventBus(),
      queryBus: new InMemoryQueryBus(),
    };
    const uowStorage = new AsyncLocalStorage<UnitOfWork>();
    const metadataStorage = new AsyncLocalStorage<MetadataContext>();

    const executor = new SagaExecutor(
      infrastructure,
      sagaPersistence,
      createInMemoryUnitOfWork,
      uowStorage,
      metadataStorage,
    );

    await executor.execute("NoCmdSaga", NoCmdSaga, {
      name: "StepEvent",
      payload: { id: "nc1" },
    });

    const state = await sagaPersistence.load("NoCmdSaga", "nc1");
    expect(state).toEqual({ step: 1 });
    expect(dispatchSpy).not.toHaveBeenCalled();
  });
});
```

### execute resumes existing saga on subsequent events

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import { describe, it, expect } from "vitest";
import { defineSaga } from "@noddde/core";
import type {
  SagaTypes,
  DefineEvents,
  Infrastructure,
  CQRSInfrastructure,
  UnitOfWork,
} from "@noddde/core";
import {
  InMemoryCommandBus,
  EventEmitterEventBus,
  InMemoryQueryBus,
  InMemorySagaPersistence,
  createInMemoryUnitOfWork,
} from "@noddde/engine";
import { SagaExecutor } from "../../../executors/saga-executor";
import type { MetadataContext } from "../../../domain";

type FlowSagaState = { steps: string[] };
type FlowSagaEvent = DefineEvents<{
  FlowStarted: { id: string };
  FlowContinued: { id: string };
}>;
type FlowSagaTypes = SagaTypes & {
  state: FlowSagaState;
  events: FlowSagaEvent;
  commands: never;
  infrastructure: Infrastructure & CQRSInfrastructure;
};

const FlowSaga = defineSaga<FlowSagaTypes>({
  initialState: { steps: [] },
  startedBy: ["FlowStarted"],
  associations: {
    FlowStarted: (event) => event.payload.id,
    FlowContinued: (event) => event.payload.id,
  },
  handlers: {
    FlowStarted: (event, state) => ({
      state: { steps: [...state.steps, "started"] },
    }),
    FlowContinued: (event, state) => ({
      state: { steps: [...state.steps, "continued"] },
    }),
  },
});

describe("SagaExecutor", () => {
  it("should resume saga from persisted state on subsequent events", async () => {
    const sagaPersistence = new InMemorySagaPersistence();
    const infrastructure: Infrastructure & CQRSInfrastructure = {
      commandBus: new InMemoryCommandBus(),
      eventBus: new EventEmitterEventBus(),
      queryBus: new InMemoryQueryBus(),
    };
    const uowStorage = new AsyncLocalStorage<UnitOfWork>();
    const metadataStorage = new AsyncLocalStorage<MetadataContext>();

    const executor = new SagaExecutor(
      infrastructure,
      sagaPersistence,
      createInMemoryUnitOfWork,
      uowStorage,
      metadataStorage,
    );

    // First event starts the saga
    await executor.execute("FlowSaga", FlowSaga, {
      name: "FlowStarted",
      payload: { id: "flow-1" },
    });

    // Second event continues the saga
    await executor.execute("FlowSaga", FlowSaga, {
      name: "FlowContinued",
      payload: { id: "flow-1" },
    });

    const state = await sagaPersistence.load("FlowSaga", "flow-1");
    expect(state).toEqual({ steps: ["started", "continued"] });
  });
});
```
