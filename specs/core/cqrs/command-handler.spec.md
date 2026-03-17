---
title: "StandaloneCommandHandler"
module: cqrs/command/command-handler
source_file: packages/core/src/cqrs/command/command-handler.ts
status: ready
exports: [StandaloneCommandHandler]
depends_on: [cqrs/command/command, infrastructure/index]
---

# StandaloneCommandHandler

> `StandaloneCommandHandler` is a function type for handling standalone commands (commands not routed to an aggregate). It receives the full command object and infrastructure merged with CQRS buses, enabling it to dispatch further commands, publish events, or query read models.

## Type Contract

- **`StandaloneCommandHandler<TInfrastructure, TCommand>`** is a function type:
  - First parameter: `command: TCommand` -- the full command object (not just the payload).
  - Second parameter: `infrastructure: TInfrastructure & CQRSInfrastructure` -- custom infrastructure merged with CQRS buses.
  - Return type: `void | Promise<void>`.
- `TInfrastructure` is constrained to `extends Infrastructure`.
- `TCommand` is constrained to `extends StandaloneCommand`.

## Behavioral Requirements

- The handler receives the full command object (including `name`), unlike event handlers which receive only the payload. This is because standalone commands may need to inspect the command name for routing logic.
- Infrastructure is merged with `CQRSInfrastructure` via intersection (`&`), giving the handler access to `commandBus`, `eventBus`, and `queryBus` in addition to custom infrastructure.
- The handler may be sync (`void`) or async (`Promise<void>`).
- The handler can dispatch commands, publish events, or query read models through the CQRS buses.

## Invariants

- The first parameter is the full `TCommand`, not `TCommand["payload"]`.
- The second parameter always includes `CQRSInfrastructure` via intersection.
- The return type is exactly `void | Promise<void>`.
- The generic parameter order is `<TInfrastructure, TCommand>` (infrastructure first, command second).

## Edge Cases

- **Empty infrastructure (`{}`)**: The handler still gets `CQRSInfrastructure` (the three buses).
- **Command with no payload**: `StandaloneCommand` allows `payload` to be `undefined`.
- **Async handler**: Returning a `Promise<void>` is valid.
- **Handler that dispatches commands**: The handler can call `infrastructure.commandBus.dispatch(...)`.

## Integration Points

- `StandaloneCommandHandler` is registered with the engine/runtime for non-aggregate command processing.
- The `CQRSInfrastructure` intersection gives handlers access to the full CQRS bus system.
- Standalone command handlers are an alternative to aggregate command handlers for cross-cutting or orchestration logic.

## Test Scenarios

### StandaloneCommandHandler receives full command and merged infrastructure

```ts
import { describe, it, expectTypeOf } from "vitest";
import type {
  StandaloneCommandHandler,
  StandaloneCommand,
  Infrastructure,
  CQRSInfrastructure,
} from "@noddde/core";

describe("StandaloneCommandHandler", () => {
  interface NotificationInfra extends Infrastructure {
    emailService: { send(to: string, body: string): Promise<void> };
  }

  interface SendNotificationCommand extends StandaloneCommand {
    name: "SendNotification";
    payload: { to: string; body: string };
  }

  type Handler = StandaloneCommandHandler<NotificationInfra, SendNotificationCommand>;

  it("should receive the full command as first parameter", () => {
    expectTypeOf<Parameters<Handler>[0]>().toEqualTypeOf<SendNotificationCommand>();
  });

  it("should receive infrastructure merged with CQRSInfrastructure", () => {
    expectTypeOf<Parameters<Handler>[1]>().toEqualTypeOf<
      NotificationInfra & CQRSInfrastructure
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
  Infrastructure,
  Command,
  CQRSInfrastructure,
} from "@noddde/core";

describe("StandaloneCommandHandler CQRS access", () => {
  it("should allow dispatching commands via infrastructure", () => {
    const handler: StandaloneCommandHandler<Infrastructure, Command> = async (
      command,
      infrastructure,
    ) => {
      // The handler has access to all three buses
      await infrastructure.commandBus.dispatch({ name: "FollowUp" });
      await infrastructure.eventBus.dispatch({ name: "Processed", payload: {} });
      await infrastructure.queryBus.dispatch({ name: "GetStatus", payload: {} });
    };
    expect(handler).toBeDefined();
  });
});
```

### StandaloneCommandHandler with empty infrastructure

```ts
import { describe, it, expectTypeOf } from "vitest";
import type {
  StandaloneCommandHandler,
  Infrastructure,
  Command,
  CQRSInfrastructure,
} from "@noddde/core";

describe("StandaloneCommandHandler with empty infra", () => {
  type Handler = StandaloneCommandHandler<Infrastructure, Command>;

  it("should still provide CQRSInfrastructure", () => {
    expectTypeOf<Parameters<Handler>[1]>().toMatchTypeOf<CQRSInfrastructure>();
  });
});
```
