---
title: "EventEmitterEventBus"
module: engine/implementations/ee-event-bus
source_file: packages/engine/src/implementations/ee-event-bus.ts
status: ready
exports: [EventEmitterEventBus, EventEmitterEventBusConfig]
depends_on:
  [edd/event-bus, edd/event, infrastructure/closeable, infrastructure/logger]
docs:
  - infrastructure/in-memory-implementations.mdx
---

# EventEmitterEventBus

> In-memory EventBus implementation backed by Node.js `EventEmitter`. Dispatches domain events within the same process by emitting on the event's `name` channel with the **full event object** (name, payload, and optional metadata). Handlers are awaited sequentially during dispatch. Suitable for development, testing, and single-process deployments.

## Type Contract

```ts
import type {
  EventBus,
  AsyncEventHandler,
  Instrumentation,
  Logger,
} from "@noddde/core";

/** Configuration for the EventEmitterEventBus. */
export interface EventEmitterEventBusConfig {
  /** Framework logger instance. Defaults to `NodddeLogger("warn", "noddde:ee-event-bus")`. */
  logger?: Logger;
  /** Tracing instrumentation used to enrich error logs with trace correlation IDs. Accepts the `Instrumentation` interface from `@noddde/core`. Defaults to a no-op instance. */
  instrumentation?: Instrumentation;
}

class EventEmitterEventBus implements EventBus {
  /** Constructs the bus. Both config fields are optional. */
  constructor(config?: EventEmitterEventBusConfig);
  /** Registers an async-capable event handler for a given event name. */
  on(eventName: string, handler: AsyncEventHandler): void;
  /** Dispatches an event to all registered handlers. Per-handler errors are caught and logged; dispatch never rejects from a handler failure. */
  dispatch<TEvent extends Event>(event: TEvent): Promise<void>;
  /** Releases all resources: clears handlers. Idempotent. */
  close(): Promise<void>;
}
```

- Implements the `EventBus` interface from `edd/event-bus` (which extends `Closeable`).
- The constructor accepts an optional configuration object. When `config.logger` is omitted, a default `NodddeLogger("warn", "noddde:ee-event-bus")` from `@noddde/engine` is used. When `config.instrumentation` is omitted, a `NoopInstrumentation` (from `@noddde/core`) is used (no OTel correlation enrichment). `instrumentation` accepts any `Instrumentation` implementation, e.g. `@noddde/engine`'s OTel-backed `OTelInstrumentation` (formerly named `Instrumentation`, renamed in the 1.0 API freeze — see `specs/api-freeze.spec.md` decision 7 — to free up the name for this core interface).
- `dispatch` is async (returns `Promise<void>`) and invokes each registered handler sequentially in registration order. **Each handler invocation is wrapped in its own try/catch**: a failure (synchronous throw or rejected promise) is caught, logged, and dispatch continues to the next handler. `dispatch` never rejects from a handler failure — it always resolves with `undefined`.
- The `on` method registers handlers in an internal `Map<string, AsyncEventHandler[]>` keyed by event name.
- `close()` clears all registered handlers (equivalent to the previous `removeAllListeners()`). Since this is an in-memory implementation, there are no connections to release. Idempotent: subsequent calls are no-ops.
- The `AsyncEventHandler` type is imported from `@noddde/core` (no longer defined locally).
- The generic `TEvent extends Event` on `dispatch` preserves event type narrowing at call sites.

## Behavioral Requirements

