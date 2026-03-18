---
title: "AggregateTypes, CommandHandler, Aggregate, defineAggregate & Infer Utilities"
module: ddd/aggregate-root
source_file: packages/core/src/ddd/aggregate-root.ts
status: implemented
exports:
  [
    AggregateTypes,
    CommandHandler,
    Aggregate,
    defineAggregate,
    InferAggregateID,
    InferAggregateState,
    InferAggregateEvents,
    InferAggregateCommands,
    InferAggregateInfrastructure,
  ]
depends_on:
  [
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

# AggregateTypes, CommandHandler, Aggregate, defineAggregate & Infer Utilities

> This module implements the Decider pattern for aggregates: a typed configuration object with initial state, command handlers (decide), and apply handlers (evolve). `AggregateTypes` bundles the four type parameters. `CommandHandler` implements the decide phase. `Aggregate` is the definition interface. `defineAggregate` is an identity function providing full type inference. Five `Infer*` utilities extract individual types from an aggregate definition.

## Type Contract

- **`AggregateTypes`** is a type with four required fields:

  - `state: any` -- the aggregate state shape.
  - `events: Event` -- discriminated union of events the aggregate can emit.
  - `commands: AggregateCommand` -- discriminated union of commands the aggregate handles.
  - `infrastructure: Infrastructure` -- external dependencies for command handlers.

- **`CommandHandler<TCommand, TState, TEvents, TInfrastructure>`** is a function type:

  - Parameters: `(command: TCommand, state: TState, infrastructure: TInfrastructure)`.
  - Return: `TEvents | TEvents[] | Promise<TEvents | TEvents[]>`.
  - `TCommand extends AggregateCommand`, `TEvents extends Event`, `TInfrastructure extends Infrastructure` (defaults to `Infrastructure`).

- **`Aggregate<T extends AggregateTypes>`** is an interface with three fields:

  - `initialState: T["state"]` -- the zero-value state.
  - `commands: CommandHandlerMap<T>` -- a map of command handlers keyed by command `name`, where each handler is typed with `Extract<T["commands"], { name: K }>`.
  - `apply: ApplyHandlerMap<T>` -- a map of apply handlers keyed by event `name`, where each handler is typed with `Extract<T["events"], { name: K }>`.

- **`defineAggregate<T>(config): Aggregate<T>`** -- identity function returning `config` as-is, providing type inference.

- **Infer utilities**:
  - `InferAggregateID<T extends AggregateTypes>` = `T["commands"]["targetAggregateId"]`.
  - `InferAggregateState<T extends Aggregate>` = inferred `U["state"]`.
  - `InferAggregateEvents<T extends Aggregate>` = inferred `U["events"]`.
  - `InferAggregateCommands<T extends Aggregate>` = inferred `U["commands"]`.
  - `InferAggregateInfrastructure<T extends Aggregate>` = inferred `U["infrastructure"]`.

## Behavioral Requirements

- `CommandHandlerMap` requires one handler per command `name` in the union. Missing handlers cause a compile error.
- `ApplyHandlerMap` requires one handler per event `name` in the union. Missing handlers cause a compile error.
- Each command handler receives the narrowed command type (via `Extract`) -- only the specific command variant, not the full union.
- Each apply handler receives the narrowed event payload (via `Extract`) -- only the specific event variant's payload.
- `defineAggregate` is a pass-through that enables TypeScript to infer `T` from the config object, so users write `defineAggregate<MyTypes>({...})` with full autocomplete.
- Command handlers can return a single event, an array of events, or a Promise of either.
- Apply handlers must be synchronous and return the new state.

## Invariants

- The `commands` map has exactly one key per command name in `T["commands"]`.
- The `apply` map has exactly one key per event name in `T["events"]`.
- `defineAggregate` returns the exact same object it receives (identity function).
- Command handler parameter types are narrowed by `Extract`, not the full union.
- Apply handler parameter types are narrowed by `Extract`, not the full union.
- `InferAggregateID` operates on `AggregateTypes` (the bundle), not on `Aggregate` (the definition).
- The other four `Infer*` utilities operate on `Aggregate` (the definition).

## Edge Cases

- **Single command/event**: Maps have exactly one key each.
- **Command handler returning a single event vs array**: Both are valid return types.
- **Async command handler**: Returning `Promise<TEvents>` is valid.
- **Infrastructure defaults to `{}`**: If not overridden in the types bundle.
- **Custom aggregate ID type**: `InferAggregateID` extracts the ID type from the commands' `targetAggregateId`.

## Integration Points

- `Aggregate` is the primary building block of the domain layer.
- The engine/runtime loads an aggregate, replays events through `apply` handlers to rebuild state, then routes commands to `commands` handlers.
- Events emitted by command handlers are persisted and published via `EventBus`.
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
    commands: {
      Increment: (command, _state, _infra) => ({
        name: "Incremented",
        payload: { amount: command.payload.amount },
      }),
      Decrement: (command, _state, _infra) => ({
        name: "Decremented",
        payload: { amount: command.payload.amount },
      }),
    },
    apply: {
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

  it("should have typed command handlers", () => {
    expectTypeOf(Counter.commands.Increment).toBeFunction();
    expectTypeOf(Counter.commands.Decrement).toBeFunction();
  });

  it("should have typed apply handlers", () => {
    expectTypeOf(Counter.apply.Incremented).toBeFunction();
    expectTypeOf(Counter.apply.Decremented).toBeFunction();
  });
});
```

### CommandHandler receives narrowed command type

```ts
import { describe, it, expectTypeOf } from "vitest";
import type {
  CommandHandler,
  AggregateCommand,
  Event,
  Infrastructure,
} from "@noddde/core";

describe("CommandHandler", () => {
  interface CreateAccountCommand extends AggregateCommand {
    name: "CreateAccount";
    payload: { owner: string };
  }

  type AccountEvent = {
    name: "AccountCreated";
    payload: { id: string; owner: string };
  };

  type Handler = CommandHandler<
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
      commands: {
        AddItem: (cmd) => ({
          name: "ItemAdded",
          payload: { item: cmd.payload.item },
        }),
        RemoveItem: (cmd) => ({
          name: "ItemRemoved",
          payload: { item: cmd.payload.item },
        }),
      },
      apply: {
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
    commands: {
      Update: (cmd) => ({
        name: "Updated",
        payload: { newValue: cmd.payload.newValue },
      }),
    },
    apply: {
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

### Command handler can return single event or array

```ts
import { describe, it, expect } from "vitest";
import type {
  DefineEvents,
  DefineCommands,
  Infrastructure,
} from "@noddde/core";
import { defineAggregate } from "@noddde/core";

describe("Command handler return types", () => {
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
      commands: {
        DoIt: (cmd) => ({
          name: "Done",
          payload: { id: cmd.targetAggregateId },
        }),
        DoItTwice: (cmd) => [
          { name: "Done", payload: { id: cmd.targetAggregateId } },
          { name: "Done", payload: { id: cmd.targetAggregateId } },
        ],
      },
      apply: {
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
      commands: {
        Y: (cmd: any) => ({
          name: "X" as const,
          payload: { v: cmd.payload.v },
        }),
      },
      apply: {
        X: (payload: any, state: any) => ({ v: payload.v }),
      },
    };
    const result = defineAggregate<T>(config as any);
    expect(result).toBe(config);
  });
});
```
