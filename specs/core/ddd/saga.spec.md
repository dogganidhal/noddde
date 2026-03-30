---
title: "SagaTypes, SagaReaction, SagaEventHandler, SagaOnEntry, Saga, defineSaga & Infer Utilities"
module: ddd/saga
source_file: packages/core/src/ddd/saga.ts
status: implemented
exports:
  [
    SagaTypes,
    SagaReaction,
    SagaEventHandler,
    SagaOnEntry,
    Saga,
    defineSaga,
    InferSagaState,
    InferSagaEvents,
    InferSagaCommands,
    InferSagaInfrastructure,
    InferSagaId,
    InferSagaEventHandler,
    InferSagaOnEntry,
  ]
depends_on: [id, edd/event, cqrs/command/command, infrastructure/index]
docs:
  - sagas/overview.mdx
  - sagas/defining-sagas.mdx
  - sagas/testing-sagas.mdx
---

# SagaTypes, SagaReaction, SagaEventHandler, SagaOnEntry, Saga, defineSaga & Infer Utilities

> Sagas (process managers) are the structural inverse of aggregates: where aggregates receive commands and emit events, sagas receive events and emit commands. This module provides the complete saga definition pattern: `SagaTypes` bundles the type parameters, `SagaReaction` is the handler return type, `SagaEventHandler` implements the react phase, `SagaOnEntry` bundles identity extraction and handler per event, `Saga` is the definition interface with a unified `on` map, `defineSaga` provides type inference, and five `Infer*` utilities extract individual types.

## Type Contract

- **`SagaTypes`** is a type with four required fields:

  - `state: any` -- the saga's internal state tracking workflow progress.
  - `events: Event` -- discriminated union of events this saga reacts to.
  - `commands: Command` -- discriminated union of commands this saga may dispatch.
  - `infrastructure: Infrastructure` -- external dependencies for event handlers.

- **`SagaReaction<TState, TCommands>`** is an object type:

  - `state: TState` -- the updated saga state.
  - `commands?: TCommands | TCommands[]` -- optional command(s) to dispatch.

- **`SagaEventHandler<TEvent, TState, TCommands, TInfrastructure>`** is a function type:

  - Parameters: `(event: TEvent, state: TState, infrastructure: TInfrastructure & CQRSInfrastructure & FrameworkInfrastructure)`.
  - Return: `SagaReaction<TState, TCommands> | Promise<SagaReaction<TState, TCommands>>`.
  - Receives the FULL event (not just payload), like projection reducers.
  - Infrastructure is merged with `CQRSInfrastructure` and `FrameworkInfrastructure` via intersection (providing bus access and logger).

- **`SagaOnEntry<TEvent, TState, TCommands, TInfrastructure, TSagaId>`** is an object type that bundles identity extraction and handler for one event:

  - `id: (event: TEvent) => TSagaId` -- extracts the saga instance ID from the event. Required.
  - `handle: SagaEventHandler<TEvent, TState, TCommands, TInfrastructure>` -- the saga event handler.

- **`Saga<T extends SagaTypes, TSagaId extends ID = string>`** is an interface with three fields:

  - `initialState: T["state"]` -- zero-value state for new saga instances.
  - `startedBy: [T["events"]["name"], ...T["events"]["name"][]]` -- non-empty tuple of event names that start the saga.
  - `on: SagaOnMap<T, TSagaId>` -- partial map of event names to `SagaOnEntry` objects. Only events the saga handles need entries.

- **Internal type `SagaOnMap<T, TSagaId>`** -- maps each event name (optionally) to a `SagaOnEntry`. Partial over the event union.

- **`defineSaga<T, TSagaId extends ID>(config): Saga<T, TSagaId>`** -- identity function for type inference.

