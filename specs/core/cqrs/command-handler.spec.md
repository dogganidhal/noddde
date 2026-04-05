---
title: "StandaloneCommandHandler"
module: cqrs/command/command-handler
source_file: packages/core/src/cqrs/command/command-handler.ts
status: implemented
exports: [StandaloneCommandHandler]
depends_on: [cqrs/command/command, ports/index]
docs:
  - commands/handling-commands.mdx
  - commands/standalone-commands.mdx
---

# StandaloneCommandHandler

> `StandaloneCommandHandler` is a function type for handling standalone commands (commands not routed to an aggregate). It receives the full command object and ports merged with CQRS buses, enabling it to dispatch further commands, publish events, or query read models.

## Type Contract

- **`StandaloneCommandHandler<TPorts, TCommand>`** is a function type:
  - First parameter: `command: TCommand` -- the full command object (not just the payload).
  - Second parameter: `ports: TPorts & CQRSPorts & FrameworkPorts` -- custom adapters merged with CQRS buses and framework ports (provides `logger`).
  - Return type: `void | Promise<void>`.
- `TPorts` is constrained to `extends Ports`.
- `TCommand` is constrained to `extends StandaloneCommand`.

## Behavioral Requirements

- The handler receives the full command object (including `name`), unlike event handlers which receive only the payload. This is because standalone commands may need to inspect the command name for routing logic.
- Ports is merged with `CQRSPorts` and `FrameworkPorts` via intersection (`&`), giving the handler access to `commandBus`, `eventBus`, `queryBus`, and `logger` in addition to custom adapters.
- The handler may be sync (`void`) or async (`Promise<void>`).
- The handler can dispatch commands, publish events, or query read models through the CQRS buses.

## Invariants

- The first parameter is the full `TCommand`, not `TCommand["payload"]`.
- The second parameter always includes `CQRSPorts` and `FrameworkPorts` via intersection.
- The return type is exactly `void | Promise<void>`.
- The generic parameter order is `<TPorts, TCommand>` (ports first, command second).

## Edge Cases

- **Empty ports (`{}`)**: The handler still gets `CQRSPorts` (the three buses) and `FrameworkPorts` (logger).
- **Command with no payload**: `StandaloneCommand` allows `payload` to be `undefined`.
- **Async handler**: Returning a `Promise<void>` is valid.
- **Handler that dispatches commands**: The handler can call `ports.commandBus.dispatch(...)`.

## Integration Points

- `StandaloneCommandHandler` is registered with the engine/runtime for non-aggregate command processing.
- The `CQRSPorts` intersection gives handlers access to the full CQRS bus system.
- Standalone command handlers are an alternative to aggregate command handlers for cross-cutting or orchestration logic.

## Test Scenarios

### StandaloneCommandHandler receives full command and merged ports

```ts
import { describe, it, expectTypeOf } from "vitest";
import type {
  StandaloneCommandHandler,
  StandaloneCommand,
  Ports,
  CQRSPorts,
  FrameworkPorts,
} from "@noddde/core";

describe("StandaloneCommandHandler", () => {
  interface NotificationInfra extends Ports {
    emailService: { send(to: string, body: string): Promise<void> };
  }

  interface SendNotificationCommand extends StandaloneCommand {
    name: "SendNotification";
    payload: { to: string; body: string };
  }

  type Handler = StandaloneCommandHandler<
    NotificationInfra,
    SendNotificationCommand
  >;

  it("should receive the full command as first parameter", () => {
    expectTypeOf<
      Parameters<Handler>[0]
    >().toEqualTypeOf<SendNotificationCommand>();
  });

  it("should receive ports merged with CQRSPorts and FrameworkPorts", () => {
    expectTypeOf<Parameters<Handler>[1]>().toEqualTypeOf<
      NotificationInfra & CQRSPorts & FrameworkPorts
    >();
  });

  it("should return void or Promise<void>", () => {
    expectTypeOf<ReturnType<Handler>>().toEqualTypeOf<void | Promise<void>>();
  });
});
```

### StandaloneCommandHandler has access to CQRS buses

```ts
import { describe, it, expect } from "vitest";
import type {
  StandaloneCommandHandler,
  Ports,
  Command,
  CQRSPorts,
} from "@noddde/core";

describe("StandaloneCommandHandler CQRS access", () => {
  it("should allow dispatching commands via ports", () => {
    const handler: StandaloneCommandHandler<Ports, Command> = async (
      command,
      ports,
    ) => {
      // The handler has access to all three buses
      await ports.commandBus.dispatch({ name: "FollowUp" });
      await ports.eventBus.dispatch({
        name: "Processed",
        payload: {},
      });
      await ports.queryBus.dispatch({
        name: "GetStatus",
        payload: {},
      });
    };
    expect(handler).toBeDefined();
  });
});
```

### StandaloneCommandHandler with empty ports

```ts
import { describe, it, expectTypeOf } from "vitest";
import type {
  StandaloneCommandHandler,
  Ports,
  Command,
  CQRSPorts,
} from "@noddde/core";

describe("StandaloneCommandHandler with empty infra", () => {
  type Handler = StandaloneCommandHandler<Ports, Command>;

  it("should still provide CQRSPorts", () => {
    expectTypeOf<Parameters<Handler>[1]>().toMatchTypeOf<CQRSPorts>();
  });
});
```
