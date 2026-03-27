/* eslint-disable no-unused-vars */
import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  Command,
  CQRSInfrastructure,
  DefineCommands,
  DefineEvents,
  InferSagaCommands,
  InferSagaEvents,
  InferSagaId,
  InferSagaInfrastructure,
  InferSagaState,
  Infrastructure,
  Saga,
  SagaEventHandler,
  SagaReaction,
} from "@noddde/core";
import { defineSaga } from "@noddde/core";

describe("defineSaga", () => {
  type OrderEvent = DefineEvents<{
    OrderPlaced: { orderId: string; total: number };
    PaymentReceived: { orderId: string; amount: number };
  }>;

  type PaymentCommand = DefineCommands<{
    RequestPayment: { orderId: string; amount: number };
    ConfirmOrder: void;
  }>;

  type FulfillmentState = {
    status: "pending" | "awaiting_payment" | "paid";
    orderId: string | null;
  };

  type FulfillmentTypes = {
    state: FulfillmentState;
    events: OrderEvent;
    commands: PaymentCommand;
    infrastructure: Infrastructure;
  };

  const saga = defineSaga<FulfillmentTypes>({
    initialState: { status: "pending", orderId: null },
    startedBy: ["OrderPlaced"],
    on: {
      OrderPlaced: {
        id: (event) => event.payload.orderId,
        handle: (event, state) => ({
          state: {
            ...state,
            status: "awaiting_payment",
            orderId: event.payload.orderId,
          },
          commands: {
            name: "RequestPayment",
            targetAggregateId: event.payload.orderId,
            payload: {
              orderId: event.payload.orderId,
              amount: event.payload.total,
            },
          },
        }),
      },
      PaymentReceived: {
        id: (event) => event.payload.orderId,
        handle: (_event, state) => ({
          state: { ...state, status: "paid" },
          commands: {
            name: "ConfirmOrder",
            targetAggregateId: state.orderId!,
          },
        }),
      },
    },
  });

  it("should return a saga with typed initialState", () => {
    expectTypeOf(saga.initialState).toEqualTypeOf<FulfillmentState>();
  });

  it("should have startedBy as a non-empty array", () => {
    expect(saga.startedBy.length).toBeGreaterThanOrEqual(1);
    expect(saga.startedBy).toContain("OrderPlaced");
  });

  it("should have typed on entry id functions", () => {
    expectTypeOf(saga.on.OrderPlaced!.id).toBeFunction();
    expectTypeOf(saga.on.PaymentReceived!.id).toBeFunction();
  });

  it("should have typed on entry handle functions", () => {
    expectTypeOf(saga.on.OrderPlaced!.handle).toBeFunction();
    expectTypeOf(saga.on.PaymentReceived!.handle).toBeFunction();
  });
});

describe("SagaReaction", () => {
  type MyState = { step: number };
  type MyCommand = Command & { name: "DoSomething" };

  it("should require state field", () => {
    const reaction: SagaReaction<MyState, MyCommand> = { state: { step: 1 } };
    expectTypeOf(reaction.state).toEqualTypeOf<MyState>();
  });

  it("should allow commands as single command", () => {
    const reaction: SagaReaction<MyState, MyCommand> = {
      state: { step: 1 },
      commands: { name: "DoSomething" },
    };
    expectTypeOf(reaction.commands).toEqualTypeOf<
      MyCommand | MyCommand[] | undefined
    >();
  });

  it("should allow commands as array", () => {
    const reaction: SagaReaction<MyState, MyCommand> = {
      state: { step: 1 },
      commands: [{ name: "DoSomething" }, { name: "DoSomething" }],
    };
    expectTypeOf(reaction.commands).toEqualTypeOf<
      MyCommand | MyCommand[] | undefined
    >();
  });

  it("should allow omitting commands", () => {
    const reaction: SagaReaction<MyState, MyCommand> = { state: { step: 2 } };
    expectTypeOf(reaction).toMatchTypeOf<SagaReaction<MyState, MyCommand>>();
  });
});

describe("SagaEventHandler", () => {
  type MyEvent = DefineEvents<{ OrderPlaced: { orderId: string } }>;
  type OrderPlacedEvent = Extract<MyEvent, { name: "OrderPlaced" }>;
  type MyState = { started: boolean };
  type MyCommand = Command & { name: "ProcessOrder" };

  interface MyInfra extends Infrastructure {
    logger: { log(msg: string): void };
  }

  type Handler = SagaEventHandler<
    OrderPlacedEvent,
    MyState,
    MyCommand,
    MyInfra
  >;

  it("should receive full event as first parameter", () => {
    expectTypeOf<Parameters<Handler>[0]>().toEqualTypeOf<OrderPlacedEvent>();
  });

  it("should receive state as second parameter", () => {
    expectTypeOf<Parameters<Handler>[1]>().toEqualTypeOf<MyState>();
  });

  it("should receive infrastructure merged with CQRSInfrastructure", () => {
    expectTypeOf<Parameters<Handler>[2]>().toEqualTypeOf<
      MyInfra & CQRSInfrastructure
    >();
  });

  it("should return SagaReaction or Promise of it", () => {
    expectTypeOf<ReturnType<Handler>>().toEqualTypeOf<
      | SagaReaction<MyState, MyCommand>
      | Promise<SagaReaction<MyState, MyCommand>>
    >();
  });
});

