import { AsyncLocalStorage } from "node:async_hooks";
import { describe, it, expect, vi } from "vitest";
import { defineSaga } from "@noddde/core";
import type {
  SagaTypes,
  DefineEvents,
  Event,
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

// ============================================================
// Helper to create infrastructure + executor for each test
// ============================================================

function createTestSetup(overrides?: {
  commandBus?: InMemoryCommandBus;
  eventBus?: EventEmitterEventBus;
}) {
  const sagaPersistence = new InMemorySagaPersistence();
  const commandBus = overrides?.commandBus ?? new InMemoryCommandBus();
  const eventBus = overrides?.eventBus ?? new EventEmitterEventBus();
  const infrastructure: Infrastructure & CQRSInfrastructure = {
    commandBus,
    eventBus,
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

  return {
    executor,
    sagaPersistence,
    commandBus,
    eventBus,
    infrastructure,
    uowStorage,
    metadataStorage,
  };
}

// ============================================================
// Saga definitions used across tests
// ============================================================

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
  on: {
    OrderPlaced: {
      id: (event) => event.payload.orderId,
      handle: (event, state) => ({
        state: { status: "placed" },
      }),
    },
    PaymentReceived: {
      id: (event) => event.payload.orderId,
      handle: (event, state) => ({
        state: { status: "paid" },
      }),
    },
  },
});

describe("SagaExecutor", () => {
  // ============================================================
  // Bootstrap on startedBy event
  // ============================================================

  it("should bootstrap saga with initialState on startedBy event and persist new state", async () => {
    const { executor, sagaPersistence } = createTestSetup();

    await executor.execute("OrderSaga", OrderSaga, {
      name: "OrderPlaced",
      payload: { orderId: "order-1" },
    });

    const state = await sagaPersistence.load("OrderSaga", "order-1");
    expect(state).toEqual({ status: "placed" });
  });

  // ============================================================
  // Ignore event when saga not started
  // ============================================================

  it("should ignore event when saga not started and event not in startedBy", async () => {
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
      on: {
        Started: {
          id: (event) => event.payload.id,
          handle: () => ({ state: { started: true } }),
        },
        Continued: {
          id: (event) => event.payload.id,
          handle: (event, state) => ({ state }),
        },
      },
    });

    const { executor, sagaPersistence } = createTestSetup();

    // Dispatch "Continued" without prior "Started" -- should be ignored
    await executor.execute("MySaga", MySaga, {
      name: "Continued",
      payload: { id: "s1" },
    });

    const state = await sagaPersistence.load("MySaga", "s1");
    expect(state).toBeUndefined();
  });

  // ============================================================
  // No association for event
  // ============================================================

  it("should return immediately when no association exists for the event", async () => {
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
      on: {
        Known: {
          id: (event) => event.payload.id,
          handle: () => ({ state: {} }),
        },
      },
    });

    const { executor, sagaPersistence } = createTestSetup();
    const loadSpy = vi.spyOn(sagaPersistence, "load");

    // "Unknown" has no association in MinSaga
    await executor.execute("MinSaga", MinSaga, {
      name: "Unknown",
      payload: { id: "x" },
    });

    // Should not even load state
    expect(loadSpy).not.toHaveBeenCalled();
  });

  // ============================================================
  // Dispatch reaction commands
  // ============================================================

  it("should dispatch reaction commands through the command bus", async () => {
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
      on: {
        TriggerReceived: {
          id: (event) => event.payload.id,
          handle: () => ({
            state: { dispatched: true },
            commands: {
              name: "DoSomething",
              payload: { value: 42 },
              targetAggregateId: "target-1",
            },
          }),
        },
      },
    });

    const commandBus = new InMemoryCommandBus();
    const dispatchedCommands: Command[] = [];
    commandBus.register("DoSomething", async (command) => {
      dispatchedCommands.push(command);
    });

    const { executor, sagaPersistence } = createTestSetup({ commandBus });

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

  // ============================================================
  // Correlation metadata propagation
  // ============================================================

  it("should propagate correlationId and causationId from triggering event metadata", async () => {
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
      on: {
        CorrEvent: {
          id: (event) => event.payload.id,
          handle: () => ({
            state: {},
            commands: {
              name: "DownstreamCmd",
              payload: {},
              targetAggregateId: "ds1",
            },
          }),
        },
      },
    });

    const commandBus = new InMemoryCommandBus();
    const metadataStorage = new AsyncLocalStorage<MetadataContext>();

    let capturedCtx: MetadataContext | undefined;
    commandBus.register("DownstreamCmd", async () => {
      capturedCtx = metadataStorage.getStore();
    });

    const sagaPersistence = new InMemorySagaPersistence();
    const infrastructure: Infrastructure & CQRSInfrastructure = {
      commandBus,
      eventBus: new EventEmitterEventBus(),
      queryBus: new InMemoryQueryBus(),
    };
    const uowStorage = new AsyncLocalStorage<UnitOfWork>();

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

  // ============================================================
  // Rollback on command failure
  // ============================================================

  it("should rollback UoW and not persist saga state when command throws", async () => {
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
      on: {
        RbTrigger: {
          id: (event) => event.payload.id,
          handle: () => ({
            state: { ran: true },
            commands: {
              name: "FailingCmd",
              payload: {},
              targetAggregateId: "fail-1",
            },
          }),
        },
      },
    });

    const commandBus = new InMemoryCommandBus();
    commandBus.register("FailingCmd", async () => {
      throw new Error("Command failed");
    });

    const { executor, sagaPersistence } = createTestSetup({ commandBus });

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

  // ============================================================
  // State-only reaction (no commands)
  // ============================================================

  it("should persist saga state without dispatching commands when reaction has none", async () => {
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
      on: {
        StepEvent: {
          id: (event) => event.payload.id,
          handle: (event, state) => ({
            state: { step: state.step + 1 },
            // No commands
          }),
        },
      },
    });

    const commandBus = new InMemoryCommandBus();
    const dispatchSpy = vi.spyOn(commandBus, "dispatch");
    const { executor, sagaPersistence } = createTestSetup({ commandBus });

    await executor.execute("NoCmdSaga", NoCmdSaga, {
      name: "StepEvent",
      payload: { id: "nc1" },
    });

    const state = await sagaPersistence.load("NoCmdSaga", "nc1");
    expect(state).toEqual({ step: 1 });
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  // ============================================================
  // Resume existing saga on subsequent events
  // ============================================================

  it("should resume saga from persisted state on subsequent events", async () => {
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
      on: {
        FlowStarted: {
          id: (event) => event.payload.id,
          handle: (event, state) => ({
            state: { steps: [...state.steps, "started"] },
          }),
        },
        FlowContinued: {
          id: (event) => event.payload.id,
          handle: (event, state) => ({
            state: { steps: [...state.steps, "continued"] },
          }),
        },
      },
    });

    const { executor, sagaPersistence } = createTestSetup();

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