- **Infer utilities** (operate on `Saga` definition instances):
  - `InferSagaState<T extends Saga>` = inferred `U["state"]`.
  - `InferSagaEvents<T extends Saga>` = inferred `U["events"]`.
  - `InferSagaCommands<T extends Saga>` = inferred `U["commands"]`.
  - `InferSagaInfrastructure<T extends Saga>` = inferred `U["infrastructure"]`.
  - `InferSagaId<T extends Saga>` = inferred `TSagaId`.

- **Handler-level inference utilities** (operate on `SagaTypes` bundle, for typing extracted handlers in separate files):

  - `InferSagaEventHandler<T extends SagaTypes, K extends T["events"]["name"]>` = `SagaEventHandler<Extract<T["events"], { name: K }>, T["state"], T["commands"], T["infrastructure"]>`. Resolves to the exact saga event handler function type for event `K`, with the event narrowed via `Extract`, and infrastructure merged with `CQRSInfrastructure` and `FrameworkInfrastructure` (via `SagaEventHandler`).

  - `InferSagaOnEntry<T extends SagaTypes, K extends T["events"]["name"], TSagaId extends ID = string>` = `SagaOnEntry<Extract<T["events"], { name: K }>, T["state"], T["commands"], T["infrastructure"], TSagaId>`. Resolves to the full `{ id, handle }` bundle for event `K`, with a customizable saga ID type.

## Behavioral Requirements

- Saga event handlers receive the FULL event object (with narrowed type), the current saga state, and infrastructure merged with CQRS buses and framework infrastructure (logger).
- Handlers return a `SagaReaction` containing the new state and optional commands to dispatch.
- `startedBy` must be a non-empty array (tuple with at least one element). This is enforced by the tuple type `[T, ...T[]]`.
- The `on` map is partial -- only events the saga handles need entries. Unhandled events are silently ignored at runtime.
- Each `on` entry bundles an `id` function (extracts saga instance ID) and a `handle` function (processes the event).
- The `id` function in each `on` entry is required -- sagas always need routing to a specific instance.
- Commands in `SagaReaction` are optional -- a handler may only update state without dispatching.
- Commands can be a single command or an array of commands.
- `defineSaga` is an identity function returning the same config object.
- `TSagaId` is bounded by `ID`, defaults to `string`, and can be customized (e.g., `number`, `bigint`, branded type).
- `InferSagaEventHandler<T, K>` resolves to a function receiving the narrowed event (via `Extract<T["events"], { name: K }>`), the saga state, and infrastructure merged with `CQRSInfrastructure` and `FrameworkInfrastructure`, returning `SagaReaction` or `Promise<SagaReaction>`.
- `InferSagaOnEntry<T, K, TSagaId>` resolves to an object with `id: (event) => TSagaId` and `handle: InferSagaEventHandler<T, K>`.
- Both `InferSagaEventHandler` and `InferSagaOnEntry` operate on the `SagaTypes` bundle (not the `Saga` definition instance), enabling use before `defineSaga` is called.

## Invariants

- `on` map keys are a subset of event names from the saga's event union.
- Each `on` entry has both `id` (required) and `handle` (required) fields.
- `startedBy` has at least one element (non-empty tuple).
- `startedBy` elements must be valid event names from the saga's event union.
- `SagaReaction.commands` is optional; when omitted, no commands are dispatched.
- Infrastructure parameter in handlers always includes `CQRSInfrastructure` and `FrameworkInfrastructure` via `&`.
- `defineSaga` returns the exact same object reference.
- `SagaTypes["commands"]` is constrained to `Command` (not `AggregateCommand`), allowing sagas to dispatch both aggregate and standalone commands.
- `InferSagaEventHandler<T, K>` always produces the same type as the `handle` field of `SagaOnMap<T>[K]`.
- `InferSagaOnEntry<T, K, TSagaId>` always produces the same type as `SagaOnMap<T, TSagaId>[K]`.

## Edge Cases

