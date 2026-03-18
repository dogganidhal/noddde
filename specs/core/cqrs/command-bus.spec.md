---
title: "CommandBus"
module: cqrs/command/command-bus
source_file: packages/core/src/cqrs/command/command-bus.ts
status: implemented
exports: [CommandBus]
depends_on: [cqrs/command/command]
docs:
  - commands/dispatching.mdx
---

# CommandBus

> The `CommandBus` interface defines the contract for dispatching commands to their registered handlers. It routes aggregate commands to the appropriate aggregate and standalone commands to standalone command handlers.

## Type Contract

- **`CommandBus`** is an interface with a single method:
  - `dispatch(command: Command): Promise<void>` -- dispatches a command for processing.
- Unlike `EventBus` and `QueryBus`, the `dispatch` method is NOT generic -- it accepts the base `Command` type.
- The return type is `Promise<void>`.

## Behavioral Requirements

- `dispatch` accepts any value satisfying the `Command` interface.
- The method is not generic, meaning the concrete command type is erased at the interface level. Implementations must use runtime dispatch (e.g., matching on `command.name`).
- Returns `Promise<void>` -- callers await completion but receive no return value.
- The bus is responsible for routing: aggregate commands go to aggregates, standalone commands go to their handlers.

## Invariants

- The parameter type is `Command` (not generic `TCommand extends Command`), which is a deliberate design choice for simplicity.
- The return type is always `Promise<void>`.
- `AggregateCommand` is assignable to `Command`, so aggregate commands can be dispatched through this bus.
- `StandaloneCommand` is assignable to `Command` (it is `Command`).

## Edge Cases

- **Dispatching an AggregateCommand**: Valid because `AggregateCommand extends Command`.
- **Dispatching a minimal Command**: `{ name: "Foo" }` is valid (payload is optional).
- **Unknown command name**: The interface makes no compile-time guarantee about handler existence -- that is a runtime concern.

## Integration Points

- `CommandBus` is a member of `CQRSInfrastructure`, making it available to standalone command handlers and saga event handlers.
- The engine/runtime implements `CommandBus` to route commands to aggregates and standalone handlers.
- Sagas dispatch commands via `CQRSInfrastructure.commandBus`.

## Test Scenarios

### CommandBus dispatch accepts any Command

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { CommandBus, Command, AggregateCommand } from "@noddde/core";

describe("CommandBus", () => {
  it("should accept a base Command", () => {
    const bus = {} as CommandBus;
    const cmd: Command = { name: "DoSomething" };
    expectTypeOf(bus.dispatch(cmd)).toEqualTypeOf<Promise<void>>();
  });

  it("should accept an AggregateCommand", () => {
    const bus = {} as CommandBus;
    const cmd: AggregateCommand = {
      name: "CreateAccount",
      targetAggregateId: "123",
    };
    expectTypeOf(bus.dispatch(cmd)).toEqualTypeOf<Promise<void>>();
  });

  it("should return Promise<void>", () => {
    const bus = {} as CommandBus;
    expectTypeOf(bus.dispatch).returns.toEqualTypeOf<Promise<void>>();
  });
});
```

### CommandBus dispatch is not generic

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { CommandBus, Command } from "@noddde/core";

describe("CommandBus non-generic dispatch", () => {
  it("should accept Command parameter type", () => {
    expectTypeOf<CommandBus["dispatch"]>().parameter(0).toEqualTypeOf<Command>();
  });
});
```
