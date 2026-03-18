---
title: "InMemoryCommandBus"
module: engine/implementations/in-memory-command-bus
source_file: packages/core/src/engine/implementations/in-memory-command-bus.ts
status: implemented
exports: [InMemoryCommandBus]
depends_on: [cqrs/command/command-bus, cqrs/command/command]
docs:
  - infrastructure/in-memory-implementations.mdx
---

# InMemoryCommandBus

> In-memory CommandBus implementation that routes commands to registered handlers within the same process. Handlers are registered by command name and invoked when a matching command is dispatched. Suitable for development, testing, and single-process applications.

## Type Contract

```ts
class InMemoryCommandBus implements CommandBus {
  dispatch(command: Command): Promise<void>;
}
```

- Implements the `CommandBus` interface from `cqrs/command/command-bus`.
- The current source is a stub (`throw new Error("Method not implemented.")`). This spec defines the expected behavior once implemented.
- The bus must support handler registration (e.g., via a `register(name, handler)` method or constructor injection of a handler map) so the Domain can wire aggregate command handlers and standalone command handlers at init time.

## Behavioral Requirements

1. **Handler registration** -- The bus must provide a mechanism to register a handler for a given command name. Only one handler per command name is allowed (commands have a single handler, unlike events which have multiple subscribers).
2. **Dispatch routing** -- `dispatch(command)` looks up the handler registered for `command.name` and invokes it with the command object.
3. **Async execution** -- `dispatch` awaits the handler if it returns a Promise, propagating any rejection to the caller.
4. **No handler found** -- If no handler is registered for the dispatched command name, `dispatch` must throw a descriptive error (e.g., `"No handler registered for command: CreateAccount"`).
5. **Handler isolation** -- Each dispatch is independent. A failing handler does not prevent future dispatches of the same or different commands.
6. **Single handler constraint** -- Registering a second handler for the same command name should either throw or overwrite the previous handler. The framework registers handlers once at init time, so duplicate registration indicates a configuration bug.

## Invariants

- The handler map is populated during `Domain.init()` and should not change after initialization.
- `dispatch` is the only public method required by the `CommandBus` interface. Registration is an implementation detail of `InMemoryCommandBus`.
- The bus does not queue or batch commands. Each `dispatch` call is processed immediately.

## Edge Cases

- **Command with no payload** -- Commands defined with `void` payload (e.g., `{ name: "ResetAccount", targetAggregateId: "acc-1" }`) must be dispatched and handled normally. The handler receives the command object as-is.
- **Handler throws synchronously** -- The error should propagate as a rejected promise from `dispatch`.
- **Handler throws asynchronously** -- The error should propagate as a rejected promise from `dispatch`.
- **Duplicate registration** -- Should throw an error or overwrite, signaling a configuration problem. Prefer throwing to surface bugs early.
- **Empty command name** -- Dispatching a command with `name: ""` follows normal lookup; if no handler is registered for `""`, it throws "no handler" error.

## Integration Points

- **Domain.init()** -- The domain registers one handler per aggregate command (derived from `Aggregate.commands`) and one handler per standalone command handler in the write model.
- **Domain.dispatchCommand()** -- Aggregate commands flow through the command bus. The bus invokes the handler that the domain registered, which internally loads the aggregate, executes the command handler, persists, and publishes events.
- **Saga reactions** -- Sagas return commands that are dispatched through the command bus, closing the event-command loop.
- **CQRSInfrastructure** -- This bus is provided as `commandBus` in the merged infrastructure object.

## Test Scenarios

### dispatch routes command to registered handler

```ts
import { describe, it, expect, vi } from "vitest";
import { InMemoryCommandBus } from "@noddde/core";

describe("InMemoryCommandBus", () => {
  it("should invoke the registered handler when a command is dispatched", async () => {
    const bus = new InMemoryCommandBus();
    const handler = vi.fn().mockResolvedValue(undefined);

    // Register handler (implementation detail -- method name may vary)
    // @ts-expect-error -- accessing internal registration API
    bus.register("CreateAccount", handler);

    const command = {
      name: "CreateAccount",
      targetAggregateId: "acc-1",
      payload: { owner: "Alice" },
    };

    await bus.dispatch(command);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(command);
  });
});
```

### dispatch throws when no handler is registered

```ts
import { describe, it, expect } from "vitest";
import { InMemoryCommandBus } from "@noddde/core";

describe("InMemoryCommandBus", () => {
  it("should throw when dispatching a command with no registered handler", async () => {
    const bus = new InMemoryCommandBus();

    await expect(bus.dispatch({ name: "UnknownCommand" })).rejects.toThrow(
      /no handler/i,
    );
  });
});
```

### dispatch propagates handler errors

```ts
import { describe, it, expect, vi } from "vitest";
import { InMemoryCommandBus } from "@noddde/core";

describe("InMemoryCommandBus", () => {
  it("should propagate errors thrown by the handler", async () => {
    const bus = new InMemoryCommandBus();

    // @ts-expect-error -- accessing internal registration API
    bus.register("FailingCommand", () => {
      throw new Error("Handler failed");
    });

    await expect(bus.dispatch({ name: "FailingCommand" })).rejects.toThrow(
      "Handler failed",
    );
  });
});
```

### dispatch propagates async handler rejections

```ts
import { describe, it, expect, vi } from "vitest";
import { InMemoryCommandBus } from "@noddde/core";

describe("InMemoryCommandBus", () => {
  it("should propagate async rejections from the handler", async () => {
    const bus = new InMemoryCommandBus();

    // @ts-expect-error -- accessing internal registration API
    bus.register("AsyncFail", async () => {
      throw new Error("Async handler failed");
    });

    await expect(bus.dispatch({ name: "AsyncFail" })).rejects.toThrow(
      "Async handler failed",
    );
  });
});
```

### dispatch handles commands with no payload

```ts
import { describe, it, expect, vi } from "vitest";
import { InMemoryCommandBus } from "@noddde/core";

describe("InMemoryCommandBus", () => {
  it("should dispatch commands that have no payload", async () => {
    const bus = new InMemoryCommandBus();
    const handler = vi.fn().mockResolvedValue(undefined);

    // @ts-expect-error -- accessing internal registration API
    bus.register("ResetAccount", handler);

    const command = { name: "ResetAccount", targetAggregateId: "acc-1" };
    await bus.dispatch(command);

    expect(handler).toHaveBeenCalledWith(command);
  });
});
```

### duplicate handler registration throws

```ts
import { describe, it, expect, vi } from "vitest";
import { InMemoryCommandBus } from "@noddde/core";

describe("InMemoryCommandBus", () => {
  it("should throw when registering a second handler for the same command name", () => {
    const bus = new InMemoryCommandBus();

    // @ts-expect-error -- accessing internal registration API
    bus.register("CreateAccount", vi.fn());

    expect(() => {
      // @ts-expect-error -- accessing internal registration API
      bus.register("CreateAccount", vi.fn());
    }).toThrow(/already registered/i);
  });
});
```