- **Saga that only updates state**: Handlers return `{ state: newState }` without `commands`.
- **Saga with single event**: `startedBy` and `on` both have one key.
- **Multiple starting events**: `startedBy: ["OrderPlaced", "OrderImported"]` is valid.
- **Async handlers**: Returning `Promise<SagaReaction<...>>` is valid.
- **Custom saga ID type**: `TSagaId = number` or a branded string type.
- **Commands as array**: `commands: [cmd1, cmd2]` dispatches multiple commands.
- **Partial on map**: Only a subset of event types need entries in `on`.

## Integration Points

- The engine/runtime subscribes sagas to the `EventBus` by iterating `Object.keys(saga.on)`, uses `on[eventName].id` to look up saga instance IDs, loads or creates saga state, invokes `on[eventName].handle`, persists new state, and dispatches resulting commands via `CommandBus`.
- `startedBy` tells the runtime which events should create new saga instances.
- Sagas bridge between bounded contexts by reacting to events from one context and dispatching commands to another.
- `InferSaga*` utilities are used downstream for persistence, testing, and engine configuration.

## Test Scenarios

### defineSaga with complete configuration

```ts
import { describe, it, expectTypeOf, expect } from "vitest";
import type {
  DefineEvents,
  DefineCommands,
  Infrastructure,
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
```

### SagaReaction with and without commands

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { SagaReaction, Command } from "@noddde/core";

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
```

### SagaEventHandler receives full event and merged infrastructure

```ts
import { describe, it, expectTypeOf } from "vitest";
import type {
  SagaEventHandler,
  SagaReaction,
  DefineEvents,
  Command,
  Infrastructure,
  CQRSInfrastructure,
  FrameworkInfrastructure,
} from "@noddde/core";

