---
title: "AggregateTypes, DecideHandler, Aggregate, defineAggregate & Infer Utilities"
module: ddd/aggregate-root
source_file: packages/core/src/ddd/aggregate-root.ts
status: implemented
exports:
  [
    AggregateTypes,
    DecideHandler,
    Aggregate,
    defineAggregate,
    InferAggregateID,
    InferAggregateState,
    InferAggregateEvents,
    InferAggregateCommands,
    InferAggregateInfrastructure,
    InferDecideHandler,
    InferEvolveHandler,
  ]
depends_on:
  [
    id,
    edd/event,
    edd/event-sourcing-handler,
    cqrs/command/command,
    infrastructure/index,
  ]
docs:
  - aggregates/overview.mdx
  - aggregates/defining-aggregates.mdx
  - aggregates/state-design.mdx
  - aggregates/command-routing.mdx
  - aggregates/type-inference.mdx
---

# AggregateTypes, DecideHandler, Aggregate, defineAggregate & Infer Utilities

> This module implements the Decider pattern for aggregates: a typed configuration object with initial state, decide handlers (decide), and evolve handlers (evolve). `AggregateTypes` bundles the four type parameters. `DecideHandler` implements the decide phase. `Aggregate` is the definition interface. `defineAggregate` is an identity function providing full type inference. Five `Infer*` utilities extract individual types from an aggregate definition.

## Type Contract

- **`AggregateTypes`** is a type with four required fields:

  - `state: any` -- the aggregate state shape.
  - `events: Event` -- discriminated union of events the aggregate can emit.
  - `commands: AggregateCommand<ID>` -- discriminated union of commands the aggregate handles. Uses `AggregateCommand<ID>` as the base constraint to support any ID type.
  - `infrastructure: Infrastructure` -- external dependencies for command handlers.

- **`DecideHandler<TCommand, TState, TEvents, TInfrastructure>`** is a function type:

  - Parameters: `(command: TCommand, state: TState, infrastructure: TInfrastructure & FrameworkInfrastructure)`.
  - Return: `TEvents | TEvents[] | Promise<TEvents | TEvents[]>`.
  - `TCommand extends AggregateCommand<ID>`, `TEvents extends Event`, `TInfrastructure extends Infrastructure` (defaults to `Infrastructure`).
  - Infrastructure is merged with `FrameworkInfrastructure` via intersection, giving decide handlers access to `logger`.

- **`Aggregate<T extends AggregateTypes>`** is an interface with three fields:

  - `initialState: T["state"]` -- the zero-value state.
  - `decide: DecideHandlerMap<T>` -- a map of decide handlers keyed by command `name`, where each handler is typed with `Extract<T["commands"], { name: K }>`.
  - `evolve: EvolveHandlerMap<T>` -- a map of evolve handlers keyed by event `name`, where each handler is typed with `Extract<T["events"], { name: K }>`.
  - `upcasters?: UpcasterMap<T["events"]>` -- optional map of event upcaster chains for schema evolution. See the upcaster spec for details.

- **`defineAggregate<T>(config): Aggregate<T>`** -- identity function returning `config` as-is, providing type inference.

- **Infer utilities** (operate on `Aggregate` definition instances):

  - `InferAggregateID<T extends AggregateTypes>` = `T["commands"]["targetAggregateId"]`.
  - `InferAggregateState<T extends Aggregate>` = inferred `U["state"]`.
  - `InferAggregateEvents<T extends Aggregate>` = inferred `U["events"]`.
  - `InferAggregateCommands<T extends Aggregate>` = inferred `U["commands"]`.
  - `InferAggregateInfrastructure<T extends Aggregate>` = inferred `U["infrastructure"]`.

- **Handler-level inference utilities** (operate on `AggregateTypes` bundle, for typing extracted handlers in separate files):

  - `InferDecideHandler<T extends AggregateTypes, K extends T["commands"]["name"]>` = `DecideHandler<Extract<T["commands"], { name: K }>, T["state"], T["events"], T["infrastructure"]>`. Resolves to the exact decide handler function type for command `K`, with the command narrowed via `Extract`, and infrastructure merged with `FrameworkInfrastructure` (via `DecideHandler`).

  - `InferEvolveHandler<T extends AggregateTypes, K extends T["events"]["name"]>` = `EvolveHandler<Extract<T["events"], { name: K }>, T["state"]>`. Resolves to the exact evolve handler function type for event `K`, with the event payload narrowed via `Extract`.

