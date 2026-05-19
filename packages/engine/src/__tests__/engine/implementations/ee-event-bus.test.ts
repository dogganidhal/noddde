import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  afterEach,
} from "vitest";
import {
  EventEmitterEventBus,
  Instrumentation,
  detectOTel,
} from "@noddde/engine";
import type { Logger } from "@noddde/core";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";

// ─── OTel provider shared by the traceId/spanId test ──────────────────────────
let _provider: NodeTracerProvider | null = null;
let _exporter: InMemorySpanExporter | null = null;

beforeAll(() => {
  _exporter = new InMemorySpanExporter();
  _provider = new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(_exporter)],
  });
  _provider.register();
});
afterEach(() => _exporter?.reset());
afterAll(() => _provider?.shutdown());

// ### dispatch passes full event object to handler
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

// ### dispatch resolves when no handlers are registered
describe("EventEmitterEventBus", () => {
  it("should resolve successfully even with no handlers", async () => {
    const bus = new EventEmitterEventBus();

    await expect(
      bus.dispatch({ name: "UnhandledEvent", payload: {} }),
    ).resolves.toBeUndefined();
  });
});

// ### multiple handlers all receive the full event
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

// ### dispatching the same event twice invokes handlers twice
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

// ### events on different channels do not interfere
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

// ### dispatch awaits async handlers before resolving
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

// ### handler receives event metadata when present
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

// ### close clears all handlers (idempotent)
describe("EventEmitterEventBus", () => {
  it("should clear all handlers on close, making dispatch a no-op", async () => {
    const bus = new EventEmitterEventBus();
    const handler = vi.fn();

    bus.on("SomeEvent", handler);

    await bus.close();

    await bus.dispatch({ name: "SomeEvent" as const, payload: {} });

    expect(handler).not.toHaveBeenCalled();
  });

  it("should be idempotent: calling close multiple times does not throw", async () => {
    const bus = new EventEmitterEventBus();

    await bus.close();
    await expect(bus.close()).resolves.toBeUndefined();
  });
});

// ### one handler throws synchronously, siblings still invoked, dispatch resolves
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

// ### one handler rejects asynchronously, siblings still invoked, dispatch resolves
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

// ### all handlers throw, dispatch still resolves, one log per failure
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

// ### registration order is preserved across failure
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

// ### failed handler does not poison subsequent dispatches
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

// ### logger receives structured fields on handler failure
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

// ### handlerName is read from function .name when present
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

// ### anonymous handler falls back to event name
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

// ### log entry includes traceId and spanId when active span is present
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
        instrumentation: new Instrumentation(null),
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
    const instrumentation = new Instrumentation(otel);
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