describe("Saga on map", () => {
  type Events = DefineEvents<{
    TaskCreated: { taskId: string; projectId: string };
    TaskCompleted: { taskId: string };
  }>;

  type Cmds = Command & { name: "NotifyOwner" };

  type Types = {
    state: { complete: boolean };
    events: Events;
    commands: Cmds;
    infrastructure: Infrastructure;
  };

  const saga = defineSaga<Types>({
    initialState: { complete: false },
    startedBy: ["TaskCreated"],
    on: {
      TaskCreated: {
        id: (event) => event.payload.taskId,
        handle: (_event, state) => ({ state }),
      },
      TaskCompleted: {
        id: (event) => event.payload.taskId,
        handle: (_event, state) => ({
          state: { ...state, complete: true },
          commands: { name: "NotifyOwner" },
        }),
      },
    },
  });

  it("should extract saga ID from events via on entry", () => {
    const id = saga.on.TaskCreated!.id({
      name: "TaskCreated",
      payload: { taskId: "t-1", projectId: "p-1" },
    });
    expect(id).toBe("t-1");
  });
});

describe("Saga startedBy non-empty tuple", () => {
  it("should require at least one event name", () => {
    // The type [T, ...T[]] enforces at least one element.
    // An empty array [] would not satisfy this type.
    type StartedByType = Saga["startedBy"];
    expectTypeOf<StartedByType>().toMatchTypeOf<[string, ...string[]]>();
  });
});

describe("Saga Infer utilities", () => {
  type MyState = { step: number };
  type MyEvent = DefineEvents<{ StepCompleted: { stepId: number } }>;
  type MyCommand = Command & { name: "NextStep" };

  interface MyInfra extends Infrastructure {
    timer: { delay(ms: number): Promise<void> };
  }

  type Types = {
    state: MyState;
    events: MyEvent;
    commands: MyCommand;
    infrastructure: MyInfra;
  };

  const saga = defineSaga<Types>({
    initialState: { step: 0 },
    startedBy: ["StepCompleted"],
    on: {
      StepCompleted: {
        id: (event) => String(event.payload.stepId),
        handle: (event, state) => ({
          state: { step: event.payload.stepId + 1 },
          commands: { name: "NextStep" },
        }),
      },
    },
  });

  it("should infer state type", () => {
    expectTypeOf<InferSagaState<typeof saga>>().toEqualTypeOf<MyState>();
  });

  it("should infer events type", () => {
    expectTypeOf<InferSagaEvents<typeof saga>>().toEqualTypeOf<MyEvent>();
  });

  it("should infer commands type", () => {
    expectTypeOf<InferSagaCommands<typeof saga>>().toEqualTypeOf<MyCommand>();
  });

  it("should infer infrastructure type", () => {
    expectTypeOf<
      InferSagaInfrastructure<typeof saga>
    >().toEqualTypeOf<MyInfra>();
  });

  it("should infer saga ID type (defaults to string)", () => {
    expectTypeOf<InferSagaId<typeof saga>>().toBeString();
  });
});

describe("Saga with custom ID type", () => {
  type Events = DefineEvents<{ Started: { id: number } }>;
  type Cmds = Command & { name: "Continue" };
  type Types = {
    state: {};
    events: Events;
    commands: Cmds;
    infrastructure: Infrastructure;
  };

  const saga = defineSaga<Types, number>({
    initialState: {},
    startedBy: ["Started"],
    on: {
      Started: {
        id: (event) => event.payload.id,
        handle: (_event, state) => ({ state }),
      },
    },
  });

  it("should use number as saga ID type", () => {
    expectTypeOf<InferSagaId<typeof saga>>().toBeNumber();
  });

  it("should type on entry id return as number", () => {
    const id = saga.on.Started!.id({
      name: "Started",
      payload: { id: 42 },
    });
    expectTypeOf(id).toBeNumber();
  });
});

describe("defineSaga identity", () => {
  type E = DefineEvents<{ X: { v: number } }>;
  type C = Command & { name: "Y" };
  type T = {
    state: {};
    events: E;
    commands: C;
    infrastructure: Infrastructure;
  };

  it("should return the exact same config object", () => {
    const config = {
      initialState: {},
      startedBy: ["X" as const],
      on: {
        X: {
          id: (e: any) => String(e.payload.v),
          handle: (_e: any, s: any) => ({ state: s }),
        },
      },
    };
    const result = defineSaga<T>(config as any);
    expect(result).toBe(config);
  });
});