## Behavioral Requirements

- `DecideHandlerMap` requires one handler per command `name` in the union. Missing handlers cause a compile error.
- `EvolveHandlerMap` requires one handler per event `name` in the union. Missing handlers cause a compile error.
- Each decide handler receives the narrowed command type (via `Extract`) -- only the specific command variant, not the full union.
- Each evolve handler receives the narrowed event payload (via `Extract`) -- only the specific event variant's payload.
- `defineAggregate` is a pass-through that enables TypeScript to infer `T` from the config object, so users write `defineAggregate<MyTypes>({...})` with full autocomplete.
- Decide handlers can return a single event, an array of events, or a Promise of either.
- Evolve handlers must be synchronous and return the new state.
- `InferDecideHandler<T, K>` resolves to a function receiving the narrowed command (via `Extract<T["commands"], { name: K }>`), the aggregate state, and infrastructure merged with `FrameworkInfrastructure`, returning the event union.
- `InferEvolveHandler<T, K>` resolves to a function receiving the narrowed event payload (via `Extract<T["events"], { name: K }>`) and the aggregate state, returning the new state.
- Both `InferDecideHandler` and `InferEvolveHandler` operate on the `AggregateTypes` bundle (not the `Aggregate` definition instance), enabling use before `defineAggregate` is called.
- A handler typed with `InferDecideHandler<T, K>` is structurally compatible with the corresponding slot in `DecideHandlerMap<T>` and can be used directly in `defineAggregate`.
- A handler typed with `InferEvolveHandler<T, K>` is structurally compatible with the corresponding slot in `EvolveHandlerMap<T>`.

## Invariants

- The `decide` map has exactly one key per command name in `T["commands"]`.
- The `evolve` map has exactly one key per event name in `T["events"]`.
- `defineAggregate` returns the exact same object it receives (identity function).
- Decide handler parameter types are narrowed by `Extract`, not the full union.
- Evolve handler parameter types are narrowed by `Extract`, not the full union.
- `InferAggregateID` operates on `AggregateTypes` (the bundle), not on `Aggregate` (the definition).
- The other four `Infer*` utilities operate on `Aggregate` (the definition).
- `InferDecideHandler` and `InferEvolveHandler` operate on `AggregateTypes` (the bundle), like `InferAggregateID`.
- `InferDecideHandler<T, K>` always produces the same type as indexing `DecideHandlerMap<T>` at key `K`.
- `InferEvolveHandler<T, K>` always produces the same type as indexing `EvolveHandlerMap<T>` at key `K`.

## Edge Cases

- **Single command/event**: Maps have exactly one key each.
- **Decide handler returning a single event vs array**: Both are valid return types.
- **Async decide handler**: Returning `Promise<TEvents>` is valid.
- **Infrastructure defaults to `{}`**: If not overridden in the types bundle.
- **Custom aggregate ID type**: `InferAggregateID` extracts the ID type from the commands' `targetAggregateId`.

## Integration Points

- `Aggregate` is the primary building block of the domain layer.
- The engine/runtime loads an aggregate, replays events through `evolve` handlers to rebuild state, then routes commands to `decide` handlers.
- Events emitted by decide handlers are persisted and published via `EventBus`.
- `InferAggregate*` utilities are used downstream to derive types for repositories, test helpers, and engine configuration.

## Test Scenarios

### defineAggregate provides full type inference

```ts
import { describe, it, expectTypeOf } from "vitest";
import type {
  DefineEvents,
  DefineCommands,
  Infrastructure,
} from "@noddde/core";
import { defineAggregate } from "@noddde/core";

describe("defineAggregate", () => {
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
    infrastructure: Infrastructure;
  };

  const Counter = defineAggregate<CounterTypes>({
    initialState: { count: 0 },
    decide: {
      Increment: (command, _state, _infra) => ({
        name: "Incremented",
        payload: { amount: command.payload.amount },
      }),
      Decrement: (command, _state, _infra) => ({
        name: "Decremented",
        payload: { amount: command.payload.amount },
      }),
    },
    evolve: {
      Incremented: (payload, state) => ({
        count: state.count + payload.amount,
      }),
      Decremented: (payload, state) => ({
        count: state.count - payload.amount,
      }),
    },
  });

  it("should return the aggregate config object", () => {
    expectTypeOf(Counter.initialState).toEqualTypeOf<CounterState>();
  });

  it("should have typed decide handlers", () => {
    expectTypeOf(Counter.decide.Increment).toBeFunction();
    expectTypeOf(Counter.decide.Decrement).toBeFunction();
  });

  it("should have typed evolve handlers", () => {
    expectTypeOf(Counter.evolve.Incremented).toBeFunction();
    expectTypeOf(Counter.evolve.Decremented).toBeFunction();
  });
});
```