1. **Channel routing** -- `dispatch(event)` looks up handlers registered via `on(event.name, handler)`. The event's `name` is used as the routing key.
2. **Full event forwarding** -- Handlers receive the full `Event` object (including `name`, `payload`, and optional `metadata`), not just the payload. This allows handlers to access metadata for correlation, tracing, and sequencing.
3. **Sequential invocation with per-handler isolation** -- `dispatch` iterates over registered handlers in registration order. Each handler invocation is wrapped in its own try/catch. A failure (synchronous throw or rejected promise) is caught and **does NOT prevent subsequent handlers from being invoked**. After all handlers have settled, `dispatch` resolves with `undefined`.
4. **Multiple handlers** -- Multiple handlers on the same event name all receive the event, in registration order.
5. **No handlers** -- If no handler is registered for the event name, `dispatch` resolves successfully (no-op).
6. **Internal handler registry** -- Handlers are tracked in a private `Map<string, AsyncEventHandler[]>`. The underlying `EventEmitter` instance is retained for backward compatibility but is not used for handler dispatch.
7. **close clears the handler registry** -- `close()` clears all entries from the internal handler `Map`. After calling it, dispatching any event is a no-op (no handlers invoked). Used during domain shutdown to prevent stale event delivery. Idempotent: subsequent calls are no-ops.
8. **dispatch never rejects from handler failure** -- A handler that throws or returns a rejected promise never causes `dispatch` to reject. `dispatch` always resolves with `undefined` when at least one handler is registered (and is a no-op when none are). This isolates eventual-consistency projections and standalone event handlers from the originating command so that a buggy read-model reducer cannot fail the command at the API boundary.
9. **Structured error logging per failed handler** -- For each handler invocation that fails, the bus calls `logger.error(message, fields)` exactly once with these structured fields:

   - `eventName: string` — from `event.name`.
   - `eventId?: string` — from `event.metadata?.eventId` when present.
   - `handlerName: string` — read from the handler's `name` property (`handler.name`). When the handler has no readable name (anonymous arrow function), falls back to `event.name`.
   - `error: { name: string; message: string; stack?: string }` — extracted from the caught exception. Non-`Error` thrown values are coerced via `String(value)` into the `message` field.
   - `traceId?: string` and `spanId?: string` — populated from the active OpenTelemetry span via the configured `Instrumentation` instance. Absent when no span is active or when `@opentelemetry/api` is not installed.

10. **Registration order is preserved across failures** -- If handler H₁ runs successfully, H₂ throws, and H₃ is registered after H₂, then H₁, H₂, and H₃ are all invoked in that order. H₂'s failure does not skip or reorder H₃'s invocation.
11. **Trace correlation enrichment is best-effort** -- The bus reads `traceId`/`spanId` from the active OTel span via `instrumentation.getActiveTraceCorrelation()`. When OTel is not installed or no span is active, both fields are absent from the log entry (not `null`, not empty strings). This enables log↔trace correlation in observability platforms (Datadog, Honeycomb, etc.) without requiring OTel to be installed.

## Invariants

- `dispatch` never rejects from a handler failure. It resolves with `undefined` whenever at least one handler is registered for the event name (and is a no-op when none are).
- Per-handler isolation: a failing handler invocation never prevents sibling handlers from being invoked for the same dispatch call.
- The bus does not store or replay events. It is a pure pub/sub channel.
- The bus does not deduplicate events. Dispatching the same event object twice results in two rounds of handler invocations.
- Handlers are always invoked with the full event object, never with a destructured payload.
- Each handler failure produces exactly one `logger.error` call.

## Edge Cases

- **Empty payload** -- `dispatch({ name: "SomeEvent", payload: undefined })` invokes handlers with the full event object where `payload` is `undefined`. Handlers must tolerate this.
- **Event with metadata** -- `dispatch({ name: "E", payload: {}, metadata: { eventId: "...", ... } })` forwards the metadata as part of the full event object. Handlers can inspect `event.metadata` for correlation IDs, timestamps, etc.
- **Payload mutation** -- The bus does not clone the event. If a handler mutates the event object, subsequent handlers (and the caller) see the mutation. This is acceptable for in-memory use but would be a bug source in production; documented as a known trade-off.
- **High handler count** -- The internal `Map`-based registry has no limit on handlers per event name.
- **Async handler errors** -- If a handler is async and throws (or returns a rejected promise), the bus catches the error, logs it via the framework `Logger` at `error` level with structured fields, and continues to the next handler. `dispatch` resolves successfully regardless.
- **Synchronous handler throw** -- Treated identically to a rejected promise. The `await handler(event)` in a try/catch handles both cases uniformly.
- **All handlers throw** -- Every handler is invoked, every failure is logged individually, and `dispatch` still resolves with `undefined`. The command/saga that originated the dispatch is unaffected.
- **Handler registration after dispatch** -- Handlers registered after a `dispatch` call has started are not invoked for that dispatch (the handler array is read at dispatch time).
- **Anonymous handler** -- A handler with no `name` property (e.g. `() => { throw ... }`) logs with `handlerName = event.name` as a fallback so log entries remain searchable.
- **Active OTel span absent** -- Log entries omit `traceId`/`spanId` when no span is active or when `@opentelemetry/api` is not installed in the host application.

