import { describe, it, expect, vi } from "vitest";
import { EventEmitterEventBus } from "@noddde/engine";

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