describe("SagaEventHandler", () => {
  type MyEvent = DefineEvents<{ OrderPlaced: { orderId: string } }>;
  type OrderPlacedEvent = Extract<MyEvent, { name: "OrderPlaced" }>;
  type MyState = { started: boolean };
  type MyCommand = Command & { name: "ProcessOrder" };

  interface MyInfra extends Infrastructure {
    notifier: { notify(msg: string): void };
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

  it("should receive infrastructure merged with CQRSInfrastructure and FrameworkInfrastructure", () => {
    expectTypeOf<Parameters<Handler>[2]>().toEqualTypeOf<
      MyInfra & CQRSInfrastructure & FrameworkInfrastructure
    >();
  });

  it("should return SagaReaction or Promise of it", () => {
    expectTypeOf<ReturnType<Handler>>().toEqualTypeOf<
      | SagaReaction<MyState, MyCommand>
      | Promise<SagaReaction<MyState, MyCommand>>
    >();
  });
});
```

### Saga on map extracts saga instance ID

```ts
import { describe, it, expect } from "vitest";
import type { DefineEvents, Command, Infrastructure } from "@noddde/core";
import { defineSaga } from "@noddde/core";

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
```

### startedBy enforces non-empty tuple

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { Saga, SagaTypes } from "@noddde/core";

describe("Saga startedBy non-empty tuple", () => {
  it("should require at least one event name", () => {
    // The type [T, ...T[]] enforces at least one element.
    // An empty array [] would not satisfy this type.
    type StartedByType = Saga["startedBy"];
    expectTypeOf<StartedByType>().toMatchTypeOf<[string, ...string[]]>();
  });
});
```

### Infer utilities extract types from saga

```ts
import { describe, it, expectTypeOf } from "vitest";
import type {
  DefineEvents,
  Command,
  Infrastructure,
  InferSagaState,
  InferSagaEvents,
  InferSagaCommands,
  InferSagaInfrastructure,
  InferSagaId,
} from "@noddde/core";
import { defineSaga } from "@noddde/core";

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
```

### Custom saga ID type

```ts
import { describe, it, expectTypeOf } from "vitest";
import type {
  DefineEvents,
  Command,
  Infrastructure,
  InferSagaId,
} from "@noddde/core";
import { defineSaga } from "@noddde/core";

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
```

### defineSaga is an identity function at runtime

```ts
import { describe, it, expect } from "vitest";
import { defineSaga } from "@noddde/core";
import type { DefineEvents, Command, Infrastructure } from "@noddde/core";

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
```

### InferSagaEventHandler narrows event with merged infrastructure

```ts
import { describe, it, expectTypeOf } from "vitest";
import type {
  DefineEvents,
  DefineCommands,
  Infrastructure,
  InferSagaEventHandler,
  SagaReaction,
  CQRSInfrastructure,
  FrameworkInfrastructure,
} from "@noddde/core";

describe("InferSagaEventHandler", () => {
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

  interface FulfillmentInfra extends Infrastructure {
    notifier: { notify(msg: string): void };
  }

  type FulfillmentTypes = {
    state: FulfillmentState;
    events: OrderEvent;
    commands: PaymentCommand;
    infrastructure: FulfillmentInfra;
  };

  it("should narrow the event to the specific variant", () => {
    type Handler = InferSagaEventHandler<FulfillmentTypes, "OrderPlaced">;
    expectTypeOf<Parameters<Handler>[0]>().toEqualTypeOf<
      Extract<OrderEvent, { name: "OrderPlaced" }>
    >();
  });

  it("should use the saga state as second parameter", () => {
    type Handler = InferSagaEventHandler<FulfillmentTypes, "OrderPlaced">;
    expectTypeOf<Parameters<Handler>[1]>().toEqualTypeOf<FulfillmentState>();
  });

  it("should merge infrastructure with CQRSInfrastructure and FrameworkInfrastructure", () => {
    type Handler = InferSagaEventHandler<FulfillmentTypes, "OrderPlaced">;
    expectTypeOf<Parameters<Handler>[2]>().toEqualTypeOf<
      FulfillmentInfra & CQRSInfrastructure & FrameworkInfrastructure
    >();
  });

  it("should return SagaReaction or Promise of it", () => {
    type Handler = InferSagaEventHandler<FulfillmentTypes, "OrderPlaced">;
    expectTypeOf<ReturnType<Handler>>().toEqualTypeOf<
      | SagaReaction<FulfillmentState, PaymentCommand>
      | Promise<SagaReaction<FulfillmentState, PaymentCommand>>
    >();
  });
});
```

### InferSagaOnEntry bundles id and handle for one event

```ts
import { describe, it, expectTypeOf } from "vitest";
import type {
  DefineEvents,
  DefineCommands,
  Infrastructure,
  InferSagaOnEntry,
  SagaEventHandler,
} from "@noddde/core";
import { defineSaga } from "@noddde/core";

describe("InferSagaOnEntry", () => {
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

  it("should have id and handle fields", () => {
    type Entry = InferSagaOnEntry<FulfillmentTypes, "OrderPlaced">;
    expectTypeOf<Entry["id"]>().toBeFunction();
    expectTypeOf<Entry["handle"]>().toBeFunction();
  });

  it("should narrow the event in id function", () => {
    type Entry = InferSagaOnEntry<FulfillmentTypes, "OrderPlaced">;
    type IdParam = Parameters<Entry["id"]>[0];
    expectTypeOf<IdParam>().toEqualTypeOf<
      Extract<OrderEvent, { name: "OrderPlaced" }>
    >();
  });

  it("should support custom saga ID type", () => {
    type Entry = InferSagaOnEntry<FulfillmentTypes, "OrderPlaced", number>;
    type IdReturn = ReturnType<Entry["id"]>;
    expectTypeOf<IdReturn>().toBeNumber();
  });

  it("should be usable in defineSaga on map", () => {
    const onOrderPlaced: InferSagaOnEntry<FulfillmentTypes, "OrderPlaced"> = {
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
    };

    const saga = defineSaga<FulfillmentTypes>({
      initialState: { status: "pending", orderId: null },
      startedBy: ["OrderPlaced"],
      on: {
        OrderPlaced: onOrderPlaced,
      },
    });

    expectTypeOf(saga.on.OrderPlaced).not.toBeUndefined();
  });
});
```