## Integration Points

- **Domain.init()** -- The domain engine registers projection `on` map handlers and saga event handlers via `bus.on(eventName, handler)`.
- **Domain.dispatchCommand()** -- After persisting aggregate events, the domain dispatches each event through this bus and awaits completion, ensuring projections and sagas are up-to-date before returning.
- **CQRSInfrastructure** -- This bus is provided as `eventBus` in the merged infrastructure object.

## Migration

This is a **breaking change** from the previous version:

| Aspect               | Before                                         | After                                                                                                 |
| -------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Handler argument     | `payload` only                                 | Full `Event` object (`{ name, payload, metadata? }`)                                                  |
| Dispatch semantics   | Fire-and-forget (`emit` + resolve immediately) | Sequential await with per-handler isolation                                                           |
| Handler registration | Direct `EventEmitter.on`                       | `bus.on(eventName, handler)` method                                                                   |
| Error propagation    | Listener errors were unhandled rejections      | Handler errors are caught, logged, and isolated                                                       |
| Constructor          | `new EventEmitterEventBus()`                   | `new EventEmitterEventBus({ logger?, instrumentation? })` (both fields optional, backward-compatible) |

**Migration steps for handler consumers:**

1. Update handler signatures from `(payload) => ...` to `(event) => ...`.
2. Replace `payload.field` access with `event.payload.field`.
3. If handlers need metadata (correlation IDs, timestamps), access `event.metadata`.
4. Handlers that were previously registered via the underlying `EventEmitter` must now use `bus.on(eventName, handler)`.
5. **Handler authors must no longer rely on `dispatch` rejection to surface their failures.** A handler that previously raised a visible error at the call site of `dispatch` will now have its failure logged via the framework `Logger` instead. To make failures visible programmatically, inspect the log stream or attach a structured-log sink. Future versions may add an `onHandlerError(cb)` callback if observability needs demand it.
6. If your handler logic deliberately threw to abort the command that produced the event, restructure: throw inside the aggregate's `decide` instead, or use a strong-consistency projection (`consistency: "strong"`) so the failure propagates via the command's UnitOfWork rollback rather than via the event bus.

## Test Scenarios

### dispatch passes full event object to handler

```ts
import { describe, it, expect, vi } from "vitest";
import { EventEmitterEventBus } from "@noddde/engine";

describe("EventEmitterEventBus", () => {
  it("should pass the full event object to the handler", async () => {
    const bus = new EventEmitterEventBus();
    const handler = vi.fn();

    bus.on("AccountCreated", handler);

    const event = {
      name: "AccountCreated" as const,
      payload: { id: "acc-1", owner: "Alice" },
    };

    await bus.dispatch(event);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(event);
  });
});
```

### dispatch resolves when no handlers are registered

```ts
import { describe, it, expect } from "vitest";
import { EventEmitterEventBus } from "@noddde/engine";

describe("EventEmitterEventBus", () => {
  it("should resolve successfully even with no handlers", async () => {
    const bus = new EventEmitterEventBus();

    await expect(
      bus.dispatch({ name: "UnhandledEvent", payload: {} }),
    ).resolves.toBeUndefined();
  });
});
```