type BeRbState = { ran: boolean };
type BeRbEvent = DefineEvents<{ BeRbTrigger: { id: string } }>;
type BeRbTypes = SagaTypes & {
  state: BeRbState;
  events: BeRbEvent;
  commands: never;
  infrastructure: Infrastructure & CQRSInfrastructure;
};

const BeRbSaga = defineSaga<BeRbTypes>({
  atomicity: "best-effort",
  initialState: { ran: false },
  startedBy: ["BeRbTrigger"],
  on: {
    BeRbTrigger: {
      id: (event) => event.payload.id,
      handle: () => ({
        state: { ran: true },
        commands: {
          name: "FailingCmd",
          payload: {},
          targetAggregateId: "fail-be",
        },
      }),
    },
  },
});

describe("SagaExecutor best-effort", () => {
  it("should persist saga state even when a command throws", async () => {
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
      executor.execute("BeRbSaga", BeRbSaga, {
        name: "BeRbTrigger",
        payload: { id: "be1" },
      }),
    ).rejects.toThrow("Command failed");

    // Saga state IS persisted — committed before the command ran.
    const state = await sagaPersistence.load("BeRbSaga", "be1");
    expect(state).toEqual({ ran: true });
  });
});

type OrderingState = { phase: string };
type OrderingEvent = DefineEvents<{ Begin: { id: string } }>;
type OrderingTypes = SagaTypes & {
  state: OrderingState;
  events: OrderingEvent;
  commands: never;
  infrastructure: Infrastructure & CQRSInfrastructure;
};

const OrderingSaga = defineSaga<OrderingTypes>({
  atomicity: "best-effort",
  initialState: { phase: "init" },
  startedBy: ["Begin"],
  on: {
    Begin: {
      id: (event) => event.payload.id,
      handle: () => ({
        state: { phase: "committed" },
        commands: { name: "Probe", payload: {}, targetAggregateId: "p1" },
      }),
    },
  },
});

