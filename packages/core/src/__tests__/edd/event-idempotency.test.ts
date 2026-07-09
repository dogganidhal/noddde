import { describe, it, expect, vi } from "vitest";
import { withIdempotency } from "@noddde/core";
import type { Event, EventIdempotencyStore } from "@noddde/core";

describe("withIdempotency", () => {
  it("should not invoke the underlying handler when hasProcessed resolves true", async () => {
    const handler = vi.fn();
    const store: EventIdempotencyStore = {
      hasProcessed: vi.fn().mockResolvedValue(true),
      markProcessed: vi.fn().mockResolvedValue(undefined),
      removeExpired: vi.fn().mockResolvedValue(undefined),
    };

    const wrapped = withIdempotency(handler, store);
    const event: Event = {
      name: "Test",
      payload: {},
      metadata: { eventId: "evt-1" } as any,
    };

    await wrapped(event, {});

    expect(store.hasProcessed).toHaveBeenCalledWith("evt-1");
    expect(handler).not.toHaveBeenCalled();
    expect(store.markProcessed).not.toHaveBeenCalled();
  });

  it("should invoke the handler then mark the key processed", async () => {
    const calls: string[] = [];
    const handler = vi.fn(async () => {
      calls.push("handler");
    });
    const store: EventIdempotencyStore = {
      hasProcessed: vi.fn().mockResolvedValue(false),
      markProcessed: vi.fn().mockImplementation(async () => {
        calls.push("markProcessed");
      }),
      removeExpired: vi.fn().mockResolvedValue(undefined),
    };

    const wrapped = withIdempotency(handler, store);
    const event: Event = {
      name: "Test",
      payload: { foo: "bar" },
      metadata: { eventId: "evt-2" } as any,
    };
    const infra = { logger: undefined } as any;

    await wrapped(event, infra);

    expect(handler).toHaveBeenCalledWith(event, infra);
    expect(store.markProcessed).toHaveBeenCalledWith("evt-2");
    expect(calls).toEqual(["handler", "markProcessed"]);
  });

  it("should propagate the handler's rejection without marking the key processed", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("handler failed"));
    const store: EventIdempotencyStore = {
      hasProcessed: vi.fn().mockResolvedValue(false),
      markProcessed: vi.fn().mockResolvedValue(undefined),
      removeExpired: vi.fn().mockResolvedValue(undefined),
    };

    const wrapped = withIdempotency(handler, store);
    const event: Event = {
      name: "Test",
      payload: {},
      metadata: { eventId: "evt-3" } as any,
    };

    await expect(wrapped(event, {})).rejects.toThrow("handler failed");
    expect(store.markProcessed).not.toHaveBeenCalled();
  });

  it("should derive the dedup key from options.key instead of event.metadata.eventId", async () => {
    const handler = vi.fn();
    const store: EventIdempotencyStore = {
      hasProcessed: vi.fn().mockResolvedValue(false),
      markProcessed: vi.fn().mockResolvedValue(undefined),
      removeExpired: vi.fn().mockResolvedValue(undefined),
    };

    const wrapped = withIdempotency(handler, store, {
      key: (event) => `order-${(event.payload as any).orderId}`,
    });
    const event: Event = {
      name: "OrderPlaced",
      payload: { orderId: "o-42" },
      metadata: { eventId: "evt-4" } as any,
    };

    await wrapped(event, {});

    expect(store.hasProcessed).toHaveBeenCalledWith("order-o-42");
    expect(store.markProcessed).toHaveBeenCalledWith("order-o-42");
  });

  it("should reject with a descriptive error and never touch the store or handler", async () => {
    const handler = vi.fn();
    const store: EventIdempotencyStore = {
      hasProcessed: vi.fn().mockResolvedValue(false),
      markProcessed: vi.fn().mockResolvedValue(undefined),
      removeExpired: vi.fn().mockResolvedValue(undefined),
    };

    const wrapped = withIdempotency(handler, store);
    const event: Event = { name: "Test", payload: {} };

    await expect(wrapped(event, {})).rejects.toThrow(/withIdempotency/i);
    expect(handler).not.toHaveBeenCalled();
    expect(store.hasProcessed).not.toHaveBeenCalled();
    expect(store.markProcessed).not.toHaveBeenCalled();
  });

  it("should reject when store.hasProcessed rejects, without calling the handler", async () => {
    const handler = vi.fn();
    const store: EventIdempotencyStore = {
      hasProcessed: vi.fn().mockRejectedValue(new Error("store unavailable")),
      markProcessed: vi.fn().mockResolvedValue(undefined),
      removeExpired: vi.fn().mockResolvedValue(undefined),
    };

    const wrapped = withIdempotency(handler, store);
    const event: Event = {
      name: "Test",
      payload: {},
      metadata: { eventId: "evt-5" } as any,
    };

    await expect(wrapped(event, {})).rejects.toThrow("store unavailable");
    expect(handler).not.toHaveBeenCalled();
  });
});