### multiple handlers all receive the full event

```ts
import { describe, it, expect, vi } from "vitest";
import { EventEmitterEventBus } from "@noddde/engine";

describe("EventEmitterEventBus", () => {
  it("should notify all handlers registered on the same event name", async () => {
    const bus = new EventEmitterEventBus();
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    bus.on("DepositMade", handler1);
    bus.on("DepositMade", handler2);

    const event = {
      name: "DepositMade" as const,
      payload: { amount: 100 },
    };

    await bus.dispatch(event);

    expect(handler1).toHaveBeenCalledWith(event);
    expect(handler2).toHaveBeenCalledWith(event);
  });
});
```

### dispatching the same event twice invokes handlers twice

```ts
import { describe, it, expect, vi } from "vitest";
import { EventEmitterEventBus } from "@noddde/engine";

describe("EventEmitterEventBus", () => {
  it("should invoke handlers for each dispatch independently without deduplication", async () => {
    const bus = new EventEmitterEventBus();
    const handler = vi.fn();

    bus.on("ItemAdded", handler);

    const event = { name: "ItemAdded" as const, payload: { itemId: "x" } };

    await bus.dispatch(event);
    await bus.dispatch(event);

    expect(handler).toHaveBeenCalledTimes(2);
  });
});
```

### events on different channels do not interfere

```ts
import { describe, it, expect, vi } from "vitest";
import { EventEmitterEventBus } from "@noddde/engine";

describe("EventEmitterEventBus", () => {
  it("should only notify handlers on the matching event name channel", async () => {
    const bus = new EventEmitterEventBus();
    const accountHandler = vi.fn();
    const orderHandler = vi.fn();

    bus.on("AccountCreated", accountHandler);
    bus.on("OrderPlaced", orderHandler);

    await bus.dispatch({
      name: "AccountCreated" as const,
      payload: { id: "acc-1" },
    });

    expect(accountHandler).toHaveBeenCalledOnce();
    expect(orderHandler).not.toHaveBeenCalled();
  });
});
```

### dispatch awaits async handlers before resolving

```ts
import { describe, it, expect, vi } from "vitest";
import { EventEmitterEventBus } from "@noddde/engine";

describe("EventEmitterEventBus", () => {
  it("should await async handlers sequentially before resolving", async () => {
    const bus = new EventEmitterEventBus();
    const order: string[] = [];

    bus.on("TestEvent", async () => {
      await new Promise((r) => setTimeout(r, 10));
      order.push("first");
    });
    bus.on("TestEvent", async () => {
      order.push("second");
    });

    await bus.dispatch({ name: "TestEvent" as const, payload: {} });

    expect(order).toEqual(["first", "second"]);
  });
});
```

### handler receives event metadata when present

```ts
import { describe, it, expect, vi } from "vitest";
import { EventEmitterEventBus } from "@noddde/engine";

describe("EventEmitterEventBus", () => {
  it("should forward event metadata as part of the full event object", async () => {
    const bus = new EventEmitterEventBus();
    const handler = vi.fn();

    bus.on("AccountCreated", handler);

    const event = {
      name: "AccountCreated" as const,
      payload: { id: "acc-1" },
      metadata: {
        eventId: "evt-001",
        timestamp: "2026-01-01T00:00:00Z",
        correlationId: "corr-1",
        causationId: "cmd-1",
      },
    };

    await bus.dispatch(event);

    expect(handler).toHaveBeenCalledWith(event);
    const receivedEvent = handler.mock.calls[0]![0];
    expect(receivedEvent.metadata).toBeDefined();
    expect(receivedEvent.metadata.correlationId).toBe("corr-1");
  });
});
```

### one handler throws synchronously, siblings still invoked, dispatch resolves

