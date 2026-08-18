---
title: "CommandBus"
module: cqrs/command/command-bus
source_file: packages/core/src/cqrs/command/command-bus.ts
status: implemented
exports: [CommandBus, CommandHandlerRegistry]
depends_on: [cqrs/command/command]
docs: [modeling/routing-and-dispatch.mdx]
---

# CommandBus

> The `CommandBus` interface defines the contract for dispatching commands to their registered handlers. It routes aggregate commands to the appropriate aggregate and standalone commands to standalone command handlers. `CommandHandlerRegistry` is a separate, optional sub-interface for buses that support local handler registration.

## Type Contract

- **`CommandBus`** is an interface with a single method:
  - `dispatch(command: Command): Promise<void>` -- dispatches a command for processing.
- Unlike `EventBus` and `QueryBus`, the `dispatch` method is NOT generic -- it accepts the base `Command` type.
- The return type is `Promise<void>`.
- **`CommandHandlerRegistry`** is an interface with a single method:
  - `register(commandName: string, handler: (command: Command) => void | Promise<void>): void`
  - Not part of `CommandBus` itself: a remote/RPC command bus is a valid `CommandBus` that structurally cannot support local registration.

## Behavioral Requirements

- `dispatch` accepts any value satisfying the `Command` interface.
- The method is not generic, meaning the concrete command type is erased at the interface level. Implementations must use runtime dispatch (e.g., matching on `command.name`).
- Returns `Promise<void>` -- callers await completion but receive no return value.
- The bus is responsible for routing: aggregate commands go to aggregates, standalone commands go to their handlers.
- `CommandHandlerRegistry.register` is not required by `CommandBus`. A bus that only implements `CommandBus` (no registration) is valid. The domain engine checks for `CommandHandlerRegistry` structurally on the bus supplied via `DomainWiring.buses`, and fails loudly at init (rather than a runtime `TypeError`) if registration is required but the bus doesn't implement it. See `specs/api-freeze.spec.md` decision 3.

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
    expectTypeOf<CommandBus["dispatch"]>()
      .parameter(0)
      .toEqualTypeOf<Command>();
  });
});
```

### CommandHandlerRegistry is a separate, optional sub-interface

```ts
import { describe, it, expect, expectTypeOf } from "vitest";
import type { CommandBus, CommandHandlerRegistry, Command } from "@noddde/core";

describe("CommandHandlerRegistry", () => {
  it("should not be required by CommandBus", () => {
    const bus: CommandBus = { dispatch: async () => {} };
    expectTypeOf(bus).toMatchTypeOf<CommandBus>();
  });

  it("should allow a bus to implement both CommandBus and CommandHandlerRegistry", async () => {
    const handlers = new Map<string, (command: Command) => void>();
    const bus: CommandBus & CommandHandlerRegistry = {
      dispatch: async (command) => {
        handlers.get(command.name)?.(command);
      },
      register: (commandName, handler) => {
        handlers.set(commandName, handler as (command: Command) => void);
      },
    };

    let received: Command | undefined;
    bus.register("DoSomething", (command) => {
      received = command;
    });
    await bus.dispatch({ name: "DoSomething" });

    expect(received).toEqual({ name: "DoSomething" });
  });
});
```