### DecideHandler receives narrowed command type

```ts
import { describe, it, expectTypeOf } from "vitest";
import type {
  DecideHandler,
  AggregateCommand,
  Event,
  Infrastructure,
} from "@noddde/core";

describe("DecideHandler", () => {
  interface CreateAccountCommand extends AggregateCommand {
    name: "CreateAccount";
    payload: { owner: string };
  }

  type AccountEvent = {
    name: "AccountCreated";
    payload: { id: string; owner: string };
  };

  type Handler = DecideHandler<
    CreateAccountCommand,
    { balance: number },
    AccountEvent,
    Infrastructure
  >;

  it("should receive the specific command as first parameter", () => {
    expectTypeOf<
      Parameters<Handler>[0]
    >().toEqualTypeOf<CreateAccountCommand>();
  });

  it("should receive state as second parameter", () => {
    expectTypeOf<Parameters<Handler>[1]>().toEqualTypeOf<{ balance: number }>();
  });

  it("should receive infrastructure as third parameter", () => {
    expectTypeOf<Parameters<Handler>[2]>().toEqualTypeOf<Infrastructure>();
  });

  it("should return event(s) or Promise of event(s)", () => {
    expectTypeOf<ReturnType<Handler>>().toEqualTypeOf<
      AccountEvent | AccountEvent[] | Promise<AccountEvent | AccountEvent[]>
    >();
  });
});
```

### Aggregate requires handlers for all command and event names

```ts
import { describe, it, expect } from "vitest";
import type {
  DefineEvents,
  DefineCommands,
  Infrastructure,
} from "@noddde/core";
import { defineAggregate } from "@noddde/core";

describe("Aggregate exhaustive handlers", () => {
  type Events = DefineEvents<{
    ItemAdded: { item: string };
    ItemRemoved: { item: string };
  }>;

  type Commands = DefineCommands<{
    AddItem: { item: string };
    RemoveItem: { item: string };
  }>;

  type CartTypes = {
    state: { items: string[] };
    events: Events;
    commands: Commands;
    infrastructure: Infrastructure;
  };

  it("should compile when all handlers are provided", () => {
    const cart = defineAggregate<CartTypes>({
      initialState: { items: [] },
      decide: {
        AddItem: (cmd) => ({
          name: "ItemAdded",
          payload: { item: cmd.payload.item },
        }),
        RemoveItem: (cmd) => ({
          name: "ItemRemoved",
          payload: { item: cmd.payload.item },
        }),
      },
      evolve: {
        ItemAdded: (payload, state) => ({
          items: [...state.items, payload.item],
        }),
        ItemRemoved: (payload, state) => ({
          items: state.items.filter((i) => i !== payload.item),
        }),
      },
    });
    expect(cart.initialState).toEqual({ items: [] });
  });
});
```

### Infer utilities extract types from aggregate

```ts
import { describe, it, expectTypeOf } from "vitest";
import type {
  DefineEvents,
  DefineCommands,
  Infrastructure,
  InferAggregateState,
  InferAggregateEvents,
  InferAggregateCommands,
  InferAggregateInfrastructure,
  InferAggregateID,
} from "@noddde/core";
import { defineAggregate } from "@noddde/core";

describe("Infer utilities", () => {
  type MyState = { value: number };
  type MyEvent = DefineEvents<{ Updated: { newValue: number } }>;
  type MyCommand = DefineCommands<{ Update: { newValue: number } }>;

  interface MyInfra extends Infrastructure {
    logger: { log(msg: string): void };
  }

  type MyTypes = {
    state: MyState;
    events: MyEvent;
    commands: MyCommand;
    infrastructure: MyInfra;
  };

  const MyAggregate = defineAggregate<MyTypes>({
    initialState: { value: 0 },
    decide: {
      Update: (cmd) => ({
        name: "Updated",
        payload: { newValue: cmd.payload.newValue },
      }),
    },
    evolve: {
      Updated: (payload, _state) => ({ value: payload.newValue }),
    },
  });

  it("should infer state type", () => {
    expectTypeOf<
      InferAggregateState<typeof MyAggregate>
    >().toEqualTypeOf<MyState>();
  });

  it("should infer events type", () => {
    expectTypeOf<
      InferAggregateEvents<typeof MyAggregate>
    >().toEqualTypeOf<MyEvent>();
  });

  it("should infer commands type", () => {
    expectTypeOf<
      InferAggregateCommands<typeof MyAggregate>
    >().toEqualTypeOf<MyCommand>();
  });

  it("should infer infrastructure type", () => {
    expectTypeOf<
      InferAggregateInfrastructure<typeof MyAggregate>
    >().toEqualTypeOf<MyInfra>();
  });

  it("should infer aggregate ID from types bundle", () => {
    expectTypeOf<InferAggregateID<MyTypes>>().toBeString();
  });
});
```