```ts
import { describe, it, expect, vi } from "vitest";
import { EventEmitterEventBus } from "@noddde/engine";
import type { Logger } from "@noddde/core";

describe("EventEmitterEventBus error isolation", () => {
  it("should invoke subsequent handlers when one throws synchronously", async () => {
    const logger: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };
    const bus = new EventEmitterEventBus({ logger });
    const before = vi.fn();
    const after = vi.fn();

    bus.on("E", before);
    bus.on("E", () => {
      throw new Error("boom");
    });
    bus.on("E", after);

    await expect(
      bus.dispatch({ name: "E" as const, payload: {} }),
    ).resolves.toBeUndefined();

    expect(before).toHaveBeenCalledOnce();
    expect(after).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledOnce();
  });
});
```

### one handler rejects asynchronously, siblings still invoked, dispatch resolves

```ts
import { describe, it, expect, vi } from "vitest";
import { EventEmitterEventBus } from "@noddde/engine";

describe("EventEmitterEventBus error isolation", () => {
  it("should invoke subsequent handlers when one returns a rejected promise", async () => {
    const bus = new EventEmitterEventBus();
    const before = vi.fn();
    const after = vi.fn();

    bus.on("E", before);
    bus.on("E", async () => {
      throw new Error("async boom");
    });
    bus.on("E", after);

    await expect(
      bus.dispatch({ name: "E" as const, payload: {} }),
    ).resolves.toBeUndefined();

    expect(before).toHaveBeenCalledOnce();
    expect(after).toHaveBeenCalledOnce();
  });
});
```

### all handlers throw, dispatch still resolves, one log per failure

```ts
import { describe, it, expect, vi } from "vitest";
import { EventEmitterEventBus } from "@noddde/engine";
import type { Logger } from "@noddde/core";

describe("EventEmitterEventBus error isolation", () => {
  it("should resolve and log once per failure even when every handler throws", async () => {
    const logger: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };
    const bus = new EventEmitterEventBus({ logger });

    bus.on("E", () => {
      throw new Error("a");
    });
    bus.on("E", async () => {
      throw new Error("b");
    });
    bus.on("E", () => {
      throw new Error("c");
    });

    await expect(
      bus.dispatch({ name: "E" as const, payload: {} }),
    ).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledTimes(3);
  });
});
```

### registration order is preserved across failure

```ts
import { describe, it, expect } from "vitest";
import { EventEmitterEventBus } from "@noddde/engine";

describe("EventEmitterEventBus error isolation", () => {
  it("should invoke handlers in registration order even when one throws", async () => {
    const bus = new EventEmitterEventBus();
    const order: string[] = [];

    bus.on("E", () => {
      order.push("first");
    });
    bus.on("E", () => {
      order.push("second");
      throw new Error("boom");
    });
    bus.on("E", () => {
      order.push("third");
    });

    await bus.dispatch({ name: "E" as const, payload: {} });

    expect(order).toEqual(["first", "second", "third"]);
  });
});
```

### failed handler does not poison subsequent dispatches

```ts
import { describe, it, expect, vi } from "vitest";
import { EventEmitterEventBus } from "@noddde/engine";

describe("EventEmitterEventBus error isolation", () => {
  it("should keep invoking a failing handler on each dispatch (no automatic disabling)", async () => {
    const bus = new EventEmitterEventBus();
    const failing = vi.fn(() => {
      throw new Error("boom");
    });

    bus.on("E", failing);

    await bus.dispatch({ name: "E" as const, payload: {} });
    await bus.dispatch({ name: "E" as const, payload: {} });

    expect(failing).toHaveBeenCalledTimes(2);
  });
});
```

### logger receives structured fields on handler failure