describe("SagaExecutor best-effort (commit ordering)", () => {
  it("should have committed saga state by the time the command handler runs", async () => {
    const sagaPersistence = new InMemorySagaPersistence();
    const commandBus = new InMemoryCommandBus();
    const uowStorage = new AsyncLocalStorage<UnitOfWork>();
    const metadataStorage = new AsyncLocalStorage<MetadataContext>();

    let stateSeenByCommand: unknown;
    commandBus.register("Probe", async () => {
      stateSeenByCommand = await sagaPersistence.load("OrderingSaga", "o1");
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

    await executor.execute("OrderingSaga", OrderingSaga, {
      name: "Begin",
      payload: { id: "o1" },
    });

    // The command handler observed the already-committed saga state.
    expect(stateSeenByCommand).toEqual({ phase: "committed" });
  });
});

type TaskState = { step: "initial" | "processing" | "done" };
type TaskEvent = DefineEvents<{
  StartTask: { taskId: string };
  ProcessCompleted: { taskId: string };
}>;
type TaskTypes = SagaTypes & {
  state: TaskState;
  events: TaskEvent;
  commands: never;
  infrastructure: Infrastructure & CQRSInfrastructure;
};

const BestEffortTaskSaga = defineSaga<TaskTypes>({
  atomicity: "best-effort",
  initialState: { step: "initial" },
  startedBy: ["StartTask"],
  on: {
    StartTask: {
      id: (event) => event.payload.taskId,
      handle: (event) => ({
        state: { step: "processing" },
        commands: {
          name: "ProcessTask",
          payload: { taskId: event.payload.taskId },
          targetAggregateId: event.payload.taskId,
        },
      }),
    },
    ProcessCompleted: {
      id: (event) => event.payload.taskId,
      handle: (_event, state) => ({
        state: { ...state, step: "done" },
      }),
    },
  },
});

describe("SagaExecutor best-effort (issue #119)", () => {
  it("should resume the saga when a command handler dispatches a consumed event", async () => {
    const sagaPersistence = new InMemorySagaPersistence();
    const commandBus = new InMemoryCommandBus();
    const eventBus = new EventEmitterEventBus();
    const uowStorage = new AsyncLocalStorage<UnitOfWork>();
    const metadataStorage = new AsyncLocalStorage<MetadataContext>();

    const infrastructure: Infrastructure & CQRSInfrastructure = {
      commandBus,
      eventBus,
      queryBus: new InMemoryQueryBus(),
    };

    const executor = new SagaExecutor(
      infrastructure,
      sagaPersistence,
      createInMemoryUnitOfWork,
      uowStorage,
      metadataStorage,
    );

    // Wire the executor to the event bus exactly as Domain does (eventBus.on).
    for (const eventName of Object.keys(BestEffortTaskSaga.on)) {
      eventBus.on(eventName, (event: Event) =>
        executor.execute("TaskSaga", BestEffortTaskSaga, event),
      );
    }

    // Standalone-style command handler: publishes an event directly (off-path).
    commandBus.register("ProcessTask", async (command) => {
      await eventBus.dispatch({
        name: "ProcessCompleted",
        payload: { taskId: (command.payload as { taskId: string }).taskId },
      });
    });

    await executor.execute("TaskSaga", BestEffortTaskSaga, {
      name: "StartTask",
      payload: { taskId: "t-1" },
    });

    const state = await sagaPersistence.load("TaskSaga", "t-1");
    expect(state).toEqual({ step: "done" });
  });
});

type AtomicTaskState = { step: "initial" | "processing" | "done" };
type AtomicTaskEvent = DefineEvents<{
  StartTask: { taskId: string };
  ProcessCompleted: { taskId: string };
}>;
type AtomicTaskTypes = SagaTypes & {
  state: AtomicTaskState;
  events: AtomicTaskEvent;
  commands: never;
  infrastructure: Infrastructure & CQRSInfrastructure;
};

const AtomicTaskSaga = defineSaga<AtomicTaskTypes>({
  atomicity: "atomic",
  initialState: { step: "initial" },
  startedBy: ["StartTask"],
  on: {
    StartTask: {
      id: (event) => event.payload.taskId,
      handle: (event) => ({
        state: { step: "processing" },
        commands: {
          name: "ProcessTask",
          payload: { taskId: event.payload.taskId },
          targetAggregateId: event.payload.taskId,
        },
      }),
    },
    ProcessCompleted: {
      id: (event) => event.payload.taskId,
      handle: (_event, state) => ({
        state: { ...state, step: "done" },
      }),
    },
  },
});

describe("SagaExecutor atomic (issue #119 limitation)", () => {
  it("should drop a command-handler-dispatched event (saga stays at processing)", async () => {
    const sagaPersistence = new InMemorySagaPersistence();
    const commandBus = new InMemoryCommandBus();
    const eventBus = new EventEmitterEventBus();
    const uowStorage = new AsyncLocalStorage<UnitOfWork>();
    const metadataStorage = new AsyncLocalStorage<MetadataContext>();

    const infrastructure: Infrastructure & CQRSInfrastructure = {
      commandBus,
      eventBus,
      queryBus: new InMemoryQueryBus(),
    };

    const executor = new SagaExecutor(
      infrastructure,
      sagaPersistence,
      createInMemoryUnitOfWork,
      uowStorage,
      metadataStorage,
    );

    for (const eventName of Object.keys(AtomicTaskSaga.on)) {
      eventBus.on(eventName, (event: Event) =>
        executor.execute("AtomicTaskSaga", AtomicTaskSaga, event),
      );
    }

    commandBus.register("ProcessTask", async (command) => {
      await eventBus.dispatch({
        name: "ProcessCompleted",
        payload: { taskId: (command.payload as { taskId: string }).taskId },
      });
    });

    await executor.execute("AtomicTaskSaga", AtomicTaskSaga, {
      name: "StartTask",
      payload: { taskId: "t-2" },
    });

    // The re-entrant ProcessCompleted arrived before commit → dropped.
    const state = await sagaPersistence.load("AtomicTaskSaga", "t-2");
    expect(state).toEqual({ step: "processing" });
  });
});