### InferAggregateID with number ID type

```ts
import { describe, it, expectTypeOf } from "vitest";
import type {
  DefineEvents,
  DefineCommands,
  Infrastructure,
  InferAggregateID,
} from "@noddde/core";

describe("InferAggregateID with number ID", () => {
  type MyEvent = DefineEvents<{ Created: { id: number } }>;
  type MyCommand = DefineCommands<{ Create: { id: number } }, number>;

  type NumericIdTypes = {
    state: {};
    events: MyEvent;
    commands: MyCommand;
    infrastructure: Infrastructure;
  };

  it("should infer number as the aggregate ID type", () => {
    expectTypeOf<InferAggregateID<NumericIdTypes>>().toBeNumber();
  });
});
```

### Decide handler can return single event or array

```ts
import { describe, it, expect } from "vitest";
import type {
  DefineEvents,
  DefineCommands,
  Infrastructure,
} from "@noddde/core";
import { defineAggregate } from "@noddde/core";

describe("Decide handler return types", () => {
  type Events = DefineEvents<{ Done: { id: string } }>;
  type Commands = DefineCommands<{ DoIt: void; DoItTwice: void }>;

  type Types = {
    state: {};
    events: Events;
    commands: Commands;
    infrastructure: Infrastructure;
  };

  it("should accept single event return", () => {
    const agg = defineAggregate<Types>({
      initialState: {},
      decide: {
        DoIt: (cmd) => ({
          name: "Done",
          payload: { id: cmd.targetAggregateId },
        }),
        DoItTwice: (cmd) => [
          { name: "Done", payload: { id: cmd.targetAggregateId } },
          { name: "Done", payload: { id: cmd.targetAggregateId } },
        ],
      },
      evolve: {
        Done: (_payload, state) => state,
      },
    });
    expect(agg).toBeDefined();
  });
});
```

### defineAggregate is an identity function at runtime

```ts
import { describe, it, expect } from "vitest";
import { defineAggregate } from "@noddde/core";
import type {
  DefineEvents,
  DefineCommands,
  Infrastructure,
} from "@noddde/core";

describe("defineAggregate identity", () => {
  type E = DefineEvents<{ X: { v: number } }>;
  type C = DefineCommands<{ Y: { v: number } }>;
  type T = {
    state: { v: number };
    events: E;
    commands: C;
    infrastructure: Infrastructure;
  };

  it("should return the exact same config object", () => {
    const config = {
      initialState: { v: 0 },
      decide: {
        Y: (cmd: any) => ({
          name: "X" as const,
          payload: { v: cmd.payload.v },
        }),
      },
      evolve: {
        X: (payload: any, state: any) => ({ v: payload.v }),
      },
    };
    const result = defineAggregate<T>(config as any);
    expect(result).toBe(config);
  });
});
```

### InferDecideHandler narrows command and wires infrastructure