```ts
import { describe, it, expect, vi } from "vitest";
import { EventEmitterEventBus } from "@noddde/engine";
import type { Logger } from "@noddde/core";

describe("EventEmitterEventBus error isolation", () => {
  it("should log eventName, eventId, handlerName, and error fields", async () => {
    const logger: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };
    const bus = new EventEmitterEventBus({ logger });

    bus.on("AccountCreated", async () => {
      throw new Error("kaboom");
    });

    await bus.dispatch({
      name: "AccountCreated" as const,
      payload: { id: "acc-1" },
      metadata: {
        eventId: "evt-001",
        timestamp: "2026-01-01T00:00:00Z",
        correlationId: "corr-1",
        causationId: "cmd-1",
      },
    });

    expect(logger.error).toHaveBeenCalledOnce();
    const [, fields] = (logger.error as ReturnType<typeof vi.fn>).mock
      .calls[0]!;
    expect(fields).toMatchObject({
      eventName: "AccountCreated",
      eventId: "evt-001",
    });
    expect(fields.handlerName).toBeDefined();
    expect(fields.error).toMatchObject({
      name: expect.any(String),
      message: "kaboom",
    });
  });
});
```

### handlerName is read from function .name when present

```ts
import { describe, it, expect, vi } from "vitest";
import { EventEmitterEventBus } from "@noddde/engine";
import type { Logger } from "@noddde/core";

describe("EventEmitterEventBus error isolation", () => {
  it("should populate handlerName from handler.name when available", async () => {
    const logger: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };
    const bus = new EventEmitterEventBus({ logger });

    async function myProjectionHandler() {
      throw new Error("boom");
    }
    bus.on("E", myProjectionHandler);

    await bus.dispatch({ name: "E" as const, payload: {} });

    const [, fields] = (logger.error as ReturnType<typeof vi.fn>).mock
      .calls[0]!;
    expect(fields.handlerName).toBe("myProjectionHandler");
  });
});
```

### anonymous handler falls back to event name

```ts
import { describe, it, expect, vi } from "vitest";
import { EventEmitterEventBus } from "@noddde/engine";
import type { Logger } from "@noddde/core";

describe("EventEmitterEventBus error isolation", () => {
  it("should fall back to eventName when handler has no readable name", async () => {
    const logger: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };
    const bus = new EventEmitterEventBus({ logger });

    bus.on("UserCreated", () => {
      throw new Error("boom");
    });

    await bus.dispatch({ name: "UserCreated" as const, payload: {} });

    const [, fields] = (logger.error as ReturnType<typeof vi.fn>).mock
      .calls[0]!;
    expect(fields.handlerName).toBe("UserCreated");
  });
});
```

### log entry includes traceId and spanId when active span is present

```ts
import { describe, it, expect, vi } from "vitest";
import { EventEmitterEventBus } from "@noddde/engine";
import { OTelInstrumentation, detectOTel } from "@noddde/engine/tracing";
import type { Logger } from "@noddde/core";

describe("EventEmitterEventBus error isolation", () => {
  it("should enrich log entry with traceId and spanId when OTel is detected and a span is active", async () => {
    const otel = await detectOTel();
    if (!otel) {
      // OTel not installed in this test run — assert the absence path instead.
      const logger: Logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: vi.fn().mockReturnThis(),
      };
      const bus = new EventEmitterEventBus({
        logger,
        instrumentation: new OTelInstrumentation(null),
      });
      bus.on("E", () => {
        throw new Error("boom");
      });
      await bus.dispatch({ name: "E" as const, payload: {} });
      const [, fields] = (logger.error as ReturnType<typeof vi.fn>).mock
        .calls[0]!;
      expect(fields.traceId).toBeUndefined();
      expect(fields.spanId).toBeUndefined();
      return;
    }

    const logger: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };
    const instrumentation = new OTelInstrumentation(otel);
    const bus = new EventEmitterEventBus({ logger, instrumentation });

    bus.on("E", () => {
      throw new Error("boom");
    });

    await instrumentation.withSpan("test.span", {}, async () => {
      await bus.dispatch({ name: "E" as const, payload: {} });
    });

    const [, fields] = (logger.error as ReturnType<typeof vi.fn>).mock
      .calls[0]!;
    expect(fields.traceId).toEqual(expect.any(String));
    expect(fields.spanId).toEqual(expect.any(String));
  });
});
```