```ts
import { describe, it, expectTypeOf } from "vitest";
import type {
  DefineEvents,
  DefineCommands,
  Infrastructure,
  InferDecideHandler,
  DecideHandler,
  FrameworkInfrastructure,
} from "@noddde/core";
import { defineAggregate } from "@noddde/core";

describe("InferDecideHandler", () => {
  type MyState = { value: number };

  type MyEvent = DefineEvents<{
    Updated: { newValue: number };
    Reset: {};
  }>;

  type MyCommand = DefineCommands<{
    Update: { newValue: number };
    Reset: void;
  }>;

  interface MyInfra extends Infrastructure {
    clock: { now(): Date };
  }

  type MyTypes = {
    state: MyState;
    events: MyEvent;
    commands: MyCommand;
    infrastructure: MyInfra;
  };

  it("should narrow the command to the specific variant", () => {
    type Handler = InferDecideHandler<MyTypes, "Update">;
    type Cmd = Parameters<Handler>[0];
    expectTypeOf<Cmd>().toEqualTypeOf<Extract<MyCommand, { name: "Update" }>>();
  });

  it("should use the aggregate state as second parameter", () => {
    type Handler = InferDecideHandler<MyTypes, "Update">;
    expectTypeOf<Parameters<Handler>[1]>().toEqualTypeOf<MyState>();
  });

  it("should merge infrastructure with FrameworkInfrastructure", () => {
    type Handler = InferDecideHandler<MyTypes, "Update">;
    expectTypeOf<Parameters<Handler>[2]>().toEqualTypeOf<
      MyInfra & FrameworkInfrastructure
    >();
  });

  it("should return the event union", () => {
    type Handler = InferDecideHandler<MyTypes, "Update">;
    expectTypeOf<ReturnType<Handler>>().toEqualTypeOf<
      MyEvent | MyEvent[] | Promise<MyEvent | MyEvent[]>
    >();
  });

  it("should be usable in defineAggregate decide map", () => {
    const decideUpdate: InferDecideHandler<MyTypes, "Update"> = (
      command,
      _state,
      _infra,
    ) => ({
      name: "Updated",
      payload: { newValue: command.payload.newValue },
    });

    const decideReset: InferDecideHandler<MyTypes, "Reset"> = (
      _command,
      _state,
      _infra,
    ) => ({
      name: "Reset",
      payload: {},
    });

    const agg = defineAggregate<MyTypes>({
      initialState: { value: 0 },
      decide: {
        Update: decideUpdate,
        Reset: decideReset,
      },
      evolve: {
        Updated: (payload, _state) => ({ value: payload.newValue }),
        Reset: (_payload, _state) => ({ value: 0 }),
      },
    });

    expectTypeOf(agg.decide.Update).toEqualTypeOf<typeof decideUpdate>();
  });
});
```

### InferEvolveHandler narrows event payload

```ts
import { describe, it, expectTypeOf } from "vitest";
import type {
  DefineEvents,
  DefineCommands,
  Infrastructure,
  InferEvolveHandler,
} from "@noddde/core";
import { defineAggregate } from "@noddde/core";

describe("InferEvolveHandler", () => {
  type MyState = { value: number };

  type MyEvent = DefineEvents<{
    Updated: { newValue: number };
    Reset: {};
  }>;

  type MyCommand = DefineCommands<{
    Update: { newValue: number };
    Reset: void;
  }>;

  type MyTypes = {
    state: MyState;
    events: MyEvent;
    commands: MyCommand;
    infrastructure: Infrastructure;
  };

  it("should narrow the event payload to the specific variant", () => {
    type Handler = InferEvolveHandler<MyTypes, "Updated">;
    expectTypeOf<Parameters<Handler>[0]>().toEqualTypeOf<{
      newValue: number;
    }>();
  });

  it("should use the aggregate state as second parameter and return type", () => {
    type Handler = InferEvolveHandler<MyTypes, "Updated">;
    expectTypeOf<Parameters<Handler>[1]>().toEqualTypeOf<MyState>();
    expectTypeOf<ReturnType<Handler>>().toEqualTypeOf<MyState>();
  });

  it("should be usable in defineAggregate evolve map", () => {
    const evolveUpdated: InferEvolveHandler<MyTypes, "Updated"> = (
      payload,
      _state,
    ) => ({ value: payload.newValue });

    const evolveReset: InferEvolveHandler<MyTypes, "Reset"> = (
      _payload,
      _state,
    ) => ({ value: 0 });

    const agg = defineAggregate<MyTypes>({
      initialState: { value: 0 },
      decide: {
        Update: (cmd) => ({
          name: "Updated",
          payload: { newValue: cmd.payload.newValue },
        }),
        Reset: (_cmd) => ({
          name: "Reset",
          payload: {},
        }),
      },
      evolve: {
        Updated: evolveUpdated,
        Reset: evolveReset,
      },
    });

    expectTypeOf(agg.evolve.Updated).toEqualTypeOf<typeof evolveUpdated>();
  });
});
```
